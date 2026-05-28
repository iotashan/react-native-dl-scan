import Foundation
import NitroModules
import CxxStdlib
import Vision
import CoreML
import CoreImage
import CoreImage.CIFilterBuiltins
import VisionCamera
import UIKit

/// Swift implementation of the DlScan Nitro HybridObject.
///
/// Two scan modes:
///   1. parseBarcodeData — AAMVA-encoded PDF417 string parsing. Delegates
///      directly to the C++ core (dlscan::parse_aamva). 66 GoogleTest cases
///      cover this same C++ code on CI.
///
///   2. recognizeLicenseFields — front-of-card OCR pipeline. Per-frame
///      pipeline (rate-limited to ~3.3 fps internally):
///        a. VNDetectDocumentSegmentationRequest → rectified card image
///        b. VNCoreMLRequest with the bundled DlScanFieldDetector
///           (YOLOv8n, 30 classes) → raw output tensor
///        c. dlscan::yolo::decode_and_nms → per-field bboxes (shared C++)
///        d. VNRecognizeTextRequest on the rectified image → text + bboxes
///        e. IoU match observations to YOLO bboxes → field_id → text map
///        f. dlscan::extract_fields_from_candidates → LicenseDataSpec
///
/// The full pipeline runs on a serial background queue; the worklet thread
/// returns the latest cached result immediately. Async errors are logged
/// (via os_log / NSLog) and cached as nil — Phase 5 may add a structured
/// error channel; v1 surfaces failures as null `licenseData` to JS.
///
/// Registration is handled automatically by the auto-generated
/// DlScanAutolinking.mm. Host apps do NOT call any registration function.
class HybridDlScanIOS: HybridDlScanSpec {

  // MARK: - OCR state (guarded by ocrLock)

  private let ocrLock = NSLock()
  private var cachedOcrResult: LicenseDataSpec? = nil

  /// Per-field multi-frame voter (round-8 design — task #33).
  /// Multi-frame field voter — the implementation lives in C++
  /// (cpp/voter.cpp, 12 unit tests). This Swift property wraps the C ABI
  /// from cpp/voter_c.hpp via Cxx interop. The legacy `[String: String]`
  /// surface keeps the call sites in this file unchanged during the v2
  /// migration window — see Sequence G (#54) for the FieldCandidate-typed
  /// signature flip.
  ///
  /// Lifetime: handle allocated in init via dlscan_voter_new, released in
  /// deinit via dlscan_voter_delete. The voter holds a std::mutex
  /// internally, so we can't store it as a value-type member; the C ABI's
  /// opaque handle pointer is the canonical workaround per round-2.
  private let voter = FieldVoter(maxVotes: 20)

  /// Typed field candidate (v2 Sequence G — task #54). Mirrors
  /// `dlscan::FieldCandidate`. Replaces the legacy `[String: String]`
  /// wire format with the "_strict" suffix convention; provenance now
  /// lives in [source].
  struct FieldCandidate {
    /// dlscan::FieldId enum int. List1=1, List15=15, List4d=43, ...
    let fieldId: Int32
    /// dlscan::FieldSource enum int. See FieldSource.
    let source: Int32
    /// Trimmed value text. Empty texts are filtered before this type.
    let text: String
  }

  /// dlscan::FieldSource mirror — values MUST match the C++ enum exactly.
  enum FieldSource {
    static let unknown: Int32 = 0
    static let barcode: Int32 = 1
    static let bboxIoU: Int32 = 2
    static let strictTextPool: Int32 = 3
    static let manual: Int32 = 4
  }

  final class FieldVoter {
    private let handle: OpaquePointer

    init(maxVotes: Int = 20) {
      // dlscan_voter_new returns nullptr on allocation failure; cast as
      // OpaquePointer? for Swift safety, force-unwrap because the heap
      // allocation is essentially infallible at this scale.
      self.handle = OpaquePointer(dlscan_voter_new(Int32(maxVotes)))!
    }

    deinit {
      dlscan_voter_delete(UnsafeMutableRawPointer(handle))
    }

    // v2 Sequence G — typed accept / consensus over the typed C ABI
    // (dlscan_voter_accept / dlscan_voter_consensus). Replaces the legacy
    // string-keyed _legacy variants that bridged Map<String,String> with
    // a "_strict" suffix convention. Provenance now lives in
    // FieldCandidate.source (BboxIoU vs StrictTextPool).
    func accept(_ candidates: [FieldCandidate]) {
      if candidates.isEmpty { return }
      let n = candidates.count
      let fieldIds = candidates.map { $0.fieldId }
      let sources = candidates.map { $0.source }
      // CRITICAL: the obvious idiom
      //   textBuffers.map { $0.withUnsafeBufferPointer { $0.baseAddress } }
      // is UB — the returned pointers dangle immediately after the inner
      // closure exits. We saw this manifest on iPadOS 26.5 as empty texts
      // reaching the C++ voter, which dropped them on c.text.empty(),
      // producing empty consensus across 21 frames (task #56).
      //
      // Fix: pack all C strings into a single self-allocated contiguous
      // buffer (deallocated after the C call), and emit offset-derived
      // pointers that are stable for the duration of the call.
      let utf8s = candidates.map { Array($0.text.utf8) }
      // Total bytes: sum of each string length + 1 (NUL terminator).
      let totalBytes = utf8s.reduce(0) { $0 + $1.count + 1 }
      let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: totalBytes)
      defer { buf.deallocate() }
      var offsets: [Int] = []
      offsets.reserveCapacity(n)
      var cursor = 0
      for bytes in utf8s {
        offsets.append(cursor)
        for (i, b) in bytes.enumerated() { buf[cursor + i] = b }
        buf[cursor + bytes.count] = 0  // NUL terminator
        cursor += bytes.count + 1
      }
      let textPtrs: [UnsafePointer<CChar>?] = offsets.map { off in
        UnsafeRawPointer(buf.advanced(by: off))
          .assumingMemoryBound(to: CChar.self)
      }
      fieldIds.withUnsafeBufferPointer { idBuf in
        sources.withUnsafeBufferPointer { srcBuf in
          textPtrs.withUnsafeBufferPointer { txtBuf in
            dlscan_voter_accept(
              UnsafeMutableRawPointer(handle),
              n,
              idBuf.baseAddress,
              srcBuf.baseAddress,
              txtBuf.baseAddress,
              nil, nil, nil, nil)
          }
        }
      }
    }

    func consensus() -> [FieldCandidate] {
      // Voter bucket count is bounded by the FieldId enum (~24 ids ×
      // ~3 sources). Allocate generously on the first call to avoid a
      // size round-trip.
      let capacity = 64
      var idsOut = [Int32](repeating: 0, count: capacity)
      var srcOut = [Int32](repeating: 0, count: capacity)
      var txtOut = [UnsafePointer<CChar>?](repeating: nil, count: capacity)
      let count: Int = idsOut.withUnsafeMutableBufferPointer { ibp in
        srcOut.withUnsafeMutableBufferPointer { sbp in
          txtOut.withUnsafeMutableBufferPointer { tbp in
            dlscan_voter_consensus(
              UnsafeMutableRawPointer(handle),
              capacity,
              ibp.baseAddress,
              sbp.baseAddress,
              tbp.baseAddress,
              nil, nil, nil, nil)
          }
        }
      }
      var out: [FieldCandidate] = []
      out.reserveCapacity(min(count, capacity))
      for i in 0..<min(count, capacity) {
        guard let tp = txtOut[i] else { continue }
        out.append(FieldCandidate(
          fieldId: idsOut[i],
          source: srcOut[i],
          text: String(cString: tp)))
      }
      return out
    }

    func reset() {
      dlscan_voter_reset(UnsafeMutableRawPointer(handle))
    }
  }
  private var ocrInFlight = false
  private var lastOcrTime: CFAbsoluteTime = 0
  /// Generation counter — incremented by resetLicenseFieldRecognition() to
  /// invalidate in-flight detection jobs. The async job in ocrQueue snapshots
  /// the generation at dispatch time and only writes its result back to
  /// cachedOcrResult if the generation hasn't changed since. Without this,
  /// a job that started before reset() could overwrite the cleared cache
  /// with the previous card's data.
  private var ocrGeneration: UInt64 = 0
  private var cardCapturedThisSession = false
  private var _scanProgress: Double = 0.0
  var scanProgress: Double { _scanProgress }

  private var _pipelineStage: Double = 0.0
  var pipelineStage: Double { _pipelineStage }

  private var _detectedCardCorners: [Double] = []
  var detectedCardCorners: [Double] { _detectedCardCorners }

  /// Per-pipeline-result generation — bumped each time runDetectionPipeline
  /// actually completes with a non-nil result. Distinct from ocrGeneration
  /// (reset-driven). Matches HybridDlScanAndroid.ocrResultGeneration; lets
  /// the JS voting loop count UNIQUE pipeline runs rather than duplicate
  /// returns of the same cached spec across the camera's ~30 fps polling.
  private var ocrResultGeneration: UInt64 = 0
  private var lastReadOcrResultGeneration: Int64 = -1

  private let ocrQueue = DispatchQueue(label: "com.dlscan.ocr", qos: .userInitiated)

  // MARK: - Field detector state (lazy-loaded once per hybrid instance)

  /// Cached VNCoreMLRequest holding the loaded VNCoreMLModel. Built on first
  /// successful load; nil until then OR if the model asset can't be located /
  /// loaded. Access guarded by modelLock.
  private let modelLock = NSLock()
  private var cachedYoloRequest: VNCoreMLRequest? = nil
  /// Set true after the first load attempt to suppress repeat-load attempts
  /// when the model is missing — avoids retrying VNCoreMLModel load on every
  /// frame for a hybrid instance that's been in a degraded state since boot.
  private var modelLoadAttempted = false

  /// Cached CIContext for perspective-correction rendering. Created lazily.
  private let renderContext = CIContext()

  // MARK: - HybridDlScanSpec

  func parseBarcodeData(barcodeData: String) throws -> Promise<Variant_NullType_LicenseDataSpec> {
    return Promise.parallel {
      // Delegate to the C++ core — dlscan::parse_aamva returns
      // std::optional<dlscan::LicenseData>. Optional(fromCxx:) bridges
      // std::optional<T> → Swift Optional<T> (Swift 5.9+ C++ interop).
      let cppBarcode = std.string(barcodeData)
      let cppResult = dlscan.parse_aamva(cppBarcode)
      guard let cppData = Optional(fromCxx: cppResult) else {
        return Variant_NullType_LicenseDataSpec.first(.null)
      }
      let spec = HybridDlScanIOS.toLicenseDataSpec(cppData)
      return Variant_NullType_LicenseDataSpec.second(spec)
    }
  }

  /// Synchronously called from a frame-processor worklet. Returns the latest
  /// cached OCR result, or null if no result is available yet.
  ///
  /// Each call checks whether a new pipeline run should be submitted (rate-
  /// limited to ~3.3 fps internally via a 0.3s cooldown). The first non-null
  /// result becomes available a few frames after the first call. The cache
  /// is NOT auto-cleared — the caller is responsible for stopping calls
  /// once a non-null result is consumed (e.g., via a Synchronizable guard).
  ///
  /// Frame pixel buffer access happens synchronously within this method;
  /// the pipeline runs asynchronously on ocrQueue but holds a CVPixelBuffer
  /// reference acquired here. CMSampleBuffer validity is checked before
  /// any work begins.
  func recognizeLicenseFields(frame: any HybridFrameSpec) throws -> Variant_NullType_LicenseDataSpec {
    Self.diagBumpCounter("recognize_called")
    let now = CFAbsoluteTimeGetCurrent()

    // Snapshot OCR state under lock — do NOT set ocrInFlight yet.
    // Keep the lock window minimal — no allocations inside.
    ocrLock.lock()
    let cached = cachedOcrResult
    let cachedGen = ocrResultGeneration
    let inFlight = ocrInFlight
    let elapsed = now - lastOcrTime
    let shouldStartNewJob = !inFlight && elapsed >= 0.3  // ~3.3 fps rate limit (matches Android, experiment B)
    ocrLock.unlock()

    // Dedupe: return cached spec only when its generation has advanced
    // since the previous JS read, so each unique pipeline run lands once
    // in JS-side voting. Matches HybridDlScanAndroid logic.
    let freshSpec: LicenseDataSpec?
    if let cached, Int64(cachedGen) != lastReadOcrResultGeneration {
      lastReadOcrResultGeneration = Int64(cachedGen)
      freshSpec = cached
    } else {
      freshSpec = nil
    }

    // Return the fresh-or-nil spec immediately if no new job should be started.
    guard shouldStartNewJob else {
      if let result = freshSpec {
        return Variant_NullType_LicenseDataSpec.second(result)
      }
      return Variant_NullType_LicenseDataSpec.first(.null)
    }

    // Extract the pixel buffer now, on the worklet thread, while the Frame is
    // still valid. Cast to the public NativeFrame protocol (not the internal
    // HybridFrame class) to access the sampleBuffer. If the cast fails or the
    // buffer is unavailable, skip the job without updating lastOcrTime.
    guard let nativeFrame = frame as? any NativeFrame,
          let sampleBuffer = nativeFrame.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      // Cast/extraction failed — do NOT update lastOcrTime or set ocrInFlight.
      if let result = freshSpec {
        return Variant_NullType_LicenseDataSpec.second(result)
      }
      return Variant_NullType_LicenseDataSpec.first(.null)
    }

    // Compute CGImagePropertyOrientation for Vision directly from
    // UIDevice.current.orientation. VC v5's frame.orientation is a relative
    // value (sensor.relativeTo(outputOrientation)) and depends on the
    // Camera component's orientationSource prop being wired through to the
    // output's enablePhysicalBufferRotation, which we observed not actually
    // rotating the AVCaptureConnection on iPadOS 26.5. The buffer bytes
    // are always in the camera sensor's native orientation (back camera =
    // landscape-right). To tell Vision which way is "up" in this buffer,
    // we map UIDeviceOrientation → CGImagePropertyOrientation directly:
    //
    //   Device portrait (camera at top):       sensor rotated 90° CW   → .right
    //   Device portraitUpsideDown (camera bot): sensor rotated 90° CCW → .left
    //   Device landscapeLeft (home on right):   sensor matches buffer  → .up
    //   Device landscapeRight (home on left):   sensor 180° flipped    → .down
    //
    // The Swift `UIDevice.current.orientation` lookup is reliable as long
    // as someone has called beginGeneratingDeviceOrientationNotifications,
    // which VC's HybridInterfaceOrientationManager already does.
    let frameOrientation: CGImagePropertyOrientation
    switch UIDevice.current.orientation {
    case .portrait:           frameOrientation = .right
    case .portraitUpsideDown: frameOrientation = .left
    case .landscapeLeft:      frameOrientation = .up
    case .landscapeRight:     frameOrientation = .down
    default:                  frameOrientation = .right
    }

    // Commit to a new job: set ocrInFlight + lastOcrTime + snapshot
    // generation atomically. The job's result will only be written to
    // cachedOcrResult if the generation hasn't been incremented (by
    // resetLicenseFieldRecognition) by the time the job completes.
    let jobGeneration: UInt64
    ocrLock.lock()
    ocrInFlight = true
    lastOcrTime = now
    jobGeneration = ocrGeneration
    ocrLock.unlock()

    // Retain the pixel buffer so it survives past this method call.
    let retainedBuffer = pixelBuffer

    ocrQueue.async { [weak self] in
      guard let self else { return }
      let result = self.runDetectionPipeline(buffer: retainedBuffer,
                                             orientation: frameOrientation)
      self.ocrLock.lock()
      // Only commit the result if no reset() has happened since this job
      // started. Stale results are dropped silently — the caller (JS) will
      // see null until a fresh job lands.
      if self.ocrGeneration == jobGeneration {
        self.cachedOcrResult = result
        // Bump pipeline-result generation so the next read sees a fresh
        // spec, not a duplicate of the previous one. Only on non-nil.
        if result != nil {
          self.ocrResultGeneration &+= 1
        }
      }
      self.ocrInFlight = false
      self.ocrLock.unlock()
    }

    // Return the dedupe-checked fresh spec (may be nil on first few frames
    // or on duplicate reads of the same pipeline-run generation).
    if let result = freshSpec {
      return Variant_NullType_LicenseDataSpec.second(result)
    }
    return Variant_NullType_LicenseDataSpec.first(.null)
  }

  /// Invalidate the OCR cache and any in-flight detection job. Called by JS
  /// when the consumer's scan session ends — without this, a job that
  /// started right before `useLicenseScanner.reset()` could land after the
  /// reset and re-populate the cache with stale data from the previous card.
  ///
  /// Implementation: bump the generation counter (the in-flight job snapshots
  /// it at dispatch and discards its result on landing if it doesn't match),
  /// clear the cached result, and reset the rate-limit clock so the next
  /// scan can start immediately.
  func resetLicenseFieldRecognition() throws {
    ocrLock.lock()
    ocrGeneration &+= 1   // wraparound-safe
    cachedOcrResult = nil
    lastOcrTime = 0
    cardCapturedThisSession = false
    _scanProgress = 0.0
    _pipelineStage = 0.0
    _detectedCardCorners = []
    // Reset the dedupe marker so the next scan's first fresh result lands.
    lastReadOcrResultGeneration = -1
    ocrLock.unlock()
    // Clear the multi-frame voter so the next scan starts fresh.
    voter.reset()
  }

  // MARK: - Detection pipeline

  /// Run the full doc-seg → YOLO → OCR → IoU-match → C++ extract pipeline.
  /// Returns nil on any stage failure (logged for diagnostics; v1 has no
  /// structured error channel — Phase 5 may add one).
  private func runDetectionPipeline(
    buffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) -> LicenseDataSpec? {
    Self.diagBumpCounter("frames_entered_pipeline")
    Self.diagLog("pipeline frame received orientation=\(orientation.rawValue)")

    // 1. Document segmentation — rectify the card to a perspective-corrected image.
    guard let rectified = runDocSeg(buffer: buffer, orientation: orientation) else {
      NSLog("[DlScan] doc segmentation failed — no card detected")
      Self.diagBumpCounter("docseg_failed")
      _scanProgress = max(_scanProgress, 0.02)
      return nil
    }
    Self.diagBumpCounter("docseg_ok")
    _scanProgress = max(_scanProgress, 0.05)
    // Diagnostic: dump rectified buffer ONCE per app launch so we can pull
    // it via xcrun devicectl device copy from and visually verify what
    // YOLO is being fed. Task #56.
    Self.dumpRectifiedOnce(buffer: rectified)

    // 2. YOLO field detector — locate per-field bboxes on the rectified card.
    let detections = runYOLO(buffer: rectified)
    if detections.isEmpty {
      NSLog("[DlScan] field detector returned 0 detections")
      Self.diagBumpCounter("yolo_empty")
      _scanProgress = max(_scanProgress, 0.05)
      return nil
    }
    Self.diagBumpCounter("yolo_ok")
    Self.diagLog("yolo returned \(detections.count) detections")

    // 3. OCR the rectified card once; we get text + bbox per observation.
    let observations = runVisionKitWithBboxes(on: rectified, orientation: .up)
    if observations.isEmpty {
      NSLog("[DlScan] OCR returned 0 observations")
      Self.diagBumpCounter("ocr_empty")
      return nil
    }
    Self.diagBumpCounter("ocr_ok")
    Self.diagLog("vision OCR returned \(observations.count) observations")

    // 4. Pre-split observations containing multiple AAMVA D-20 field
    //    indices (e.g. "15 SEX M 16 HGT 5'-04\" 17 WGT 160 lb") into
    //    per-field sub-observations using proportional horizontal slicing.
    //    Mirrors HybridDlScanAndroid.splitObservationByAamvaIndices —
    //    round-4 plan. Apple Vision rarely produces multi-index lines
    //    in this form but the platform-parity contract requires it.
    let splitObservations = Self.splitObservationsByAamvaIndices(observations)
    Self.diagLog("split observations: " + String(observations.count) + " -> " + String(splitObservations.count))

    // 4a. Demographic text-pool parse — typed FieldCandidates StrictTextPool.
    let demographicCandidates = Self.parseAamvaDemographicFields(splitObservations)
    Self.diagLog("demographic candidates: " + String(demographicCandidates.count))
    if !demographicCandidates.isEmpty { Self.diagBumpCounter("demographic_nonempty") }

    // 4b. D-lite (iter-10): per-YOLO-bbox Vision regionOfInterest OCR,
    //     replaces the old bbox-IoU matching against whole-card observations.
    //     CLI eval (commit 6a96d66): REGION pipeline lifts state-level
    //     accuracy 17-30% over the matched-IoU pipeline on a 200-image
    //     held-out IDNet batch. Names: 40% -> 98.7%; license #: 46.7% -> 100%.
    //
    //     The detected state (used for per-state list_4d shape regex) is
    //     derived from the whole-card observation pool above.
    let detectedState = Self.detectState(observations: splitObservations)
    let bboxCandidates = runVisionKitPerRegion(
      on: rectified,
      detections: detections,
      orientation: .up,
      detectedState: detectedState)
    Self.diagLog("region candidates: " + String(bboxCandidates.count))
    if !bboxCandidates.isEmpty { Self.diagBumpCounter("region_nonempty") }
    if !observations.isEmpty {
      let sample = observations.prefix(3).map { "[" + $0.text + "]" }.joined(separator: " ")
      Self.diagLog("OCR sample: " + sample)
    }
    let detNames = detections.prefix(5).map { $0.name }.joined(separator: ",")
    Self.diagLog("YOLO classes: " + detNames)

    let frameCandidates = bboxCandidates + demographicCandidates
    Self.diagLog("frame candidates total: " + String(frameCandidates.count))
    if !frameCandidates.isEmpty { Self.diagBumpCounter("frame_candidates_nonempty") }

    voter.accept(frameCandidates)
    let consensus = voter.consensus()
    Self.diagLog("voter consensus size: " + String(consensus.count))
    let totalExpected: Double = 14
    let stabilized = Double(Set(consensus.map { $0.fieldId }).count)
    _scanProgress = min(max(_scanProgress, 0.10 + (stabilized / totalExpected) * 0.85), 1.0)
    if consensus.isEmpty {
      Self.diagBumpCounter("consensus_empty")
      return nil
    }

    Self.diagBumpCounter("voter_consensus_ok")
    Self.diagLog("voter consensus produced \(consensus.count) candidates")

    // 5b. C++ structured extraction on the typed consensus. Build a
    //     dlscan::FieldCandidateVector via Cxx interop and call
    //     extract_fields_from_candidates. Single public extractor path
    //     since v2 Sequence G.
    _pipelineStage = 1
    var cppVec = dlscan.FieldCandidateVector()
    for c in consensus {
      var cppC = dlscan.FieldCandidate()
      cppC.id = dlscan.FieldId(rawValue: c.fieldId) ?? dlscan.FieldId.Unknown
      cppC.source = dlscan.FieldSource(rawValue: c.source) ?? dlscan.FieldSource.Unknown
      cppC.text = std.string(c.text)
      cppVec.push_back(cppC)
    }
    let cppResult = dlscan.extract_fields_from_candidates(cppVec)
    guard let cppData = Optional(fromCxx: cppResult) else {
      NSLog("[DlScan] C++ extract_fields_from_candidates returned nullopt")
      return nil
    }
    _pipelineStage = 2
    // Capture the rectified card image + headshot on the consensus frame.
    // Capture card image + headshot ONCE per scan session.
    var cardPath: String? = nil
    var headshotPath: String? = nil
    if !cardCapturedThisSession {
      cardCapturedThisSession = true
      _pipelineStage = 3
      cardPath = Self.saveRectifiedCard(
        sourceBuffer: buffer, orientation: orientation)
      _pipelineStage = 4
      headshotPath = Self.extractHeadshot(
        from: rectified,
        yoloDetections: detections,
        cardImagePath: cardPath)
      _pipelineStage = 5
    }

    let spec = Self.toLicenseDataSpec(cppData, cardImagePath: cardPath, headshotImagePath: headshotPath)
    return spec
  }

  /// Stage 1: document segmentation. Runs VNDetectDocumentSegmentationRequest,
  /// then perspective-corrects the source pixel buffer using the four detected
  /// corner points. Returns the rectified buffer rendered into a square
  /// canvas suitable for the field detector. nil on any failure.
  private func runDocSeg(buffer: CVPixelBuffer,
                         orientation: CGImagePropertyOrientation) -> CVPixelBuffer? {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer,
                                         orientation: orientation,
                                         options: [:])
    do {
      try handler.perform([request])
    } catch {
      NSLog("[DlScan] VNDetectDocumentSegmentationRequest threw: \(error)")
      return nil
    }
    let allResults = request.results as? [VNRectangleObservation] ?? []
    Self.diagLog("docseg candidates: " + String(allResults.count))
    // Pick the candidate whose corner-derived aspect ratio is closest to
    // ID-1 (1.586). Apple's VNDetectDocumentSegmentationRequest returns
    // candidates sorted by descending confidence, but the highest-confidence
    // quad is often a non-license rectangle in the scene (keyboard,
    // trackpad, screen frame). The license is the only thing in the scene
    // that should have an ID-1 aspect ratio. Task #56.
    let idealAspect: CGFloat = 1.586
    var bestObservation: VNRectangleObservation? = nil
    var bestAspectError = CGFloat.infinity
    for obs in allResults {
      // Convert normalized corners to side lengths in normalized space.
      // Use the longest edge as width, shortest as height.
      func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = a.x - b.x; let dy = a.y - b.y
        return (dx*dx + dy*dy).squareRoot()
      }
      let topW = dist(obs.topLeft, obs.topRight)
      let botW = dist(obs.bottomLeft, obs.bottomRight)
      let leftH = dist(obs.topLeft, obs.bottomLeft)
      let rightH = dist(obs.topRight, obs.bottomRight)
      let avgW = (topW + botW) / 2
      let avgH = (leftH + rightH) / 2
      let longSide = max(avgW, avgH)
      let shortSide = min(avgW, avgH)
      guard shortSide > 0 else { continue }
      let aspect = longSide / shortSide
      // Skip degenerate or absurd aspect ratios (likely not a license).
      guard aspect < 3.0 else { continue }
      let aspectError = abs(aspect - idealAspect)
      Self.diagLog("docseg cand conf=" + String(format: "%.3f", obs.confidence)
        + " aspect=" + String(format: "%.3f", aspect)
        + " err=" + String(format: "%.3f", aspectError))
      if aspectError < bestAspectError {
        bestAspectError = aspectError
        bestObservation = obs
      }
    }
    guard let observation = bestObservation else {
      Self.diagBumpCounter("docseg_no_valid_candidate")
      return nil
    }
    Self.diagBumpCounter("docseg_picked_best_aspect")
    Self.diagLog("docseg picked candidate with aspect error=" + String(format: "%.3f", bestAspectError))

    // Store normalized corners for JS reticle tracking (flip Y for top-left origin).
    // VNRectangleObservation corners are normalized [0,1] with bottom-left origin.
    _detectedCardCorners = [
      Double(observation.topLeft.x), Double(1 - observation.topLeft.y),
      Double(observation.topRight.x), Double(1 - observation.topRight.y),
      Double(observation.bottomRight.x), Double(1 - observation.bottomRight.y),
      Double(observation.bottomLeft.x), Double(1 - observation.bottomLeft.y),
    ]

    // Apply orientation to the source image so the corner points (which are
    // in oriented-image space) map into the same coordinate system.
    let sourceImage = CIImage(cvPixelBuffer: buffer).oriented(orientation)
    let sourceExtent = sourceImage.extent
    guard sourceExtent.width.isFinite, sourceExtent.height.isFinite,
          sourceExtent.width > 0, sourceExtent.height > 0 else { return nil }

    // Vision returns normalized [0,1] points with origin bottom-left.
    // CIImage extent.minX/minY is NOT always (0,0) after .oriented() — for
    // some orientation transforms the origin shifts. Include the offset in
    // the denormalization so the corner points map into absolute CIImage
    // coordinate space (which is what CIPerspectiveCorrection expects).
    func denormalize(_ p: CGPoint) -> CGPoint {
      CGPoint(x: sourceExtent.minX + p.x * sourceExtent.width,
              y: sourceExtent.minY + p.y * sourceExtent.height)
    }
    let topLeft     = denormalize(observation.topLeft)
    let topRight    = denormalize(observation.topRight)
    let bottomLeft  = denormalize(observation.bottomLeft)
    let bottomRight = denormalize(observation.bottomRight)

    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage  = sourceImage
    filter.topLeft     = topLeft
    filter.topRight    = topRight
    filter.bottomLeft  = bottomLeft
    filter.bottomRight = bottomRight
    guard let rectified = filter.outputImage else { return nil }

    // CIPerspectiveCorrection's output extent can be null/infinite/non-zero-
    // origin/degenerate for extreme perspectives. Validate before allocating
    // a CVPixelBuffer; clamp the rendered size to a sane upper bound (a real
    // license card under handheld capture rectifies to ~1500x1000 pixels).
    let rawExtent = rectified.extent
    guard !rawExtent.isNull, !rawExtent.isInfinite,
          rawExtent.width.isFinite, rawExtent.height.isFinite,
          rawExtent.width > 1, rawExtent.height > 1 else { return nil }

    let extent = rawExtent.integral
    let pixels = extent.width * extent.height
    guard pixels.isFinite, pixels > 0 else { return nil }

    // round-13 fix (task #40): render into a FIXED ID-1-aspect canvas
    // — the true ID-1 driver-licence aspect ratio (1.586:1). The earlier
    // "max 1600 dimension / max 2M pixels" clamp let the rectified canvas
    // adopt whatever aspect ratio the CIPerspectiveCorrection extent gave
    // (which on a perspective-distorted capture is rarely the card's true
    // ratio), producing the same square-distortion bug that #34 fixed on
    // Android. Anisotropic resize from the CIPerspectiveCorrection extent
    // to the target preserves character glyph density per mm on the card
    // and makes downstream OCR + YOLO geometry deterministic.
    //
    // v2 #46: 806 → 807 — derived from ID1_ASPECT in cpp/constants.hpp.
    // 85.60 / 53.98 = 1.5858; 1280 / 1.5858 = 807.07 → 807.
    let outW = 1280
    let outH = 807
    let scaleX = CGFloat(outW) / extent.width
    let scaleY = CGFloat(outH) / extent.height
    let renderImage = rectified
      .cropped(to: extent)
      .transformed(by: CGAffineTransform(translationX: -extent.minX,
                                          y: -extent.minY))
      .transformed(by: CGAffineTransform(scaleX: scaleX,
                                          y: scaleY))

    let attrs: [String: Any] = [
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]
    ]
    var outBuffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      outW, outH,
      kCVPixelFormatType_32BGRA,
      attrs as CFDictionary,
      &outBuffer
    )
    guard status == kCVReturnSuccess, let outBuf = outBuffer else { return nil }
    renderContext.render(renderImage,
                         to: outBuf,
                         bounds: CGRect(x: 0, y: 0, width: outW, height: outH),
                         colorSpace: CGColorSpaceCreateDeviceRGB())
    return outBuf
  }

  /// Stage 2: YOLO field detector. Runs VNCoreMLRequest against the bundled
  /// DlScanFieldDetector model, then calls into shared C++ to decode the
  /// raw output tensor + run NMS. Returns the surviving field detections in
  /// the rectified-image coordinate space. Empty on any failure (model load,
  /// inference, tensor shape mismatch).
  ///
  /// Returns: array of (className, bbox in image-space, confidence) tuples.
  private func runYOLO(buffer: CVPixelBuffer)
      -> [(name: String, bbox: CGRect, conf: Float)] {

    guard let request = ensureYoloRequest() else {
      Self.diagBumpCounter("yolo_request_nil")
      return []
    }
    Self.diagBumpCounter("yolo_request_ok")

    // Anisotropic stretch to 640x640. The upstream rectified buffer is a
    // fixed 1280x806 (ID-1 aspect 1.586:1) so the squish is deterministic
    // and we reverse it exactly when unprojecting bboxes below. Set
    // explicitly — per Apple's VNImageCropAndScaleOption docs, .scaleFill
    // is a pure per-axis stretch (no aspect preservation, no pad, no crop),
    // equivalent to Android's Bitmap.createScaledBitmap(640, 640, filter=true).
    request.imageCropAndScaleOption = .scaleFill

    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    do {
      try handler.perform([request])
    } catch {
      NSLog("[DlScan] VNCoreMLRequest threw: \(error)")
      Self.diagBumpCounter("yolo_handler_threw")
      Self.diagLog("yolo handler threw: \(error)")
      return []
    }
    Self.diagBumpCounter("yolo_handler_ok")

    guard let obs = request.results?.first as? VNCoreMLFeatureValueObservation,
          let multiArray = obs.featureValue.multiArrayValue,
          multiArray.dataType == .float32 else {
      NSLog("[DlScan] YOLO output not a float32 MLMultiArray")
      Self.diagBumpCounter("yolo_obs_bad")
      Self.diagLog("yolo obs missing or wrong type; results count: \(request.results?.count ?? -1)")
      return []
    }
    Self.diagBumpCounter("yolo_obs_ok")
    Self.diagLog("yolo multiArray shape: \(multiArray.shape.map { $0.intValue })")

    // Expected shape: (1, 4 + num_classes, num_anchors) = (1, 34, 8400).
    // Some Core ML versions surface shapes as MLMultiArrayShape (NSNumber);
    // we only need (channels, anchors) — the leading 1 is just a batch dim.
    let shape = multiArray.shape.map { $0.intValue }
    let totalChannels: Int
    let numAnchors: Int
    if shape.count == 3 {
      totalChannels = shape[1]
      numAnchors    = shape[2]
    } else if shape.count == 2 {
      totalChannels = shape[0]
      numAnchors    = shape[1]
    } else {
      NSLog("[DlScan] unexpected MLMultiArray shape: \(shape)")
      return []
    }
    guard totalChannels >= 5, numAnchors > 0 else { return [] }
    let numClasses = totalChannels - 4

    // Get a contiguous float pointer. MLMultiArray strides should be unit-
    // strided for float32 outputs of this shape, but we don't currently verify
    // that — a future hardening pass could fall back to a manual copy if
    // strides indicate non-contiguous layout.
    let floatPtr = multiArray.dataPointer.assumingMemoryBound(to: Float.self)
    // Diagnostic: log strides + first 16 floats to confirm the tensor is
    // unit-strided ChannelMajor (and that values are sigmoid'd to [0,1]).
    let stridesArr = multiArray.strides.map { $0.intValue }
    let firstFloats: [Float] = (0..<min(16, multiArray.count)).map { floatPtr[$0] }
    Self.diagLog("yolo strides: " + stridesArr.map(String.init).joined(separator: ",")
      + " | first16: " + firstFloats.map { String(format: "%.3f", $0) }.joined(separator: ","))
    // Also sample max class score across all anchors (channels 4..33)
    // so we know whether the model is producing low confidence or zero
    // confidence everywhere.
    var maxClassScore: Float = 0
    let nClasses = totalChannels - 4
    for ch in 4..<totalChannels {
      let base = ch * numAnchors
      for a in 0..<numAnchors {
        let v = floatPtr[base + a]
        if v > maxClassScore { maxClassScore = v }
      }
    }
    Self.diagLog("yolo maxClassScore across all anchors: " + String(format: "%.6f", maxClassScore)
      + " | classes=" + String(nClasses) + " anchors=" + String(numAnchors))

    // Anisotropic .scaleFill stretches the rectified 1280x806 buffer to
    // 640x640 (per-axis scale factors). C++ NMS returns coords in that
    // 640x640 model space. We reverse the stretch per-axis (no pad math)
    // to land back in rectified-image-space (1280x806). This matches the
    // Android pipeline (Bitmap.createScaledBitmap → toYoloSpace inverse).
    let imageW = CGFloat(CVPixelBufferGetWidth(buffer))
    let imageH = CGFloat(CVPixelBufferGetHeight(buffer))
    let scaleX = 640.0 / imageW
    let scaleY = 640.0 / imageH

    var config = dlscan.yolo.NmsConfig()
    // Match HybridDlScanAndroid's CONF_THRESHOLD = 0.01 exactly. The
    // Ultralytics-default 0.25 was rejecting valid detections on iPad -
    // the bundled DlScanFieldDetector model surfaces lots of per-field
    // bboxes at sub-25% confidence that NMS then collapses to a single
    // high-confidence pick per class. Filtering at 0.01 lets NMS pick
    // the winner; filtering at 0.25 drops everything. Task #56.
    config.conf_threshold = 0.01
    config.iou_threshold  = 0.45
    config.max_detections = 100

    let cppDets = dlscan.yolo.decode_and_nms(
      floatPtr,
      numClasses,
      numAnchors,
      config
    )
    Self.diagLog("yolo decode_and_nms returned " + String(cppDets.size()) + " raw dets")

    var results: [(name: String, bbox: CGRect, conf: Float)] = []
    results.reserveCapacity(Int(cppDets.size()))
    for d in cppDets {
      // Reverse anisotropic .scaleFill: divide by per-axis scale.
      let x1 = CGFloat(d.x1) / scaleX
      let y1 = CGFloat(d.y1) / scaleY
      let x2 = CGFloat(d.x2) / scaleX
      let y2 = CGFloat(d.y2) / scaleY
      let bbox = CGRect(x: x1,
                        y: y1,
                        width: max(0, x2 - x1),
                        height: max(0, y2 - y1))
      let name = String(cString: dlscan.yolo.class_name_or_empty(d.class_id))
      if !name.isEmpty {
        results.append((name: name, bbox: bbox, conf: d.confidence))
      }
    }
    return results
  }

  /// Lazy-init the VNCoreMLRequest holding the loaded field-detector model.
  /// Returns nil if the model asset isn't bundled or fails to load — the
  /// pipeline degrades to "no result" rather than throwing.
  private func ensureYoloRequest() -> VNCoreMLRequest? {
    modelLock.lock()
    defer { modelLock.unlock() }

    if let req = cachedYoloRequest { return req }
    if modelLoadAttempted { return nil }  // already failed once; don't retry
    modelLoadAttempted = true

    guard let modelURL = Self.bundledModelURL(name: "DlScanFieldDetector",
                                               ext: "mlmodelc") else {
      NSLog("[DlScan] DlScanFieldDetector.mlmodelc not found in bundle")
      return nil
    }
    do {
      let mlModel = try MLModel(contentsOf: modelURL)
      let vnModel = try VNCoreMLModel(for: mlModel)
      let request = VNCoreMLRequest(model: vnModel)
      cachedYoloRequest = request
      return request
    } catch {
      NSLog("[DlScan] Failed to load field detector model: \(error)")
      return nil
    }
  }

  /// Locate a resource bundled with the framework. Works in both SPM and
  /// CocoaPods builds:
  ///   - SPM: Bundle.module exposes the package's resource bundle directly.
  ///   - CocoaPods: the podspec uses s.resource_bundles { 'DlScan' => ... }
  ///     which produces a `DlScan.bundle` inside the framework bundle.
  private static func bundledModelURL(name: String, ext: String) -> URL? {
    #if SWIFT_PACKAGE
    return Bundle.module.url(forResource: name, withExtension: ext)
    #else
    let frameworkBundle = Bundle(for: HybridDlScanIOS.self)
    if let resourceBundleURL = frameworkBundle.url(forResource: "DlScan",
                                                    withExtension: "bundle"),
       let resourceBundle = Bundle(url: resourceBundleURL),
       let url = resourceBundle.url(forResource: name, withExtension: ext) {
      return url
    }
    // Fallback: same bundle as the class (handles pod-without-resource_bundles).
    return frameworkBundle.url(forResource: name, withExtension: ext)
    #endif
  }

  /// Stage 3: VisionKit text recognition with bbox preserved.
  /// Returns text + bbox-in-image-pixel-space per observation.
  /// The caller passes the rectified buffer; the bbox space is the rectified
  /// image's pixel space (same as runYOLO returns), enabling direct IoU.
  private func runVisionKitWithBboxes(
    on buffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation = .up
  ) -> [(text: String, bbox: CGRect)] {
    var results: [(text: String, bbox: CGRect)] = []
    let imageW = CGFloat(CVPixelBufferGetWidth(buffer))
    let imageH = CGFloat(CVPixelBufferGetHeight(buffer))

    let request = VNRecognizeTextRequest { request, error in
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation] else {
        return
      }
      for observation in observations {
        guard let candidate = observation.topCandidates(1).first,
              candidate.confidence >= 0.3 else { continue }
        // VNRectangleObservation.boundingBox is normalized [0,1] with
        // bottom-left origin. Convert to top-left-origin pixel space so it
        // matches the YOLO bbox space (which is top-left, pixel-space).
        let bb = observation.boundingBox
        let x1 = bb.minX * imageW
        let x2 = bb.maxX * imageW
        // Flip Y: top in image-pixel-space = (1 - bbox.maxY) * imageH
        let y1 = (1.0 - bb.maxY) * imageH
        let y2 = (1.0 - bb.minY) * imageH
        let rect = CGRect(x: x1, y: y1, width: x2 - x1, height: y2 - y1)
        results.append((text: candidate.string, bbox: rect))
      }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cvPixelBuffer: buffer,
                                         orientation: orientation,
                                         options: [:])
    try? handler.perform([request])
    return results
  }

  /// Iter-10 D-lite production port. Per-YOLO-bbox Vision OCR via
  /// VNRecognizeTextRequest.regionOfInterest — bypasses the whole-card
  /// OCR + bbox-IoU matching layer for fields with a YOLO detection.
  /// CLI eval (commit 6a96d66): REGION pipeline 88-100% per state vs PROD
  /// 65-82% on a 200-image held-out batch. list_1 surname 40 -> 98.7%,
  /// list_4d lic # 46.7 -> 100%.
  ///
  /// Iter-8 settings tuned via subagent investigation:
  ///   usesLanguageCorrection = false — language priors hurt punctuation
  ///     on short isolated ROIs (',' -> '.' on city/zip rows)
  ///   Per-class right-pad override for list_17 (+6%) — YOLO bbox
  ///     sometimes clips the "lb" suffix
  private func runVisionKitPerRegion(
    on buffer: CVPixelBuffer,
    detections: [(name: String, bbox: CGRect, conf: Float)],
    orientation: CGImagePropertyOrientation = .up,
    detectedState: String?
  ) -> [FieldCandidate] {
    let imageW = CGFloat(CVPixelBufferGetWidth(buffer))
    let imageH = CGFloat(CVPixelBufferGetHeight(buffer))
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer,
                                         orientation: orientation,
                                         options: [:])
    // Iter-11 latency win: skip YOLO classes that are graphical regions
    // (face / donor / ghostimg / barcode crops) or don't have a FieldId
    // mapping. Drops ~25% of Vision calls per frame (e.g. 20 -> 16),
    // measured CLI-side at 400ms -> 310ms wall.
    let kNonOcrClasses: Set<String> = [
      "face", "donor", "ghostimg",
      "card_num1", "card_num2",
      "list_3c", "list_5"
    ]
    var out: [FieldCandidate] = []
    out.reserveCapacity(detections.count)
    let pad: CGFloat = 0.005
    for det in detections {
      if kNonOcrClasses.contains(det.name) { continue }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false
      let rightPad: CGFloat = (det.name == "list_17") ? 0.06 : pad
      let x = max(0, det.bbox.minX / imageW - pad)
      let xMax = min(1, det.bbox.maxX / imageW + rightPad)
      let w = xMax - x
      let yBot = max(0, (imageH - det.bbox.maxY) / imageH - pad)
      let yTop = min(1, (imageH - det.bbox.minY) / imageH + pad)
      let h = yTop - yBot
      request.regionOfInterest = CGRect(x: x, y: yBot, width: w, height: h)
      do {
        try handler.perform([request])
      } catch {
        continue
      }
      let texts = (request.results ?? []).compactMap { obs -> String? in
        guard let candidate = obs.topCandidates(1).first,
              candidate.confidence >= 0.3 else { return nil }
        return candidate.string
      }
      let raw = texts.joined(separator: " ")
      let stripped = Self.stripAamvaPrefixForClass(text: raw, yoloClass: det.name)
      let tightened = Self.tightenByContentShape(text: stripped, yoloClass: det.name,
                                                 detectedState: detectedState)
      if tightened.isEmpty { continue }
      let fieldId = Self.yoloClassNameToFieldId(det.name)
      if fieldId == 0 { continue }
      out.append(FieldCandidate(
        fieldId: fieldId,
        source: FieldSource.bboxIoU,
        text: tightened))
    }
    return out
  }

  // MARK: - Bbox matching

  /// Concatenation policy: which YOLO classes legitimately produce multi-line
  /// content where multiple OCR observations should be joined into one value.
  /// All other classes use single-winner (max-IoU) assignment.
  ///
  /// list_8s (city/state/zip) was previously in this set "defensively" but
  /// the IDNet batch eval surfaced it as a -32% regression on synthetic
  /// US/AZ/NV data: Vision returns the street as one observation and
  /// city/zip as another, both overlap the YOLO list_8s bbox, and concat
  /// sweeps the street into list_8s ("• 79 APACHE TRAIL\\nAPACHE JUNCTION,
  /// AZ 85120"). Real AAMVA D-20 D-8 city/zip values are always single
  /// line; treat list_8s as single-winner like every other 1-line class.
  private static let multilineFieldClasses: Set<String> = [
    "list_5",   // address line 1 (some states)
    "list_8f",  // street (can wrap to 2 lines when long)
  ]

  /// Stage 4: greedy max-IoU assignment of OCR observations to YOLO fields.
  ///
  /// For each OCR observation:
  ///   - Compute IoU against every YOLO bbox.
  ///   - Assign to the bbox with highest IoU above a small threshold (0.05).
  ///     Lower threshold than NMS — we WANT to capture observations that
  ///     are partially-contained-in a field bbox.
  ///   - For classes in multilineFieldClasses: append (with newline join).
  ///   - For other classes: keep highest-confidence observation only.
  ///
  /// Observations not matching any field bbox are dropped.
  private func matchObservationsToFields(
    observations: [(text: String, bbox: CGRect)],
    detections: [(name: String, bbox: CGRect, conf: Float)],
    imageSize: CGSize  // unused now but kept for future un-letterbox math
  ) -> [FieldCandidate] {
    // v2 Sequence G — typed return. Bbox-matching is class-name-keyed
    // internally (multi-line concat works by class name); the final
    // result is converted to typed FieldCandidates with
    // source = FieldSource.bboxIoU. Unknown class names drop.
    if detections.isEmpty || observations.isEmpty { return [] }

    // Iter 6: detect issuing state once from the observation pool so
    // state-aware tighteners (currently list_4d only) can route on it.
    let detectedState = Self.detectState(observations: observations)

    // round-5 refactor (matches Android): build the full (det, obs)
    // IoU grid (not greedy single-best per obs), raise threshold to 0.08
    // post element-splitting, apply class-aware AAMVA prefix stripping
    // when emitting each value, drop demographic fields whose strip detects
    // an index-mismatch (signal that the YOLO bbox→observation pairing is
    // wrong).
    let matchThreshold: CGFloat = 0.08

    struct Match {
      let obsIndex: Int
      let iou: CGFloat
    }
    var matchesByDet: [Int: [Match]] = [:]

    for (oi, obs) in observations.enumerated() {
      for (di, det) in detections.enumerated() {
        let i = Self.iou(obs.bbox, det.bbox)
        if i >= matchThreshold {
          matchesByDet[di, default: []].append(Match(obsIndex: oi, iou: i))
        }
      }
    }

    var result: [String: String] = [:]

    // CRITICAL: iterate detections.indices (which is 0, 1, 2, … and matches
    // the C++ NMS confidence-descending output order — index 0 is highest
    // confidence). Iterating a Swift Dictionary [Int: [Match]] directly
    // gives no order guarantee, so a lower-confidence duplicate-class
    // detection could be visited first and our `if result[name] == nil`
    // guard would silently keep it instead of the highest-confidence one.
    for detIndex in detections.indices {
      guard let matches = matchesByDet[detIndex], !matches.isEmpty else { continue }
      let det = detections[detIndex]

      if Self.multilineFieldClasses.contains(det.name) {
        let sorted = matches.sorted { lhs, rhs in
          let ly = observations[lhs.obsIndex].bbox.midY
          let ry = observations[rhs.obsIndex].bbox.midY
          return ly < ry
        }
        let lines = sorted.map { match -> String in
          let stripped = Self.stripAamvaPrefixForClass(
            text: observations[match.obsIndex].text,
            yoloClass: det.name)
          return Self.tightenByContentShape(text: stripped, yoloClass: det.name, detectedState: detectedState)
        }.filter { !$0.isEmpty }
        if lines.isEmpty { continue }
        let joined = lines.joined(separator: "\n")
        if let existing = result[det.name] {
          result[det.name] = existing + "\n" + joined
        } else {
          result[det.name] = joined
        }
      } else {
        let winner = matches.max { lhs, rhs in
          if lhs.iou != rhs.iou { return lhs.iou < rhs.iou }
          let ly = observations[lhs.obsIndex].bbox.midY
          let ry = observations[rhs.obsIndex].bbox.midY
          return ly > ry
        }!
        let raw = observations[winner.obsIndex].text
        let cleaned = Self.stripAamvaPrefixForClass(text: raw, yoloClass: det.name)
        let tightened = Self.tightenByContentShape(text: cleaned, yoloClass: det.name, detectedState: detectedState)
        if !tightened.isEmpty && result[det.name] == nil {
          result[det.name] = tightened
        }
      }
    }

    // v2 Sequence G — convert class-name-keyed result to typed
    // FieldCandidates. Unknown class names (face/donor/ghostimg/etc)
    // drop to FieldId::Unknown and are filtered out.
    var out: [FieldCandidate] = []
    out.reserveCapacity(result.count)
    for (className, value) in result {
      let fieldId = Self.yoloClassNameToFieldId(className)
      if fieldId == 0 { continue }  // Unknown
      out.append(FieldCandidate(
        fieldId: fieldId,
        source: FieldSource.bboxIoU,
        text: value))
    }
    return out
  }

  /// YOLO class name → dlscan::FieldId int. MUST mirror
  /// cpp/yolo/field_classes.cpp's kFieldClassToFieldId table. Inlined
  /// here so the iOS bbox-matching path doesn't need a Cxx round-trip
  /// per detection. v2 Sequence G — task #54.
  private static let yoloClassNameToFieldIdMap: [String: Int32] = [
    "birthday":     102,  // FieldId::Birthday
    "country":      106,  // FieldId::Country
    "expire_date":  103,  // FieldId::ExpireDate
    "gender":       105,  // FieldId::Gender
    "given_name":   101,  // FieldId::GivenName
    "list_1":       1,
    "list_12":      12,
    "list_15":      15,
    "list_16":      16,
    "list_17":      17,
    "list_18":      18,
    "list_19":      19,
    "list_2":       2,
    "list_3":       3,
    "list_4a":      41,
    "list_4b":      42,
    "list_4d":      43,
    "list_5":       5,
    "list_8f":      81,
    "list_8s":      82,
    "list_9":       9,
    "list_9a":      91,
    "personal_num": 104,  // FieldId::PersonalNum
    "surname":      100,  // FieldId::Surname
    // face / donor / ghostimg / card_num1 / card_num2 / list_3c map to
    // FieldId::Unknown (0) and are dropped.
  ]
  private static func yoloClassNameToFieldId(_ name: String) -> Int32 {
    return yoloClassNameToFieldIdMap[name] ?? 0
  }

  // MARK: - AAMVA prefix stripping & demographic text-pool parser

  /// Map from YOLO class to expected AAMVA D-20 index token. Mirrors
  /// `HybridDlScanAndroid.expectedAamvaIndex`.
  private static let expectedAamvaIndex: [String: String] = [
    "list_1":  "1",
    "list_2":  "2",
    "list_3":  "3",
    "list_4a": "4a",
    "list_4b": "4b",
    "list_4d": "4d",
    "list_5":  "5",
    "list_8f": "8",
    "list_8s": "8",
    "list_9":  "9",
    "list_9a": "9a",
    "list_12": "12",
    "list_15": "15",
    "list_16": "16",
    "list_17": "17",
    "list_18": "18",
    "list_19": "19",
  ]

  /// YOLO classes where a leading-prefix mismatch should DROP the field
  /// (rather than pass the wrong text through). Mirrors
  /// `HybridDlScanAndroid.dropOnIndexMismatch`. The demographic/appearance
  /// fields use this; name/address/license classes keep the legacy
  /// "return unchanged" behavior so legitimate cases like "12 MAIN ST"
  /// accidentally matched to list_8s aren't erased.
  private static let dropOnIndexMismatch: Set<String> = [
    "list_9", "list_15", "list_16", "list_17", "list_18", "list_19"
  ]

  /// Vision-specific AAMVA index misreads. VisionKit fuses the small "d"
  /// (or "a") of multi-char AAMVA indices into the next visually similar
  /// glyph — on the WI WI-D card the index "4d" comes back as a single
  /// lowercase "a". Android-side MLKit makes a different misread (drops
  /// the letter entirely, leaving bare "4"), so these aliases live in
  /// the per-platform strip path rather than the shared C++ lexer
  /// (which would change the AAMVA grammar for both engines).
  ///
  /// The aliases only fire as a FALLBACK when the lexer's own
  /// `findAamvaToken` returned nil; a real lexer hit always wins.
  /// Listed longest-first to avoid e.g. "a" eating a legitimate "ad"
  /// prefix when both are present.
  private static let kVisionMisreadAlias: [String: [String]] = [
    "4d": ["ad", "4", "a", "A"],
    "4a": ["4", "a", "A"],
    "4b": ["4"],
    "9a": ["9", "a", "A"],
  ]

  /// Strip the AAMVA index prefix iff (a) the YOLO class is in the
  /// expected-index map AND (b) the lexer recognizes a token at the start
  /// of the text whose canonical index matches the class's expected index.
  /// On mismatch, returns "" for demographic classes (drop signal) or the
  /// original text for other classes.
  static func stripAamvaPrefixForClass(text: String, yoloClass: String) -> String {
    // Trust-the-class rule for street (list_8f). The OCR frequently
    // hallucinates a leading single digit (e.g. `1 4242 ASHWOOD LN` for
    // an actual `4242 Ashwood Ln`) because the YOLO crop catches the
    // trailing tail of a neighboring AAMVA index character. The lexer-based
    // strip below treats that `1` as an index-mismatch and leaves it in
    // place, polluting the street value. When YOLO has classified the field
    // as 8f we trust that signal: if the rest-of-string starts with a 2-5
    // digit run followed by whitespace and a non-digit (the street-number →
    // street-name shape), drop the bogus single-digit prefix.
    //
    // Residual risk: a genuine street where OCR inserted a space inside the
    // house number (e.g. `1234 W MAIN ST` → `1 234 W MAIN ST`) would also
    // strip to `234 W MAIN ST`. Accepted: this OCR failure mode is much
    // rarer than the hallucinated-index prefix, and the multi-frame voter
    // averages out the occasional false positive.
    //
    // list_8s (city/state/zip) intentionally NOT covered: the regex would
    // only fire on a scrambled zip-first observation, which is not a real
    // OCR failure mode for that field.
    //
    // Test parity note: the regex pattern below is byte-for-byte the same
    // string used by HybridDlScanAndroid.kt, where it IS covered by JVM
    // unit tests. NSRegularExpression (ICU) and Java/Kotlin Regex (ICU)
    // produce identical match results for this pattern when applied to
    // normalized ASCII AAMVA/OCR class values (the only domain we feed it).
    // A direct Swift XCTest for this function is tracked separately because
    // the iOS XCTest target does not yet exist in this repo.
    if yoloClass == "list_8f" {
      if let m = try? NSRegularExpression(pattern: "^\\s*\\d\\s+(\\d{2,5}\\s+\\D.*)$") {
        let ns = text as NSString
        let range = NSRange(location: 0, length: ns.length)
        if let match = m.firstMatch(in: text, range: range),
           match.numberOfRanges == 2 {
          let g = ns.substring(with: match.range(at: 1))
          return g.trimmingCharacters(in: .whitespaces)
        }
      }
    }

    guard let expected = expectedAamvaIndex[yoloClass] else { return text }
    if let token = AamvaLexer.findAamvaToken(in: text) {
      let tokenStartOffset = text.distance(from: text.startIndex, to: token.range.lowerBound)
      if tokenStartOffset > 2 { return text }
      if token.index != expected {
        return dropOnIndexMismatch.contains(yoloClass) ? "" : text
      }
      let labelPart = token.label.map { "\($0) " } ?? ""
      return (labelPart + token.value).trimmingCharacters(in: .whitespaces)
    }

    // Vision-misread alias fallback. The lexer found NO recognised token,
    // which on iOS most commonly means VisionKit fused the multi-char
    // AAMVA index (e.g. "4d") into a single lowercase letter ("a") that
    // the shared lexer can't canonicalise. Only fires for licence-shape
    // classes; the matched alias must be followed by whitespace and a
    // run starting with [A-Z0-9] of length >= 4 to keep this fallback
    // narrow enough not to corrupt unrelated values.
    if let aliases = Self.kVisionMisreadAlias[expected] {
      let ns = text as NSString
      let nsRange = NSRange(location: 0, length: ns.length)
      for alias in aliases {
        let escaped = NSRegularExpression.escapedPattern(for: alias)
        let pattern = "^\\s*\(escaped)\\s+([A-Z0-9][A-Z0-9-]{3,})"
        if let re = try? NSRegularExpression(pattern: pattern),
           let m = re.firstMatch(in: text, range: nsRange),
           m.numberOfRanges == 2 {
          return ns.substring(with: m.range(at: 1))
        }
      }
    }

    return text
  }

  /// AAMVA D-20 eye/hair color allowlists. Mirror of
  /// cpp/aamva/aamva_lexer.cpp::eye_color_codes() /
  /// hair_color_codes(). Used by tightenByContentShape to extract just
  /// the color code from observations like "EYES BRO RACE W" or
  /// "HAIR BRO" where labels and adjacent fields bleed into the value.
  private static let kEyeColorCodes: Set<String> = [
    "BLK", "BLU", "BRO", "GRY", "GRN", "HAZ", "MAR", "PNK", "DIC", "UNK"
  ]
  private static let kHairColorCodes: Set<String> = [
    "BAL", "BLK", "BLN", "BRO", "GRY", "RED", "SDY", "WHI", "UNK"
  ]

  /// Per-class content-shape tightener. Applied AFTER prefix stripping.
  /// Mirrors `HybridDlScanAndroid.tightenByContentShape` with one review-
  /// flagged divergence: we `.uppercased()` first. The Android Kotlin
  /// regex is uppercase-only `[A-Z0-9]`, which silently passes through
  /// any all-lowercase OCR output (a real latent bug on that platform;
  /// fix forthcoming there too). Licence numbers (AAMVA D-20 list_4d) are
  /// definitionally uppercase alphanumeric joined by `-`; normalising
  /// case first makes the regex robust to VisionKit's occasional
  /// lowercase-mode runs (we've seen `"a H200..."` ; in principle
  /// `"h200..."` is possible too) without corrupting any legitimate
  /// value. Returns the input unchanged for classes without a known
  /// shape, and rejects matches shorter than 4 chars (no real D-20 4d
  /// value is shorter).
  static func tightenByContentShape(text: String, yoloClass: String,
                                    detectedState: String? = nil) -> String {
    if text.isEmpty { return text }
    switch yoloClass {
    case "list_4d":
      // State-aware first: if a state is detected and that state has a
      // known list_4d shape, try the state-specific pattern on the
      // OCR-substitution-tolerant input. Wins on AZ ("DLN D83796679"),
      // CA ("DL I1397863"), PA ("DLN: 67 401 089"), WI ("S740-...").
      if let state = detectedState,
         let pattern = Self.kStateLicensePatterns[state] {
        // Strip common label prefixes ("DLN:", "DLN", "DL:", "DL") so
        // the state regex anchors at the actual value rather than
        // greedily consuming the label.
        var stripped = text.uppercased()
        for p in ["DLN:", "DLN", "DL:", "DL"] {
          if stripped.hasPrefix(p) {
            stripped = String(stripped.dropFirst(p.count))
                .trimmingCharacters(in: .whitespaces)
            break
          }
        }
        let upperState = stripped
        let nsState = upperState as NSString
        if let re = try? NSRegularExpression(pattern: pattern),
           let m = re.firstMatch(in: upperState,
                                  range: NSRange(location: 0, length: nsState.length)) {
          let raw = nsState.substring(with: m.range)
          // Substitute OCR digit confusions: O->0, I->1, l->1.
          // Limited to chars within the matched range — non-prefix
          // alpha chars (the "D" in AZ, "W" in WV, leading letter in
          // CA/WI) stay intact because the pattern's first char is
          // matched against a state-specific letter class, not [OIl].
          var canon = ""
          let chars = Array(raw)
          // Find the index where digits-region starts. AZ/CA/WV/WI have
          // an alphabetic prefix; DC/NV/NC/PA/SD/UT are pure digits.
          let stateHasAlphaPrefix: Set<String> = ["AZ", "CA", "WV", "WI"]
          let prefixLen = stateHasAlphaPrefix.contains(state) ? 1 : 0
          for (i, c) in chars.enumerated() {
            if i < prefixLen {
              canon.append(c)
            } else {
              switch c {
              case "O": canon.append("0")
              case "I": canon.append("1")
              case "L": canon.append("1")  // already uppercased
              default:  canon.append(c)
              }
            }
          }
          return canon
        }
      }
      // Fallback: existing alphanumeric-with-hyphens shape gate.
      let normalized = text.uppercased()
      let ns = normalized as NSString
      let nsRange = NSRange(location: 0, length: ns.length)
      if let re = try? NSRegularExpression(pattern: "^[A-Z0-9]+(?:-[A-Z0-9]+)*"),
         let m = re.firstMatch(in: normalized, range: nsRange),
         m.range.length >= 4 {
        return ns.substring(with: m.range)
      }
      return text
    case "list_18":
      // Pre-eval, both Vision and MLKit return values like
      // "EYES BRO", "EYES BRO RACE W", "5'-08\" 198 Ib BRO". Walk the
      // alphabetic 3-letter tokens, return the FIRST that matches the
      // AAMVA D-20 eye-color allowlist. Falls through to the input
      // unchanged if no token matches (lets downstream code see the
      // raw text for diagnostics).
      return firstColorCodeMatch(in: text, allowlist: Self.kEyeColorCodes) ?? text
    case "list_19":
      return firstColorCodeMatch(in: text, allowlist: Self.kHairColorCodes) ?? text
    case "list_15":
      // Sex/gender — extract a single isolated M / F / X letter.
      // Observations look like "SEX F", "15 SEX F.", "SEX M".
      // Reject 3-letter words like "SEX" by requiring a word boundary
      // around a single letter.
      let upper = text.uppercased()
      let ns15 = upper as NSString
      if let re = try? NSRegularExpression(pattern: "(?<![A-Z])[MFX](?![A-Z])"),
         let m = re.firstMatch(in: upper, range: NSRange(location: 0, length: ns15.length)) {
        return ns15.substring(with: m.range)
      }
      return text
    case "list_17":
      // Weight — extract `\d+ ?(LB|KG|LBS|KGS)`. AAMVA D-20 D-12 stores
      // weight in pounds (or kg with the unit suffix). Observations look
      // like "WGT 157 lb", "5'-08\" 198 Ib BRO" (MLKit "Ib" misread
      // included). Normalise to "<digits> LB" form.
      let upper17 = text.uppercased().replacingOccurrences(of: "IB", with: "LB").replacingOccurrences(of: "|B", with: "LB")
      let ns17 = upper17 as NSString
      if let re = try? NSRegularExpression(pattern: "(\\d{2,4})\\s*(LBS?|KGS?)"),
         let m = re.firstMatch(in: upper17, range: NSRange(location: 0, length: ns17.length)),
         m.numberOfRanges == 3 {
        let n = ns17.substring(with: m.range(at: 1))
        let unit = ns17.substring(with: m.range(at: 2))
        return "\(n) \(unit)"
      }
      return text
    case "list_9":
      // Vehicle class: single uppercase letter (A/B/C/D/M typical).
      // Strip CLASS labels + drop "NONE" so "DNONE" (class+endorsements
      // fused by MLKit) finds the leading D.
      return Self.extractSingleLetterValue(in: text, dropTokens: ["NONE"]) ?? text
    case "list_9a":
      // Endorsements: "NONE" most common; otherwise CDL letter codes.
      if text.uppercased().contains("NONE") { return "NONE" }
      return Self.extractSingleLetterValue(in: text) ?? text
    case "list_12":
      // Restrictions: "NONE" or a single letter (typically B for
      // corrective lenses).
      if text.uppercased().contains("NONE") { return "NONE" }
      return Self.extractSingleLetterValue(in: text, dropTokens: ["NONE"]) ?? text
    case "list_16":
      // Height: canonicalise OCR's `5'-11"` (one double quote) to the
      // AAMVA-D-20 form `5'-11''` (two single quotes after the inches).
      // Strict regex: `\d+'-\d+(?:"|'')` first, transform.
      let ns16 = text as NSString
      if let re = try? NSRegularExpression(pattern: "(\\d+)'-(\\d+)(?:\"|'')"),
         let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns16.length)),
         m.numberOfRanges == 3 {
        let ft = ns16.substring(with: m.range(at: 1))
        let inch = ns16.substring(with: m.range(at: 2))
        return "\(ft)'-\(inch)''"
      }
      return text
    case "list_3":
      // Date of birth. First date in the value (fused observations like
      // "DOB 11/O9/2000 4b EXP 05/12/2028" want the leading date).
      return Self.extractDate(from: text, preferLast: false) ?? text
    case "list_4a":
      // Issue date. First date (MLKit's "1SS 09/23/2020" / "ISS 05/12/2023"
      // / "185 05/22/2021" all have the date as the only or leading
      // date in the value).
      return Self.extractDate(from: text, preferLast: false) ?? text
    case "list_4b":
      // Expiration date. LAST date — fused observations like
      // "3 DOB 02/20/1997 4b EXP 05/12/2028" pin EXP at the end.
      return Self.extractDate(from: text, preferLast: true) ?? text
    default:
      return text
    }
  }

  /// State-name -> 2-letter-code map for the IDNet-covered US DL corpus.
  /// Listed longest-first so multi-word names match before shorter
  /// state names that share a prefix (no overlaps in this set but
  /// future-proof for "NEW MEXICO" etc.).
  private static let kStateNameToCode: [(String, String)] = [
    ("DISTRICT OF COLUMBIA", "DC"),
    ("NORTH CAROLINA",       "NC"),
    ("SOUTH DAKOTA",         "SD"),
    ("WEST VIRGINIA",        "WV"),
    ("PENNSYLVANIA",         "PA"),
    ("CALIFORNIA",           "CA"),
    ("WISCONSIN",            "WI"),
    ("ARIZONA",              "AZ"),
    ("NEVADA",               "NV"),
    ("UTAH",                 "UT"),
  ]

  /// Per-state list_4d (licence number) shape — verified against IDNet
  /// ground truth for each state. Used by tightenByContentShape with a
  /// detected state to extract the canonical licence number from
  /// label-prefixed OCR output ("DLN D83796679" -> "D83796679",
  /// "DL I1397863" -> "I1397863"). Allows `O`/`I`/`l` in digit positions
  /// (Vision/MLKit substitution misreads); substitutes back to digits
  /// before returning.
  private static let kStateLicensePatterns: [String: String] = [
    "AZ": "D[0-9OIl]{8}",
    "CA": "[A-Z][0-9OIl]{7}",
    "DC": "[0-9OIl]{7}",
    "NV": "[0-9OIl]{10}",
    "NC": "[0-9OIl]{12}",
    "PA": "[0-9OIl]{2}\\s?[0-9OIl]{3}\\s?[0-9OIl]{3}",
    "SD": "[0-9OIl]{8}",
    "UT": "[0-9OIl]{9}",
    "WV": "W[0-9OIl]{6}",
    "WI": "[A-Z][0-9OIl]{3}-[0-9OIl]{4}-[0-9OIl]{4}-[0-9OIl]{2}",
  ]

  /// Detect the issuing US state from the OCR observation pool. Scans
  /// the entire text for state-name substrings (case-insensitive). The
  /// state banner is the only large-font field on AAMVA D-20 cards and
  /// is OCR'd reliably across both engines.
  ///
  /// Returns the 2-letter state code, or nil if no state name is found.
  /// Conservative: requires an EXACT substring match (no fuzzy matching)
  /// to avoid mis-classifying ambiguous cards.
  static func detectState(observations: [(text: String, bbox: CGRect)]) -> String? {
    let pool = observations.map { $0.text.uppercased() }.joined(separator: " ")
    for (name, code) in kStateNameToCode {
      if pool.contains(name) { return code }
    }
    return nil
  }

  /// Extract a single uppercase letter value from `text` after stripping
  /// common label variations (`CLASS`, `REST`, `END`, etc.) plus diacritic
  /// noise. Returns the first 1-char `[A-Z]+` token found; nil if none.
  ///
  /// `dropTokens` lets the caller pre-strip multi-letter words that would
  /// otherwise pollute the scan — most importantly `"NONE"`. On AZ/CA cards
  /// MLKit fuses the class field's value with the next field's `"NONE"`
  /// into `"DNONE"` (class=D, endorsements=NONE). Replacing `NONE` with
  /// whitespace first lets the single-letter scan find `D` cleanly.
  static func extractSingleLetterValue(in text: String,
                                       dropTokens: [String] = []) -> String? {
    var s = text.uppercased()
    let labels = [
      "CLASS:", "CLASS", "CLAS:", "CLAS",
      "REST:", "REST", "RESTR:", "RESTR", "RSTR",
      "END:", "END", "ENDORSEMENTS"
    ]
    for l in labels { s = s.replacingOccurrences(of: l, with: " ") }
    for dt in dropTokens { s = s.replacingOccurrences(of: dt, with: " ") }
    let ns = s as NSString
    guard let re = try? NSRegularExpression(pattern: "[A-Z]+") else { return nil }
    let ms = re.matches(in: s, range: NSRange(location: 0, length: ns.length))
    for m in ms {
      let tok = ns.substring(with: m.range)
      if tok.count == 1 { return tok }
    }
    return nil
  }

  /// Extract a date pattern from `text`, tolerating common OCR char
  /// substitutions in digit positions (`O`->`0`, `I`/`l`->`1`) and a
  /// stray `I` separator (MLKit's frequent misread of `/`). Returns a
  /// canonical `MM/DD/YYYY` string with zero-padded month/day, or nil
  /// if no date-shaped sub-string is found or the candidate fails
  /// month-1-12 / day-1-31 / year-1900-2100 validation.
  ///
  /// `preferLast` picks the LAST regex match in the value rather than
  /// the first — needed for fused multi-date observations like
  /// "DOB 11/O9/2000 4b EXP 05/12/2028" where list_4b wants the EXP
  /// date (last) and list_3 wants the DOB date (first).
  static func extractDate(from text: String, preferLast: Bool = false) -> String? {
    // Strip whitespace so "DOB1 1/03/1995" -> "DOB11/03/1995" matches.
    let stripped = text.replacingOccurrences(of: " ", with: "")
    let ns = stripped as NSString
    // Digit-or-substitution chars in number positions; explicit
    // separator set (`/`, `I`, `l`) for month/day boundaries.
    // YYYY is 4 chars; allow O/I/l substitutions throughout.
    guard let re = try? NSRegularExpression(
            pattern: "([0-9OIl]{2})[/Il]([0-9OIl]{2})[/Il]([0-9OIl]{4})")
    else { return nil }
    let matches = re.matches(in: stripped,
                             range: NSRange(location: 0, length: ns.length))
    if matches.isEmpty { return nil }

    func canonicalize(_ s: String) -> String {
      return s.replacingOccurrences(of: "O", with: "0")
              .replacingOccurrences(of: "I", with: "1")
              .replacingOccurrences(of: "l", with: "1")
    }
    let candidates: [NSTextCheckingResult] = preferLast ? matches.reversed() : matches
    for m in candidates {
      guard m.numberOfRanges == 4 else { continue }
      let mm = canonicalize(ns.substring(with: m.range(at: 1)))
      let dd = canonicalize(ns.substring(with: m.range(at: 2)))
      let yyyy = canonicalize(ns.substring(with: m.range(at: 3)))
      guard let m_i = Int(mm), let d_i = Int(dd), let y_i = Int(yyyy),
            m_i >= 1, m_i <= 12,
            d_i >= 1, d_i <= 31,
            y_i >= 1900, y_i <= 2100 else { continue }
      return String(format: "%02d/%02d/%04d", m_i, d_i, y_i)
    }
    return nil
  }

  /// Find the first alphabetic 3-letter token in `text` whose uppercased
  /// form is in `allowlist`. Returns the uppercased match, or nil if no
  /// token matches. Tokenisation: any run of A-Z letters (case-
  /// insensitive). This catches "EYES BRO" -> "BRO", "BRO RACE" -> "BRO",
  /// "HAIR BRO" -> "BRO", and refuses to match incidental 3-letter
  /// non-color words ("RACE", "EYE", "WGT", "DOB" — none are in the
  /// AAMVA color whitelist).
  private static func firstColorCodeMatch(in text: String,
                                          allowlist: Set<String>) -> String? {
    let upper = text.uppercased()
    let ns = upper as NSString
    guard let re = try? NSRegularExpression(pattern: "[A-Z]{3,}") else { return nil }
    let matches = re.matches(in: upper, range: NSRange(location: 0, length: ns.length))
    for m in matches {
      let tok = ns.substring(with: m.range)
      // Allowlist is 3-letter codes; longer tokens like "EYES" are
      // labels — skip them. 3-letter-exact-match only.
      if tok.count == 3 && allowlist.contains(tok) {
        return tok
      }
    }
    return nil
  }

  /// Split each observation containing multiple AAMVA tokens into per-field
  /// sub-observations via proportional bbox slicing. Mirrors
  /// HybridDlScanAndroid.splitObservationByAamvaIndices.
  static func splitObservationsByAamvaIndices(
    _ observations: [(text: String, bbox: CGRect)]
  ) -> [(text: String, bbox: CGRect)] {
    var out: [(text: String, bbox: CGRect)] = []
    for obs in observations {
      let tokens = AamvaLexer.findAllAamvaTokens(in: obs.text)
      if tokens.count < 2 {
        out.append(obs)
        continue
      }
      let totalLen = max(CGFloat(obs.text.count), 1)
      for (i, tok) in tokens.enumerated() {
        let startOffset = obs.text.distance(from: obs.text.startIndex, to: tok.range.lowerBound)
        let endOffset: Int = (i + 1 < tokens.count)
          ? obs.text.distance(from: obs.text.startIndex, to: tokens[i + 1].range.lowerBound)
          : obs.text.count
        let s = obs.text.index(obs.text.startIndex, offsetBy: startOffset)
        let e = obs.text.index(obs.text.startIndex, offsetBy: endOffset)
        let subText = String(obs.text[s ..< e]).trimmingCharacters(in: .whitespaces)
        if subText.isEmpty { continue }
        let leftFrac = CGFloat(startOffset) / totalLen
        let rightFrac = CGFloat(endOffset) / totalLen
        let subBbox = CGRect(
          x: obs.bbox.minX + leftFrac * obs.bbox.width,
          y: obs.bbox.minY,
          width: (rightFrac - leftFrac) * obs.bbox.width,
          height: obs.bbox.height
        )
        out.append((text: subText, bbox: subBbox))
      }
    }
    return out
  }

  /// Demographic text-pool parser. Mirrors
  /// HybridDlScanAndroid.parseAamvaDemographicFields. Four-gate strict scan:
  /// (a) AAMVA index ∈ {9,15,16,17,18,19}; (b) lexer-recognised label
  /// compatible with the index; (c) value matches expectedDomain regex;
  /// (d) unique candidate across the observation pool. Returns a map of
  /// (yolo-class → value) assignments that bypass YOLO bbox matching.
  static func parseAamvaDemographicFields(
    _ observations: [(text: String, bbox: CGRect)]
  ) -> [FieldCandidate] {
    // v2 Sequence G — typed return. Provenance moves from the legacy
    // `<base>_strict` key suffix to FieldSource.strictTextPool on each
    // emitted FieldCandidate. The C++ resolver still applies the
    // StrictAgrees → CrossValidated (1.00) upgrade when both strict +
    // bbox candidates converge — that's the input to the multi-source
    // tier upgrade (round-1 lock — concat, do not collapse).
    let indexToFieldId: [String: Int32] = [
      "3":  3,    // FieldId::List3   (DOB)
      "4a": 41,   // FieldId::List4a  (issue date)
      "4b": 42,   // FieldId::List4b  (expiration date)
      "9":  9,    // FieldId::List9   (vehicle class)
      "12": 12,   // FieldId::List12  (restrictions)
      "15": 15,   // FieldId::List15  (sex)
      "16": 16,   // FieldId::List16  (height)
      "17": 17,   // FieldId::List17  (weight)
      "18": 18,   // FieldId::List18  (eye color)
      "19": 19,   // FieldId::List19  (hair color)
    ]
    var candidatesByIndex: [String: [AamvaToken]] = [:]
    for obs in observations {
      for token in AamvaLexer.findAllAamvaTokens(in: obs.text) {
        guard indexToFieldId[token.index] != nil else { continue }                       // (a)
        // round-6: label-gate downgraded from reject to signal.
        // Vision frequently mis-OCRs labels (HGT→HOT, WGT→VWGT). The
        // idx+domain combo is sufficient to accept the candidate.
        _ = AamvaLexer.isCompatibleLabel(canonicalIndex: token.index, label: token.label)
        let cleaned = token.value
          .trimmingCharacters(in: .whitespaces)
          .trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
        guard AamvaLexer.valueMatchesDomain(cleaned, domainKey: token.index) else { continue } // (c)
        candidatesByIndex[token.index, default: []].append(token)
      }
    }
    var out: [FieldCandidate] = []
    for (idx, toks) in candidatesByIndex {
      guard toks.count == 1, let fieldId = indexToFieldId[idx] else { continue }         // (d)
      // Emit JUST the lexer-bounded value (round-6 follow-on).
      // See HybridDlScanAndroid for rationale; in short: the C++
      // normalize functions need clean values, and label prefixes
      // become poison when the OCR-noise label isn't in the C++
      // strip-target list.
      let tok = toks[0]
      let v: String
      switch idx {
      case "15": v = tok.value.uppercased().trimmingCharacters(in: .whitespaces)
      default:   v = tok.value.trimmingCharacters(in: .whitespaces)
      }
      if !v.isEmpty {
        out.append(FieldCandidate(
          fieldId: fieldId,
          source: FieldSource.strictTextPool,
          text: v))
      }
    }
    return out
  }

  /// Axis-aligned IoU. Mirrors the C++ dlscan::yolo::iou but operates on
  /// CGRect for use during the Swift-side bbox matching step. Guards
  /// pathological zero-area / negative-extent rectangles.
  private static func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
    if a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0 {
      return 0
    }
    let xL = max(a.minX, b.minX)
    let yT = max(a.minY, b.minY)
    let xR = min(a.maxX, b.maxX)
    let yB = min(a.maxY, b.maxY)
    let interW = max(0, xR - xL)
    let interH = max(0, yB - yT)
    let inter = interW * interH
    if inter <= 0 { return 0 }
    let union = a.width * a.height + b.width * b.height - inter
    return union > 0 ? inter / union : 0
  }

  // MARK: - C++ <-> Swift bridging helpers

  /// Bridge a C++ std::optional<std::string> to Swift String?.
  /// Uses the Nitro bridge helpers from DlScan-Swift-Cxx-Bridge.hpp for
  /// consistency with Nitrogen's own generated accessor pattern.
  private static func optStr(
    _ opt: margelo.nitro.dlscan.bridge.swift.std__optional_std__string_
  ) -> String? {
    typealias B = margelo.nitro.dlscan.bridge.swift
    guard B.has_value_std__optional_std__string_(opt) else { return nil }
    return String(B.get_std__optional_std__string_(opt))
  }

  /// Convert a C++ dlscan::LicenseData struct to the Nitro-generated LicenseDataSpec.
  ///
  /// Field types in dlscan::LicenseData (cpp/license_data.hpp):
  ///   - All string fields are std::optional<std::string>
  ///   - `sex` is std::optional<std::string> with values "M"/"F"/"X"
  ///   - `aamvaVersion` is std::optional<int>
  ///
  /// The Nitro LicenseDataSpec maps those to:
  ///   - String fields → String? (via bridge helpers)
  ///   - `sex` → Sex? (Nitro-generated enum; Sex(fromString:) does the conversion)
  ///   - `aamvaVersion` → Double? (TS number maps to C++ double in Nitro)
  static func toLicenseDataSpec(_ ld: dlscan.LicenseData, cardImagePath: String? = nil, headshotImagePath: String? = nil) -> LicenseDataSpec {
    // sex: std::optional<std::string> ("M"/"F"/"X") → Sex?
    let sexStr: String? = optStr(ld.sex)
    let sexValue: Sex? = sexStr.flatMap { Sex(fromString: $0) }

    // aamvaVersion: std::optional<int> → Double?
    let versionValue: Double? = Optional(fromCxx: ld.aamvaVersion).map { Double($0) }

    // documentType: optional dlscan::DocumentType enum → Nitro DocumentType?
    let docTypeValue: DocumentType?
    if let cppDocType = Optional(fromCxx: ld.documentType) {
      switch cppDocType {
      case dlscan.DocumentType.Passport:         docTypeValue = .passport
      case dlscan.DocumentType.NationalId:       docTypeValue = .nationalId
      case dlscan.DocumentType.ResidencePermit:  docTypeValue = .residencePermit
      case dlscan.DocumentType.DriverLicense:    docTypeValue = .driverLicense
      default:                                   docTypeValue = .unknown
      }
    } else {
      docTypeValue = nil
    }

    // mrz: optional dlscan::MRZData → MRZDataSpec?
    let mrzValue: MRZDataSpec?
    if let cppMrz = Optional(fromCxx: ld.mrz) {
      let mrzTypeVal: MRZTypeSpec
      switch cppMrz.mrzType {
      case dlscan.MRZType.TD1: mrzTypeVal = .td1
      case dlscan.MRZType.TD2: mrzTypeVal = .td2
      default:                 mrzTypeVal = .td3
      }
      let mrzSexVal: Sex = Sex(fromString: String(cppMrz.sex)) ?? .x
      mrzValue = MRZDataSpec(
        mrzType:             mrzTypeVal,
        documentCode:        String(cppMrz.documentCode),
        issuingState:        String(cppMrz.issuingState),
        documentNumber:      String(cppMrz.documentNumber),
        primaryIdentifier:   String(cppMrz.primaryIdentifier),
        secondaryIdentifier: String(cppMrz.secondaryIdentifier),
        nationality:         String(cppMrz.nationality),
        dateOfBirth:         String(cppMrz.dateOfBirth),
        sex:                 mrzSexVal,
        dateOfExpiry:        String(cppMrz.dateOfExpiry),
        optionalData:        String(cppMrz.optionalData),
        checkDigitsValid:    cppMrz.checkDigitsValid
      )
    } else {
      mrzValue = nil
    }

    // fieldConfidence: std::map<std::string, float> → JSON. Iterating a
    // std::map across Swift/C++ interop is finicky; do the encoding in
    // shared C++ so Kotlin + Swift both just call `confidence_json(ld)`
    // and get a std::string back. Empty map → nil.
    let confCxx = dlscan.confidence_json(ld)
    let confStr = String(confCxx)
    let dataConfJson: String? = confStr.isEmpty ? nil : confStr

    return LicenseDataSpec(
      firstName:      optStr(ld.firstName),
      lastName:       optStr(ld.lastName),
      middleName:     optStr(ld.middleName),
      dateOfBirth:    optStr(ld.dateOfBirth),
      expirationDate: optStr(ld.expirationDate),
      issueDate:      optStr(ld.issueDate),
      licenseNumber:  optStr(ld.licenseNumber),
      street:         optStr(ld.street),
      city:           optStr(ld.city),
      state:          optStr(ld.state),
      postalCode:     optStr(ld.postalCode),
      country:        optStr(ld.country),
      sex:            sexValue,
      eyeColor:       optStr(ld.eyeColor),
      hairColor:      optStr(ld.hairColor),
      height:         optStr(ld.height),
      weight:         optStr(ld.weight),
      vehicleClass:   optStr(ld.vehicleClass),
      restrictions:   optStr(ld.restrictions),
      endorsements:   optStr(ld.endorsements),
      aamvaVersion:   versionValue,
      documentType:   docTypeValue,
      mrz:            mrzValue,
      dataConfidenceJson: dataConfJson,
      cardImagePath:  cardImagePath,
      headshotImagePath: headshotImagePath
    )
  }

  // MARK: - Card image capture + headshot extraction (#92, #93)

  private static let cardImageDir: URL = {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("dlscan-cards", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()

  /// Re-run doc-seg on the original frame, expand corners by 6%, and save
  /// the padded perspective-corrected card as JPEG. The slight re-run cost
  /// (~5ms on ANE) is acceptable since this fires only once per scan.
  private static func saveRectifiedCard(
    sourceBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) -> String? {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: sourceBuffer,
                                         orientation: orientation, options: [:])
    do { try handler.perform([request]) } catch { return nil }
    guard let obs = (request.results as? [VNRectangleObservation])?.first else {
      return nil
    }

    let sourceImage = CIImage(cvPixelBuffer: sourceBuffer).oriented(orientation)
    let ext = sourceImage.extent
    guard ext.width > 0, ext.height > 0 else { return nil }

    func denorm(_ p: CGPoint) -> CGPoint {
      CGPoint(x: ext.minX + p.x * ext.width,
              y: ext.minY + p.y * ext.height)
    }
    var corners = [denorm(obs.topLeft), denorm(obs.topRight),
                   denorm(obs.bottomRight), denorm(obs.bottomLeft)]

    let cx = corners.reduce(0.0) { $0 + $1.x } / 4
    let cy = corners.reduce(0.0) { $0 + $1.y } / 4
    let pad: CGFloat = 0.06
    corners = corners.map { p in
      CGPoint(
        x: min(max(cx + (p.x - cx) * (1 + pad), ext.minX), ext.minX + ext.width),
        y: min(max(cy + (p.y - cy) * (1 + pad), ext.minY), ext.minY + ext.height)
      )
    }

    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = sourceImage
    filter.topLeft = corners[0]
    filter.topRight = corners[1]
    filter.bottomRight = corners[2]
    filter.bottomLeft = corners[3]
    guard let corrected = filter.outputImage else { return nil }

    let ctx = CIContext(options: [.useSoftwareRenderer: false])
    let correctedExt = corrected.extent.integral
    guard correctedExt.width > 1, correctedExt.height > 1 else { return nil }
    guard let cgImage = ctx.createCGImage(corrected, from: correctedExt) else {
      return nil
    }
    guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.85) else {
      return nil
    }

    let id = UUID().uuidString
    let url = cardImageDir.appendingPathComponent("\(id)-card.jpg")
    do {
      try data.write(to: url, options: .atomic)
      return url.absoluteString
    } catch {
      NSLog("[DlScan] saveRectifiedCard failed: \(error)")
      return nil
    }
  }

  /// Extract a headshot from the rectified card image.
  ///
  /// 1. Run VNDetectFaceRectanglesRequest on the rectified buffer.
  /// 2. If a face is found, crop from the buffer with a 15% margin.
  /// 3. If no face is found, fall back to the YOLO "face" class bbox.
  /// 4. Save the crop as JPEG. Return the file:// path.
  private static func extractHeadshot(
    from buffer: CVPixelBuffer,
    yoloDetections: [(name: String, bbox: CGRect, conf: Float)],
    cardImagePath: String?
  ) -> String? {
    let ciImage = CIImage(cvPixelBuffer: buffer)
    let extent = ciImage.extent
    guard extent.width > 0 && extent.height > 0 else { return nil }

    // Try platform face detection first (higher quality, tighter crop).
    var faceBounds: CGRect?
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    do {
      try handler.perform([request])
      if let face = request.results?.first {
        // VNFaceObservation.boundingBox is normalized [0,1] with origin
        // at bottom-left (Core Image convention). Convert to pixel coords.
        let bb = face.boundingBox
        let x = bb.origin.x * extent.width
        let y = bb.origin.y * extent.height
        let w = bb.width * extent.width
        let h = bb.height * extent.height
        // Add 40% margin for a natural portrait crop with context.
        // Aligned with Android (review note: unintentional divergence).
        let margin = max(w, h) * 0.40
        faceBounds = CGRect(
          x: max(0, x - margin),
          y: max(0, y - margin),
          width: min(extent.width - max(0, x - margin), w + 2 * margin),
          height: min(extent.height - max(0, y - margin), h + 2 * margin)
        )
      }
    } catch {
      NSLog("[DlScan] VNDetectFaceRectanglesRequest failed: \(error)")
    }

    // Fallback: YOLO "face" class bbox (class 0). The YOLO bbox is in
    // rectified-image pixel coordinates, so no conversion needed.
    if faceBounds == nil {
      if let faceDetection = yoloDetections.first(where: { $0.name == "face" }) {
        let bb = faceDetection.bbox
        let margin = max(bb.width, bb.height) * 0.05
        faceBounds = CGRect(
          x: max(0, bb.origin.x - margin),
          y: max(0, bb.origin.y - margin),
          width: min(extent.width - max(0, bb.origin.x - margin), bb.width + 2 * margin),
          height: min(extent.height - max(0, bb.origin.y - margin), bb.height + 2 * margin)
        )
      }
    }

    guard let crop = faceBounds else { return nil }

    let ctx = CIContext(options: [.useSoftwareRenderer: false])
    let cropped = ciImage.cropped(to: crop)
    guard let cgImage = ctx.createCGImage(cropped, from: cropped.extent) else { return nil }
    let uiImage = UIImage(cgImage: cgImage)
    guard let data = uiImage.jpegData(compressionQuality: 0.85) else { return nil }

    // Derive headshot filename from card image path (same UUID prefix).
    let id: String
    if let cardPath = cardImagePath,
       let cardFile = URL(string: cardPath)?.deletingPathExtension().lastPathComponent {
      id = cardFile.replacingOccurrences(of: "-card", with: "")
    } else {
      id = UUID().uuidString
    }
    let url = cardImageDir.appendingPathComponent("\(id)-headshot.jpg")

    do {
      try data.write(to: url, options: .atomic)
      return url.absoluteString
    } catch {
      NSLog("[DlScan] extractHeadshot write failed: \(error)")
      return nil
    }
  }

  // MARK: - Diagnostic logging (task #56 — debug iPad OCR pipeline)
  //
  // Writes pipeline counters and a tail log to the app sandbox so we can
  // pull them via xcrun devicectl device copy from when device-log access
  // isn't available. Counters file: `Documents/dlscan-diag-counters.txt`,
  // tail log: `Documents/dlscan-diag-tail.log`. Both are best-effort —
  // file I/O failures are silently swallowed.
  private static let diagQueue = DispatchQueue(label: "com.dlscan.diag",
                                                qos: .utility)
  private static var diagCountersInMemory: [String: Int] = [:]
  private static var diagTailBuffer: [String] = []
  private static let diagTailMax = 200

  static func diagBumpCounter(_ key: String) {
    diagQueue.async {
      diagCountersInMemory[key, default: 0] += 1
      writeCountersFile()
    }
  }

  static func diagLog(_ message: String) {
    let stamped = "\(Date().timeIntervalSince1970): \(message)"
    diagQueue.async {
      diagTailBuffer.append(stamped)
      if diagTailBuffer.count > diagTailMax {
        diagTailBuffer.removeFirst(diagTailBuffer.count - diagTailMax)
      }
      writeTailFile()
    }
  }

  private static func diagDocumentsURL() -> URL? {
    return FileManager.default.urls(for: .documentDirectory,
                                    in: .userDomainMask).first
  }

  private static func writeCountersFile() {
    guard let dir = diagDocumentsURL() else { return }
    let url = dir.appendingPathComponent("dlscan-diag-counters.txt")
    let sorted = diagCountersInMemory.sorted { $0.key < $1.key }
    let text = sorted.map { "\($0.key)\t\($0.value)" }.joined(separator: "\n") + "\n"
    try? text.write(to: url, atomically: true, encoding: .utf8)
  }

  private static var rectifiedDumped = false

  static func dumpRectifiedOnce(buffer: CVPixelBuffer) {
    diagQueue.async {
      if rectifiedDumped { return }
      rectifiedDumped = true
      guard let dir = diagDocumentsURL() else { return }
      let url = dir.appendingPathComponent("dlscan-diag-rectified.jpg")
      let w = CVPixelBufferGetWidth(buffer)
      let h = CVPixelBufferGetHeight(buffer)
      let ci = CIImage(cvPixelBuffer: buffer)
      let ctx = CIContext(options: nil)
      guard let cg = ctx.createCGImage(ci, from: CGRect(x: 0, y: 0, width: w, height: h)) else {
        diagLog("dumpRectified: createCGImage failed (" + String(w) + "x" + String(h) + ")")
        return
      }
      let ui = UIImage(cgImage: cg)
      if let data = ui.jpegData(compressionQuality: 0.7) {
        try? data.write(to: url)
        diagLog("dumpRectified: wrote " + String(data.count) + " bytes (" + String(w) + "x" + String(h) + ")")
      } else {
        diagLog("dumpRectified: jpegData(nil)")
      }
    }
  }

  private static func writeTailFile() {
    guard let dir = diagDocumentsURL() else { return }
    let url = dir.appendingPathComponent("dlscan-diag-tail.log")
    let text = diagTailBuffer.joined(separator: "\n") + "\n"
    try? text.write(to: url, atomically: true, encoding: .utf8)
  }

}
