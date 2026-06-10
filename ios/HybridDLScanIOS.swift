import Foundation
import NitroModules
import CxxStdlib
import Vision
import DataDetection
import CoreImage
import CoreImage.CIFilterBuiltins
import VisionCamera
import UIKit

/// Swift implementation of the DLScan Nitro HybridObject.
///
/// Two scan modes:
///   1. parseBarcodeData — AAMVA-encoded PDF417 string parsing. Delegates
///      directly to the C++ core (dlscan::parse_aamva). 66 GoogleTest cases
///      cover this same C++ code on CI.
///
///   2. Front-of-card OCR — JS-orchestrated (react-native-fast-tflite). JS
///      drives a two-call pipeline per frame:
///        a. rectifyFrame — VNDetectDocumentSegmentationRequest →
///           perspective-corrected card image, returned to JS as RGB8 + token
///        b. JS runs the NanoDet field detector via react-native-fast-tflite
///           (preprocessFieldInput/decodeFieldOutput bridge the shared C++)
///        c. ocrExtractFields(token, detections) — per-region
///           VNRecognizeTextRequest → demographic parse → voter →
///           dlscan::extract_fields_from_candidates → LicenseDataSpec
///
/// The legacy native field-detection path (a bundled YOLOv8n Core ML model
/// run inside recognizeLicenseFields) was removed in favour of the
/// JS-orchestrated NanoDet path above.
///
/// Registration is handled automatically by the auto-generated
/// DLScanAutolinking.mm. Host apps do NOT call any registration function.
class HybridDLScanIOS: HybridDLScanSpec {

  // MARK: - OCR / scan-session state

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
  private let voter = FieldVoter(maxVotes: 20, minVotes: 2)

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
    /// iOS 26+ Vision RecognizeDocumentsRequest DataDetector hits (#124).
    /// Finalization-pass-only; merged FILL-ONLY by the C++ resolver.
    static let dataDetector: Int32 = 5
  }

  /// dlscan::FieldId raw values for the DataDetector-only external fields
  /// (#124 — see cpp/license_data.hpp). street reuses List8f (81); the
  /// date candidates are deliberately UNASSIGNED — the C++ merge applies
  /// the spike-validated {DOB, ISS, EXP} ordering rule, fail-closed.
  private enum ExternalFieldId {
    static let street: Int32 = 81        // FieldId::List8f
    static let city: Int32 = 110         // FieldId::City
    static let state: Int32 = 111        // FieldId::State
    static let postalCode: Int32 = 112   // FieldId::PostalCode
    static let detectedDate: Int32 = 120 // FieldId::DetectedDate
  }

  final class FieldVoter {
    private let handle: OpaquePointer

    init(maxVotes: Int = 20, minVotes: Int = 2) {
      // dlscan_voter_new returns nullptr on allocation failure; cast as
      // OpaquePointer? for Swift safety, force-unwrap because the heap
      // allocation is essentially infallible at this scale.
      self.handle = OpaquePointer(
        dlscan_voter_new(Int32(maxVotes), Int32(minVotes)))!
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
  private var cardCapturedThisSession = false

  // MARK: - JS-orchestration rectify cache (guarded by rectifyLock)
  // rectifyFrame() exposes the rectified RGB to JS for fast-tflite NanoDet
  // detection; ocrExtractFields() consumes the JS detections against the cached
  // buffers (source + rectified) keyed by token. Replaces the native runYOLO.
  private let rectifyLock = NSLock()
  private var lastRectifyTime: CFAbsoluteTime = 0
  private var nextRectifyToken: Double = 1
  private var rectifiedCache:
    [Double: (source: CVPixelBuffer, orientation: CGImagePropertyOrientation, rectified: CVPixelBuffer)] = [:]

  // MARK: - TTA-as-verification retained crop (guarded by rectifyLock)
  // The BEST captured card crop — the consensus rectified RGB buffer kept on the
  // frame that saved cardImagePath. runTtaVerification() re-OCRs augmented copies
  // of this to recover small glyphs a single OCR pass misses. Retained as RGB8
  // bytes (row-major, 3 B/px) so the shared C++ dlscan_augment_rgb can augment it
  // and rgb8ToPixelBuffer() can rebuild a buffer for the whole-card OCR stage.
  // Replaced on each new consensus crop; cleared in resetLicenseFieldRecognition.
  private var ttaRetainedRGB: [UInt8]? = nil
  private var ttaRetainedWidth: Int = 0
  private var ttaRetainedHeight: Int = 0

  private var _scanProgress: Double = 0.0
  var scanProgress: Double { _scanProgress }

  private var _pipelineStage: Double = 0.0
  var pipelineStage: Double { _pipelineStage }

  private var _detectedCardCorners: [Double] = []
  var detectedCardCorners: [Double] { _detectedCardCorners }

  /// Cached CIContext for perspective-correction rendering. Created lazily.
  private let renderContext = CIContext()

  // MARK: - HybridDLScanSpec

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
      let spec = HybridDLScanIOS.toLicenseDataSpec(cppData)
      return Variant_NullType_LicenseDataSpec.second(spec)
    }
  }

  /// Reset all scan-session state for the JS-orchestrated OCR path. Called by
  /// JS when the consumer's scan session ends (or on hook mount) so the next
  /// scan starts fresh — without this, a stale rectified buffer, a half-filled
  /// voter, or last session's progress/corners could bleed into the new scan.
  func resetLicenseFieldRecognition() throws {
    cardCapturedThisSession = false
    _scanProgress = 0.0
    _pipelineStage = 0.0
    _detectedCardCorners = []
    // Clear the multi-frame voter so the next scan starts fresh.
    voter.reset()
    // Clear the JS-orchestration rectify cache so stale source/rectified buffers
    // don't survive a scan-session boundary; reset the throttle clock too.
    rectifyLock.lock()
    rectifiedCache.removeAll()
    lastRectifyTime = 0
    // Drop the retained TTA crop so a stale card from the previous session
    // can't be re-OCR'd into the next scan's result.
    ttaRetainedRGB = nil
    ttaRetainedWidth = 0
    ttaRetainedHeight = 0
    rectifyLock.unlock()
  }

  // MARK: - Unified TFLite runtime (react-native-fast-tflite), JS-orchestrated

  // JS loads the models (loadTensorflowModel) and calls model.runSync; these
  // bridge the shared, tested C++ pre/post via the detect_c C-ABI. No
  // fast-tflite type is referenced here — a 5-cycle iOS build proved the
  // c++-only TfliteModel cannot be passed into a Swift HybridObject (fails at
  // both the <NitroTflite/...> C++ include and the Swift `any
  // HybridTfliteModelSpec` type). See docs/.../2026-05-30-ios-build-findings.md.
  //
  // UNVALIDATED against a device build: the ArrayBuffer `.data`/`.size` access
  // and the C-ABI pointer binding below are best-effort against the detect_c.hpp
  // signatures and must be confirmed/adjusted on the first example compile.

  func preprocessFieldInput(rgb: ArrayBuffer, width: Double, height: Double) throws -> ArrayBuffer {
    let floats = 3 * 416 * 416
    let out = ArrayBuffer.allocate(size: floats * MemoryLayout<Float>.stride)
    var sx: Float = 0, sy: Float = 0
    _ = dlscan_preprocess_field(
      rgb.data,
      rgb.size,
      Int32(width), Int32(height), 416,
      UnsafeMutableRawPointer(out.data).assumingMemoryBound(to: Float.self), floats, &sx, &sy)
    return out
  }

  func decodeFieldOutput(
    output: ArrayBuffer, scaleX: Double, scaleY: Double
  ) throws -> [FieldDetectionSpec] {
    let cap = 100
    var cls = [Int32](repeating: 0, count: cap)
    var conf = [Float](repeating: 0, count: cap)
    var x1 = [Float](repeating: 0, count: cap), y1 = [Float](repeating: 0, count: cap)
    var x2 = [Float](repeating: 0, count: cap), y2 = [Float](repeating: 0, count: cap)
    let n = dlscan_decode_field(
      UnsafeMutableRawPointer(output.data).assumingMemoryBound(to: Float.self),
      output.size / MemoryLayout<Float>.stride,
      Float(scaleX), Float(scaleY),
      &cls, &conf, &x1, &y1, &x2, &y2, cap)
    var out: [FieldDetectionSpec] = []
    for i in 0..<min(Int(n), cap) {
      out.append(FieldDetectionSpec(
        classId: Double(cls[i]), confidence: Double(conf[i]),
        x1: Double(x1[i]), y1: Double(y1[i]), x2: Double(x2[i]), y2: Double(y2[i])))
    }
    return out
  }

  func preprocessDocAlignerInput(rgb: ArrayBuffer, width: Double, height: Double) throws -> ArrayBuffer {
    let floats = 3 * 256 * 256
    let out = ArrayBuffer.allocate(size: floats * MemoryLayout<Float>.stride)
    _ = dlscan_preprocess_docaligner(
      rgb.data,
      rgb.size,
      Int32(width), Int32(height), 256,
      UnsafeMutableRawPointer(out.data).assumingMemoryBound(to: Float.self), floats)
    return out
  }

  func decodeCorners(output: ArrayBuffer) throws -> [Double] {
    var xs = [Float](repeating: 0, count: 4), ys = [Float](repeating: 0, count: 4)
    let ok = dlscan_decode_corners(
      UnsafeMutableRawPointer(output.data).assumingMemoryBound(to: Float.self),
      output.size / MemoryLayout<Float>.stride, &xs, &ys)
    if ok == 0 { return [] }
    var out: [Double] = []
    for i in 0..<4 { out.append(Double(xs[i])); out.append(Double(ys[i])) }
    return out
  }

  // MARK: - JS-orchestration: rectify + ocr-with-detections

  /// Convert a 32BGRA CVPixelBuffer into a row-major RGB8 ArrayBuffer (3 B/px).
  private func pixelBufferToRGB8(_ buffer: CVPixelBuffer) -> (rgb: ArrayBuffer, width: Int, height: Int)? {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let w = CVPixelBufferGetWidth(buffer)
    let h = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let src = base.assumingMemoryBound(to: UInt8.self)
    let out = ArrayBuffer.allocate(size: w * h * 3)
    let dst = out.data
    var di = 0
    for y in 0..<h {
      let row = src + y * stride
      var xi = 0
      for _ in 0..<w {
        dst[di] = row[xi + 2]      // R (source is BGRA)
        dst[di + 1] = row[xi + 1]  // G
        dst[di + 2] = row[xi]      // B
        di += 3
        xi += 4
      }
    }
    return (out, w, h)
  }

  /// Convert a 32BGRA CVPixelBuffer into a row-major RGB8 `[UInt8]` (3 B/px).
  /// Same packing as pixelBufferToRGB8 but into a Swift array the TTA path can
  /// retain across calls and feed to dlscan_augment_rgb. nil on lock failure.
  private func pixelBufferToRGB8Bytes(_ buffer: CVPixelBuffer) -> (rgb: [UInt8], width: Int, height: Int)? {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let w = CVPixelBufferGetWidth(buffer)
    let h = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let src = base.assumingMemoryBound(to: UInt8.self)
    var out = [UInt8](repeating: 0, count: w * h * 3)
    var di = 0
    for y in 0..<h {
      let row = src + y * stride
      var xi = 0
      for _ in 0..<w {
        out[di] = row[xi + 2]      // R (source is BGRA)
        out[di + 1] = row[xi + 1]  // G
        out[di + 2] = row[xi]      // B
        di += 3
        xi += 4
      }
    }
    return (out, w, h)
  }

  /// Build a 32BGRA CVPixelBuffer from row-major RGB8 bytes (3 B/px). The TTA
  /// pass augments the retained RGB then needs a CVPixelBuffer to hand to
  /// VisionKit OCR. Inverse of pixelBufferToRGB8Bytes. nil on allocation /
  /// lock failure or short input.
  private func rgb8ToPixelBuffer(_ rgb: [UInt8], width w: Int, height h: Int) -> CVPixelBuffer? {
    guard w > 0, h > 0, rgb.count >= w * h * 3 else { return nil }
    let attrs: [String: Any] = [
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]
    ]
    var bufferOut: CVPixelBuffer?
    let status = CVPixelBufferCreate(kCFAllocatorDefault, w, h,
                                     kCVPixelFormatType_32BGRA,
                                     attrs as CFDictionary, &bufferOut)
    guard status == kCVReturnSuccess, let buffer = bufferOut else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let dst = base.assumingMemoryBound(to: UInt8.self)
    rgb.withUnsafeBufferPointer { srcBuf in
      guard let src = srcBuf.baseAddress else { return }
      var si = 0
      for y in 0..<h {
        let row = dst + y * stride
        var xi = 0
        for _ in 0..<w {
          row[xi]     = src[si + 2]  // B
          row[xi + 1] = src[si + 1]  // G
          row[xi + 2] = src[si]      // R
          row[xi + 3] = 255          // A
          si += 3
          xi += 4
        }
      }
    }
    return buffer
  }

  /// UIDevice orientation -> CGImagePropertyOrientation for the back-camera
  /// sensor buffer (mirrors recognizeLicenseFields).
  private func currentFrameOrientation() -> CGImagePropertyOrientation {
    switch UIDevice.current.orientation {
    case .portrait:           return .right
    case .portraitUpsideDown: return .left
    case .landscapeLeft:      return .up
    case .landscapeRight:     return .down
    default:                  return .right
    }
  }

  func rectifyFrame(frame: any HybridFrameSpec) throws -> Variant_NullType_RectifiedFrameSpec {
    let now = CFAbsoluteTimeGetCurrent()
    rectifyLock.lock()
    let throttled = (now - lastRectifyTime) < 0.3
    rectifyLock.unlock()
    if throttled { return .first(.null) }

    guard let nativeFrame = frame as? any NativeFrame,
          let sampleBuffer = nativeFrame.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return .first(.null)
    }
    let orientation = currentFrameOrientation()
    guard let rectified = runDocSeg(buffer: pixelBuffer, orientation: orientation) else {
      _scanProgress = max(_scanProgress, 0.02)
      return .first(.null)
    }
    guard let conv = pixelBufferToRGB8(rectified) else { return .first(.null) }

    rectifyLock.lock()
    lastRectifyTime = now
    let token = nextRectifyToken
    nextRectifyToken += 1
    rectifiedCache[token] = (source: pixelBuffer, orientation: orientation, rectified: rectified)
    if rectifiedCache.count > 4, let oldest = rectifiedCache.keys.min() {
      rectifiedCache.removeValue(forKey: oldest)
    }
    rectifyLock.unlock()
    _scanProgress = max(_scanProgress, 0.05)
    return .second(RectifiedFrameSpec(rgb: conv.rgb,
                                      width: Double(conv.width),
                                      height: Double(conv.height),
                                      token: token))
  }

  func ocrExtractFields(token: Double,
                        detections: [FieldDetectionSpec]) throws -> Variant_NullType_LicenseDataSpec {
    rectifyLock.lock()
    let entry = rectifiedCache.removeValue(forKey: token)
    rectifyLock.unlock()
    guard let entry else { return .first(.null) }
    let rectified = entry.rectified

    let dets = Self.mapDetections(detections)
    if dets.isEmpty { return .first(.null) }

    // Steps 3..5 of the former runDetectionPipeline, detections now JS-provided.
    let observations = runVisionKitWithBboxes(on: rectified, orientation: .up)
    if observations.isEmpty { return .first(.null) }
    // Feed the shared C++ marker parser the RAW whole-card observations (it does
    // its own marker tokenization, fused-row extraction, and 1-step look-ahead
    // linkage internally — exactly like Android, which passes observations.map {
    // it.text }). Pre-splitting here broke fused-row sex (marker 15) and dob
    // (marker 3) on iOS only — the iOS/Android drift that made the shared C++
    // test pass while the device failed. See cpp/tests/aamva_demographic_test.
    let demographicCandidates = Self.parseAamvaDemographicFields(observations)
    let splitObservations = Self.splitObservationsByAamvaIndices(observations)
    let detectedState = Self.detectState(observations: splitObservations)
    let bboxCandidates = runVisionKitPerRegion(on: rectified,
                                               detections: dets,
                                               orientation: .up,
                                               detectedState: detectedState)
    let frameCandidates = bboxCandidates + demographicCandidates
    voter.accept(frameCandidates)
    let consensus = voter.consensus()
    let totalExpected: Double = 14
    let stabilized = Double(Set(consensus.map { $0.fieldId }).count)
    _scanProgress = min(max(_scanProgress, 0.10 + (stabilized / totalExpected) * 0.85), 1.0)
    if consensus.isEmpty { return .first(.null) }

    _pipelineStage = 1
    guard let cppData = Self.extractFromCandidates(consensus) else { return .first(.null) }
    _pipelineStage = 2

    var cardPath: String? = nil
    var cardObservations: [OcrObservationSpec]? = nil
    var headshotPath: String? = nil
    if !cardCapturedThisSession {
      cardCapturedThisSession = true
      _pipelineStage = 3
      if let saved = Self.saveRectifiedCard(sourceBuffer: entry.source, orientation: entry.orientation) {
        cardPath = saved.path
        cardObservations = saved.observations
      }
      _pipelineStage = 4
      headshotPath = Self.extractHeadshot(from: rectified, yoloDetections: dets, cardImagePath: cardPath)
      _pipelineStage = 5
      // Retain THIS consensus crop (the rectified RGB) as the best card for the
      // optional TTA verification pass. Convert once to RGB8 bytes so
      // dlscan_augment_rgb + rgb8ToPixelBuffer can drive the augmented re-OCR
      // without holding a CVPixelBuffer alive across the bridge.
      if let conv = pixelBufferToRGB8Bytes(rectified) {
        rectifyLock.lock()
        ttaRetainedRGB = conv.rgb
        ttaRetainedWidth = conv.width
        ttaRetainedHeight = conv.height
        rectifyLock.unlock()
      }
    }
    let spec = Self.toLicenseDataSpec(cppData,
                                      cardImagePath: cardPath,
                                      ocrObservations: cardObservations,
                                      headshotImagePath: headshotPath)
    return .second(spec)
  }

  /// Images-only capture (no OCR): the dedicated entry behind the JS
  /// `completion.capture: 'imagesOnly'` mode. Rides the exact same
  /// rectify -> NanoDet-detect entry as `ocrExtractFields` — same token
  /// lookup, same non-empty-detections quality gate (detections prove a
  /// recognizable card front is in frame AND feed the YOLO-face headshot
  /// fallback) — then short-circuits straight to the once-per-session
  /// card-image save + headshot extraction. No OCR text recognition, no C++
  /// parse, no voting, and no TTA-crop retention run.
  ///
  /// Latch discipline differs deliberately from the full path: the full path
  /// latches `cardCapturedThisSession` BEFORE attempting the save (a failed
  /// save there still returns field data, the image is just absent), but here
  /// the saved card IS the scan result, so the latch is only set AFTER
  /// `saveRectifiedCard` succeeds — a failed save returns null and the next
  /// frame retries the capture.
  func captureFrontImages(token: Double,
                          detections: [FieldDetectionSpec]) throws -> Variant_NullType_LicenseDataSpec {
    rectifyLock.lock()
    let entry = rectifiedCache.removeValue(forKey: token)
    rectifyLock.unlock()
    guard let entry else { return .first(.null) }

    let dets = Self.mapDetections(detections)
    if dets.isEmpty { return .first(.null) }
    if cardCapturedThisSession { return .first(.null) }

    _pipelineStage = 3
    guard let saved = Self.saveRectifiedCard(sourceBuffer: entry.source,
                                             orientation: entry.orientation,
                                             withObservations: false) else {
      _pipelineStage = 0
      return .first(.null)
    }
    cardCapturedThisSession = true
    _pipelineStage = 4
    let headshotPath = Self.extractHeadshot(from: entry.rectified,
                                            yoloDetections: dets,
                                            cardImagePath: saved.path)
    _pipelineStage = 5
    _scanProgress = 1.0
    return .second(Self.imagesOnlyLicenseDataSpec(cardImagePath: saved.path,
                                                  headshotImagePath: headshotPath))
  }

  /// Map JS NanoDet detections (classId + rectified-image-pixel bbox) into the
  /// internal (name, bbox, conf) tuples the OCR/headshot stages consume.
  /// Shared by `ocrExtractFields` and `captureFrontImages`.
  private static func mapDetections(
    _ detections: [FieldDetectionSpec]
  ) -> [(name: String, bbox: CGRect, conf: Float)] {
    var dets: [(name: String, bbox: CGRect, conf: Float)] = []
    dets.reserveCapacity(detections.count)
    for d in detections {
      let name = String(cString: dlscan.yolo.class_name_or_empty(Int32(d.classId)))
      if name.isEmpty { continue }
      dets.append((name: name,
                   bbox: CGRect(x: CGFloat(d.x1), y: CGFloat(d.y1),
                                width: CGFloat(max(0, d.x2 - d.x1)),
                                height: CGFloat(max(0, d.y2 - d.y1))),
                   conf: Float(d.confidence)))
    }
    return dets
  }

  /// All-fields-absent LicenseDataSpec carrying only the captured image paths —
  /// the images-only capture result shape (field values null by contract).
  private static func imagesOnlyLicenseDataSpec(
    cardImagePath: String?,
    headshotImagePath: String?
  ) -> LicenseDataSpec {
    return LicenseDataSpec(
      firstName: nil, lastName: nil, middleName: nil, dateOfBirth: nil,
      expirationDate: nil, issueDate: nil, licenseNumber: nil, street: nil,
      city: nil, state: nil, postalCode: nil, country: nil, sex: nil,
      eyeColor: nil, hairColor: nil, height: nil, weight: nil,
      vehicleClass: nil, restrictions: nil, endorsements: nil,
      aamvaVersion: nil, documentType: nil, mrz: nil, dataConfidenceJson: nil,
      cardImagePath: cardImagePath, ocrObservations: nil,
      headshotImagePath: headshotImagePath
    )
  }

  /// Shared C++ field extraction from a typed FieldCandidate consensus. Builds
  /// the C++ FieldCandidateVector and runs `extract_fields_from_candidates`.
  /// Factored out of `ocrExtractFields` so the TTA verification pass reuses the
  /// exact same vote->extract sequence. Returns nil when the extractor yields
  /// no LicenseData.
  private static func extractFromCandidates(
    _ candidates: [FieldCandidate]
  ) -> dlscan.LicenseData? {
    var cppVec = dlscan.FieldCandidateVector()
    for c in candidates {
      var cppC = dlscan.FieldCandidate()
      cppC.id = dlscan.FieldId(rawValue: c.fieldId) ?? dlscan.FieldId.Unknown
      cppC.source = dlscan.FieldSource(rawValue: c.source) ?? dlscan.FieldSource.Unknown
      cppC.text = std.string(c.text)
      cppVec.push_back(cppC)
    }
    let cppResult = dlscan.extract_fields_from_candidates(cppVec)
    return Optional(fromCxx: cppResult)
  }

  /// Whole-card strict-pool candidates for a rectified buffer: VisionKit OCR,
  /// AAMVA-index split, then the demographic strict parse (which internally also
  /// scans for class + city/state/zip). This is the field-detector-free subset
  /// of `ocrExtractFields`'s candidate sourcing — the only path the TTA
  /// verification pass needs, since the augmented crop has no detections.
  private func wholeCardStrictCandidates(on buffer: CVPixelBuffer) -> [FieldCandidate] {
    let observations = runVisionKitWithBboxes(on: buffer, orientation: .up)
    if observations.isEmpty { return [] }
    let split = Self.splitObservationsByAamvaIndices(observations)
    return Self.parseAamvaDemographicFields(split)
  }

  /// TTA-as-verification pass. ADDITIVE + opt-in (JS calls this only when the
  /// consumer enables `completion.tta`, after the normal scan completes).
  /// Re-OCRs the retained best card crop under each requested augmentation
  /// (dlscan_augment_rgb), votes the augmented frames with a FRESH voter, and
  /// returns the voted LicenseDataSpec. Returns nil when no crop is retained or
  /// the augmented frames produce no consensus. Does NOT touch the live scan
  /// voter or re-save card/headshot images.
  func runTtaVerification(modes: [Double]) throws -> Variant_NullType_LicenseDataSpec {
    rectifyLock.lock()
    let retained = ttaRetainedRGB
    let w = ttaRetainedWidth
    let h = ttaRetainedHeight
    rectifyLock.unlock()
    guard let retained, w > 0, h > 0, retained.count >= w * h * 3 else {
      return .first(.null)
    }

    let ttaVoter = FieldVoter(maxVotes: 20, minVotes: 1)
    var out = [UInt8](repeating: 0, count: w * h * 3)
    var anyFrame = false
    for modeD in modes {
      let mode = Int32(modeD)
      let written: Int = retained.withUnsafeBufferPointer { inBuf in
        out.withUnsafeMutableBufferPointer { outBuf in
          dlscan_augment_rgb(inBuf.baseAddress, inBuf.count,
                             Int32(w), Int32(h), mode,
                             outBuf.baseAddress, outBuf.count)
        }
      }
      if written != w * h * 3 { continue }  // unknown mode / bad dims — skip
      guard let augBuffer = rgb8ToPixelBuffer(out, width: w, height: h) else { continue }
      let candidates = wholeCardStrictCandidates(on: augBuffer)
      if candidates.isEmpty { continue }
      ttaVoter.accept(candidates)
      anyFrame = true
    }
    if !anyFrame { return .first(.null) }
    let consensus = ttaVoter.consensus()
    if consensus.isEmpty { return .first(.null) }
    // #124: iOS 26+ DataDetector candidate source. ONE RecognizeDocuments-
    // Request call on the SAME retained best crop — finalization only,
    // never per-frame (spike measured ~400 ms), and only once the
    // finalization parse actually has a consensus to enrich (the
    // pair-review hardening: an auxiliary source must never create a scan
    // result by itself; the C++ resolver enforces the same enrich-only
    // rule). Availability-gated with the existing pipeline as the
    // unchanged fallback. The candidates merge FILL-ONLY in the C++
    // resolver (FieldSource::DataDetector): they fill empty fields at
    // ShapeMatched or upgrade an agreeing populated field to
    // CrossValidated, but never replace or delete. They deliberately
    // bypass the voter — a single-shot source has nothing to vote on.
    var ddCandidates: [FieldCandidate] = []
    // compiler(>=6.2) == Xcode 26+: RecognizeDocumentsRequest only exists in
    // the iOS 26 SDK, so consumers building with older Xcode must compile
    // the library WITHOUT this source (the runtime #available alone doesn't
    // help them — the symbols wouldn't resolve at compile time).
    #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        if let rdrBuffer = rgb8ToPixelBuffer(retained, width: w, height: h) {
          ddCandidates = Self.runRecognizeDocumentsCandidates(on: rdrBuffer)
        }
      }
    #endif
    guard let cppData = Self.extractFromCandidates(consensus + ddCandidates) else {
      return .first(.null)
    }
    // No card/headshot re-capture — verification reuses the already-saved crop.
    return .second(Self.toLicenseDataSpec(cppData))
  }

  // MARK: - #124: iOS 26+ RecognizeDocumentsRequest DataDetector source

  // Whole section requires the iOS 26 SDK (Xcode 26 / Swift 6.2) — see the
  // matching guard at the call site in runTtaVerification.
  #if compiler(>=6.2)

  /// One-shot RecognizeDocumentsRequest over the retained best crop.
  /// Synchronous wrapper: runTtaVerification is a sync Nitro method already
  /// running off the JS thread, so blocking this thread on a semaphore while
  /// the async Vision request runs on the global executor is acceptable —
  /// the augmented re-OCR passes above it block for similar durations.
  /// Returns [] on any failure (fail-closed: the scan result is then exactly
  /// what the existing pipeline produced).
  @available(iOS 26.0, *)
  private static func runRecognizeDocumentsCandidates(
    on buffer: CVPixelBuffer
  ) -> [FieldCandidate] {
    final class ResultBox: @unchecked Sendable {
      var candidates: [FieldCandidate] = []
    }
    let box = ResultBox()
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached(priority: .userInitiated) {
      defer { semaphore.signal() }
      var request = RecognizeDocumentsRequest()
      // Parity with the whole-card OCR pass (and the #124 spike harness).
      request.textRecognitionOptions.useLanguageCorrection = true
      guard let observations = try? await request.perform(on: buffer),
            let document = observations.first?.document else { return }
      box.candidates = Self.dataDetectorCandidates(from: document)
    }
    // Bounded wait (review hardening): a hung Vision request must degrade to
    // "no auxiliary evidence", never hang scan finalization. 5 s is >10x the
    // measured p99 (~660 ms in the #124 spike).
    if semaphore.wait(timeout: .now() + 5.0) == .timedOut {
      return []
    }
    return box.candidates
  }

  /// Convert a recognized document's DataDetector matches into external
  /// FieldCandidates for the C++ resolver:
  ///   • every DEDUPED `.calendarEvent` date → FieldId::DetectedDate (120)
  ///     as ISO yyyy-MM-dd, deliberately UNASSIGNED — the C++ merge applies
  ///     the {DOB, ISS, EXP} ordering rule and skips unless exactly three
  ///     distinct dates survive (fail-closed, no guessing).
  ///   • every DEDUPED `.postalAddress` → its PRE-SPLIT sub-fields
  ///     (street → List8f, city/state/postalCode → the DataDetector-only
  ///     ids). Partial addresses emit only the sub-fields present; if
  ///     multiple distinct addresses yield conflicting values for a
  ///     sub-field, the C++ merge skips that sub-field.
  @available(iOS 26.0, *)
  static func dataDetectorCandidates(
    from document: DocumentObservation.Container
  ) -> [FieldCandidate] {
    // Collect DataDetector matches from the doc-level text AND every
    // paragraph / table-cell / list-item container. The spike found the
    // same match reported under both the doc container and its owning
    // paragraph (hence the dedupe), while container-scoped matches don't
    // always surface at doc level.
    var texts: [DocumentObservation.Container.Text] = [document.text]
    texts.append(contentsOf: document.paragraphs)
    for table in document.tables {
      for row in table.rows {
        for cell in row {
          texts.append(cell.content.text)
        }
      }
    }
    for list in document.lists {
      for item in list.items {
        texts.append(item.content.text)
      }
    }

    struct AddressParts: Hashable {
      let street: String?
      let city: String?
      let state: String?
      let postalCode: String?
    }
    // ISO yyyy-MM-dd in the CURRENT timezone. DataDetector anchors a printed
    // card date ("04/15/1990") at local midnight, so formatting back in the
    // local timezone round-trips the printed date (spike-verified; the UTC
    // rendering shifts a day for timezones ahead of UTC). Per-call instance
    // (pair-review): finalization runs once per scan, so the alloc is noise
    // and there is zero shared mutable state to reason about.
    let dateFormatter = DateFormatter()
    dateFormatter.locale = Locale(identifier: "en_US_POSIX")
    dateFormatter.dateFormat = "yyyy-MM-dd"
    var isoDates: [String] = []
    var seenDates = Set<String>()
    var addresses: [AddressParts] = []
    var seenAddresses = Set<AddressParts>()
    for text in texts {
      for detected in text.detectedData {
        switch detected.match.details {
        case .calendarEvent(let event):
          guard let date = event.startDate else { continue }
          let iso = dateFormatter.string(from: date)
          if seenDates.insert(iso).inserted { isoDates.append(iso) }
        case .postalAddress(let address):
          let parts = AddressParts(street: address.street,
                                   city: address.city,
                                   state: address.state,
                                   postalCode: address.postalCode)
          if seenAddresses.insert(parts).inserted { addresses.append(parts) }
        default:
          continue  // links / phones / money / etc. — not card fields
        }
      }
    }

    var out: [FieldCandidate] = []
    for iso in isoDates {
      out.append(FieldCandidate(fieldId: ExternalFieldId.detectedDate,
                                source: FieldSource.dataDetector,
                                text: iso))
    }
    for address in addresses {
      let subfields: [(Int32, String?)] = [
        (ExternalFieldId.street, address.street),
        (ExternalFieldId.city, address.city),
        (ExternalFieldId.state, address.state),
        (ExternalFieldId.postalCode, address.postalCode),
      ]
      for (fieldId, value) in subfields {
        guard let value, !value.isEmpty else { continue }
        out.append(FieldCandidate(fieldId: fieldId,
                                  source: FieldSource.dataDetector,
                                  text: value))
      }
    }
    return out
  }

  #endif  // compiler(>=6.2) — #124 RecognizeDocumentsRequest section

  // MARK: - Detection pipeline

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
      NSLog("[DLScan] VNDetectDocumentSegmentationRequest threw: \(error)")
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
    // Tight ROI crop — a wider crop over-captures neighbouring rows/columns
    // (observed: city="100 EXP ...", class="ASS" from "CLASS"). Edge-clipped
    // names/DLN are recovered via the whole-card STRICT AAMVA-index parse
    // (list_1_strict/list_2_strict/list_4d_strict), not by padding here.
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
  /// `HybridDLScanAndroid.expectedAamvaIndex`.
  private static let expectedAamvaIndex: [String: String] = [
    "surname":      "1",   // international class over the AAMVA family-name row
    "given_name":   "2",   // international class over the AAMVA given-name row
    "personal_num": "4d",  // international class over the AAMVA DLN row
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
  /// `HybridDLScanAndroid.dropOnIndexMismatch`. The demographic/appearance
  /// fields use this; name/address/license classes keep the legacy
  /// "return unchanged" behavior so legitimate cases like "12 MAIN ST"
  /// accidentally matched to list_8s aren't erased.
  private static let dropOnIndexMismatch: Set<String> = [
    "surname", "given_name", "personal_num", "country",
    "list_1", "list_2", "list_3", "list_4a", "list_4b", "list_4d",
    "list_8f", "list_8s", "list_9", "list_9a", "list_12",
    "list_15", "list_16", "list_17", "list_18", "list_19",
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
    // string used by HybridDLScanAndroid.kt, where it IS covered by JVM
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
  /// Mirrors `HybridDLScanAndroid.tightenByContentShape` with one review-
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
  /// HybridDLScanAndroid.splitObservationByAamvaIndices.
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

  /// Demographic text-pool parser. Thin Swift adapter over the shared C++
  /// `dlscan::parse_aamva_demographic_fields` — the marker-anchored 4-gate
  /// strict scan now lives in ONE place (cpp/ocr/ocr_field_extractor.cpp) so
  /// iOS and Android share identical behaviour and a single host-unit-test
  /// regression (cpp/tests/aamva_demographic_test.cpp). This adapter only
  /// extracts the observation texts (bbox geometry isn't needed for the
  /// text-only marker parse) and bridges the typed FieldCandidate vector
  /// back into Swift's mirror struct.
  ///
  /// The C++ parser owns: the 1-step look-ahead that links a bare "4d"
  /// marker to its value on the NEXT observation, the fused-row marker
  /// extraction (sex single-[MFX] out of "15 SEX M 18 HOT ..."), the
  /// name-marker-2 trailing-junk strip ("MARCUS ANTOINE ON PA" ->
  /// "MARCUS ANTOINE"), and the scanForClass / scanForCityStateZip
  /// fallbacks. All previously duplicated here in Swift.
  static func parseAamvaDemographicFields(
    _ observations: [(text: String, bbox: CGRect)]
  ) -> [FieldCandidate] {
    var cppObs = dlscan.ObservationVector()
    for obs in observations {
      cppObs.push_back(std.string(obs.text))
    }
    let cppCands = dlscan.parse_aamva_demographic_fields(cppObs)
    let count = Int(cppCands.size())
    var out: [FieldCandidate] = []
    out.reserveCapacity(count)
    for i in 0..<count {
      let c = cppCands[i]
      out.append(FieldCandidate(
        fieldId: c.id.rawValue,
        source: c.source.rawValue,
        text: String(c.text)))
    }
    return out
  }

  /// Legacy Swift-native marker parser — retained ONLY as dead reference
  /// during the C++ migration; no longer called. The active path is the
  /// adapter above. Kept compiling so the per-index emit rationale stays
  /// reviewable next to the C++ port; safe to delete once the device
  /// verification of the shared C++ parser lands.
  static func parseAamvaDemographicFieldsLegacy(
    _ observations: [(text: String, bbox: CGRect)]
  ) -> [FieldCandidate] {
    // v2 Sequence G — typed return. Provenance moves from the legacy
    // `<base>_strict` key suffix to FieldSource.strictTextPool on each
    // emitted FieldCandidate. The C++ resolver still applies the
    // StrictAgrees → CrossValidated (1.00) upgrade when both strict +
    // bbox candidates converge — that's the input to the multi-source
    // tier upgrade (round-1 lock — concat, do not collapse).
    let indexToFieldId: [String: Int32] = [
      "1":  1,    // FieldId::List1   (last name)
      "2":  2,    // FieldId::List2   (first + middle name)
      "3":  3,    // FieldId::List3   (DOB)
      "4a": 41,   // FieldId::List4a  (issue date)
      "4b": 42,   // FieldId::List4b  (expiration date)
      "4d": 43,   // FieldId::List4d  (license number)
      "9":  9,    // FieldId::List9   (vehicle class)
      "12": 12,   // FieldId::List12  (restrictions)
      "15": 15,   // FieldId::List15  (sex)
      "16": 16,   // FieldId::List16  (height)
      "17": 17,   // FieldId::List17  (weight)
      "18": 18,   // FieldId::List18  (eye color)
      "19": 19,   // FieldId::List19  (hair color)
    ]
    // Carry BOTH the raw lexer token and its shape-extracted value. The
    // gate (c) runs against the CLEANED value (so a fused row like
    // "4d H200-...-07 CLASS D" or "15 SEX M 16 HGT" passes the anchored
    // domain regex), but per-index emit may prefer the raw value — e.g.
    // 4d emits the full row WITH its trailing "CLASS X" so the shared
    // C++ class-suffix peel in ocr_field_extractor recovers vehicleClass.
    var candidatesByIndex: [String: [(tok: AamvaToken, cleaned: String)]] = [:]
    for obs in observations {
      for token in AamvaLexer.findAllAamvaTokens(in: obs.text) {
        guard indexToFieldId[token.index] != nil else { continue }                       // (a)
        // round-6: label-gate downgraded from reject to signal.
        // Vision frequently mis-OCRs labels (HGT→HOT, WGT→VWGT). The
        // idx+domain combo is sufficient to accept the candidate.
        _ = AamvaLexer.isCompatibleLabel(canonicalIndex: token.index, label: token.label)
        var cleaned = token.value
          .trimmingCharacters(in: .whitespaces)
          .trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
        // round-6 follow-on: per-index value pre-extraction. OCR commonly
        // concatenates adjacent fields onto one observation; the lexer's
        // value span then includes trailing junk and the anchored dom
        // regex rejects it. Pull JUST the field-shape portion so
        // valueMatchesDomain sees a clean value. Mirrors
        // HybridDLScanAndroid.extractFieldShape.
        cleaned = Self.extractFieldShape(index: token.index, value: cleaned)
        guard AamvaLexer.valueMatchesDomain(cleaned, domainKey: token.index) else { continue } // (c)
        candidatesByIndex[token.index, default: []].append((tok: token, cleaned: cleaned))
      }
    }
    var out: [FieldCandidate] = []
    for (idx, entries) in candidatesByIndex {
      guard entries.count == 1, let fieldId = indexToFieldId[idx] else { continue }      // (d)
      // Emit JUST the lexer-bounded value (round-6 follow-on).
      // See HybridDLScanAndroid for rationale; in short: the C++
      // normalize functions need clean values, and label prefixes
      // become poison when the OCR-noise label isn't in the C++
      // strip-target list.
      let entry = entries[0]
      let v: String
      switch idx {
      case "15":
        // Sex — emit the extracted single [MFX] (uppercased). The gate
        // already reduced a fused "15 SEX M 16 HGT" to "M".
        v = entry.cleaned.uppercased().trimmingCharacters(in: .whitespaces)
      case "4d":
        // License number — emit the FULL raw row, NOT the shape-extracted
        // DLN. The cleaned value passed the domain gate, but a fused
        // "J415-2208-5573-28 CLASS D" must reach C++ intact so its
        // class-suffix peel recovers vehicleClass=D before canonicalizing
        // the DLN. The C++ license shape gate strips the suffix itself.
        v = entry.tok.value.trimmingCharacters(in: .whitespaces)
      default:
        // Preserve the prior iOS emit (raw lexer value) for fields whose
        // C++ normalizer still strips its own canonical label.
        v = entry.tok.value.trimmingCharacters(in: .whitespaces)
      }
      if !v.isEmpty {
        out.append(FieldCandidate(
          fieldId: fieldId,
          source: FieldSource.strictTextPool,
          text: v))
      }
    }

    // round-6 / task #82: text-pool fallback for vehicle class.
    // The WI DL prints `4d <DLN> CLASS <X>` on one row. When Vision fuses
    // ONLY "CLASS D" onto the DLN row and no standalone "9" index token is
    // produced, class never enters the candidate pool via the strict loop
    // above. The C++ peel recovers it from the 4d value when that value
    // survives, but if the 4d row itself is dropped (or the class lands on
    // a different observation) we still need a last resort. Scan every
    // observation for a `CLASS X` pattern; emit as StrictTextPool(List9).
    // Mirrors HybridDLScanAndroid.scanForClass.
    let emittedFieldIds = Set(out.map { $0.fieldId })
    if !emittedFieldIds.contains(9) {  // FieldId::List9
      if let cls = Self.scanForClass(observations) {
        out.append(FieldCandidate(
          fieldId: 9,
          source: FieldSource.strictTextPool,
          text: cls))
      }
    }

    // City / state / ZIP — the AAMVA "8" index is NOT printed in an
    // index-label form the demographic loop can bind (the visible card
    // shows a bare "CITY STATE ZIP" address line). Scan every observation
    // for that shape and emit it as a StrictTextPool candidate routed to
    // List8s (fieldId 82). The shared C++ extractor reads `list_8s_strict`
    // FIRST (preferred), falling back to the bbox-IoU `list_8s` crop, then
    // runs parse_city_state_zip to fill state + postalCode + city.
    if !emittedFieldIds.contains(82) {  // FieldId::List8s
      if let csz = Self.scanForCityStateZip(observations) {
        out.append(FieldCandidate(
          fieldId: 82,
          source: FieldSource.strictTextPool,
          text: csz))
      }
    }
    return out
  }

  /// Per-AAMVA-index value pre-extractor. OCR commonly concatenates
  /// adjacent fields onto one observation (WI: "16 HGT 5'-04 17 WGT 160
  /// lb", "15 SEX M 16 HGT", "4d H200-...-07 CLASS D"); the lexer's value
  /// span includes the trailing junk and the anchored dom regex rejects
  /// it. This extracts JUST the field-shape portion so the dom gate sees a
  /// clean value. Mirrors HybridDLScanAndroid.extractFieldShape (round-6
  /// design). Returns the original value unchanged when no shape applies.
  static func extractFieldShape(index: String, value: String) -> String {
    switch index {
    case "3", "4a", "4b":
      // Dates — first MM/DD/YYYY or MM-DD-YYYY.
      return Self.firstMatch(
        in: value,
        pattern: #"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})"#) ?? value
    case "16":
      // Height — first 5'-04" / 5'04" / 5-04 / \d{3}.
      return Self.firstMatch(
        in: value,
        pattern: #"(\d{1,2}'-?\s*\d{1,2}["]?|\d{1,2}-\d{1,2}|\d{3})"#) ?? value
    case "17":
      // Weight — \d{2,3} with optional unit, preferring a match that
      // carries "lb"/"lbs"/"kg".
      if let withUnit = Self.firstMatch(
        in: value,
        pattern: #"(\d{2,3})\s*(?:lbs?|kg)"#,
        caseInsensitive: true) {
        return withUnit
      }
      return Self.firstMatch(in: value, pattern: #"\b(\d{2,3})\b"#) ?? value
    case "15":
      // Sex — a single [MFX] (bounded pre-domain extraction). The fused
      // "15 SEX M 16 HGT" row reduces to "M". Prefer a token-isolated
      // letter so "M" in "MALE" or a stray height char doesn't win.
      return Self.firstMatch(
        in: value.uppercased(),
        pattern: #"\b([MFX])\b"#) ?? value
    case "12":
      // Restrictions — NONE / N/A or a single short code.
      if let none = Self.firstMatch(
        in: value,
        pattern: #"\b(NONE|N/A)\b"#,
        caseInsensitive: true) {
        return none.uppercased()
      }
      return Self.firstMatch(in: value, pattern: #"\b([A-Z]{1,3})\b"#) ?? value
    case "4d":
      // License number — the compact alnum/hyphen DLN core. NOTE: this is
      // used for the DOMAIN GATE only; the demographic emit for 4d sends
      // the FULL raw value so the C++ class-suffix peel keeps working.
      return Self.firstMatch(
        in: value,
        pattern: #"[A-Za-z0-9][A-Za-z0-9-]{3,}"#) ?? value
    default:
      return value
    }
  }

  /// Scan every OCR observation for a `(?:CLASS|CLAS|GLASS) X` pattern and
  /// return the matched class code uppercased — or nil if nothing
  /// realistic is found. WI Pixel/Vision OCR fuses CLASS onto the DLN row
  /// and may misread the index "4d", so neither the lexer nor the
  /// bbox-IoU path produces a List9 candidate. This is the fallback.
  /// Mirrors HybridDLScanAndroid.scanForClass / scanForClassText.
  static func scanForClass(_ observations: [(text: String, bbox: CGRect)]) -> String? {
    let denylist: Set<String> = [
      "ST", "RD", "DR", "AVE", "BLVD", "LN", "CT", "CIR",
      "HWY", "PKWY", "NONE", "N/A"
    ]
    for obs in observations {
      guard let code = Self.firstCaptureGroup(
        in: obs.text,
        pattern: #"\b(?:CLASS|CLAS|GLASS)[\s:]+([A-Z][A-Z0-9]{0,2})\b"#,
        caseInsensitive: true) else { continue }
      let upper = code.uppercased()
      if denylist.contains(upper) { continue }
      return upper
    }
    return nil
  }

  /// Scan every OCR observation for a "CITY STATE ZIP" address line and
  /// return the first match verbatim (e.g. "FAIRBROOK WI 54016"), so the
  /// shared C++ parse_city_state_zip can split it into city/state/postal.
  /// The C++ regex accepts both comma- and space-separated forms, so the
  /// raw observation text is passed through unchanged. Emits a List8s
  /// strict candidate; the AAMVA "8" index has no index-label form on the
  /// card so the demographic loop can't bind it. Bounded to lines that
  /// look like a 2-letter state code followed by a US ZIP / Canadian
  /// postal so a street row ("123 WISCONSIN AVE") can't false-match.
  static func scanForCityStateZip(
    _ observations: [(text: String, bbox: CGRect)]
  ) -> String? {
    // <city words> <2-letter STATE> <5-digit ZIP[+4] | Canadian ANA NAN>.
    // Anchored loosely (search, not match) but the trailing state+ZIP
    // shape is the discriminator. Comma between city and state optional.
    let pattern =
      #"[A-Za-z][A-Za-z .'\-]*[, ]\s*[A-Za-z]{2}\s+(?:\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)"#
    for obs in observations {
      let text = obs.text.trimmingCharacters(in: .whitespaces)
      if let m = Self.firstMatch(in: text, pattern: pattern) {
        return m.trimmingCharacters(in: .whitespaces)
      }
    }
    return nil
  }

  /// Return the substring matched by the first occurrence of `pattern` in
  /// `text`, or nil if there is no match. Thin NSRegularExpression wrapper
  /// used by the demographic shape extractors. A malformed pattern (should
  /// never happen with the compile-time literals here) yields nil.
  private static func firstMatch(
    in text: String,
    pattern: String,
    caseInsensitive: Bool = false
  ) -> String? {
    let opts: NSRegularExpression.Options =
      caseInsensitive ? [.caseInsensitive] : []
    guard let re = try? NSRegularExpression(pattern: pattern, options: opts) else {
      return nil
    }
    let ns = text as NSString
    let range = NSRange(location: 0, length: ns.length)
    guard let match = re.firstMatch(in: text, options: [], range: range),
          match.range.location != NSNotFound else {
      return nil
    }
    return ns.substring(with: match.range)
  }

  /// Like firstMatch but returns capture group 1 instead of the whole
  /// match. Returns nil if there's no match or the group didn't
  /// participate. Used by scanForClass for the `CLASS (X)` capture.
  private static func firstCaptureGroup(
    in text: String,
    pattern: String,
    caseInsensitive: Bool = false
  ) -> String? {
    let opts: NSRegularExpression.Options =
      caseInsensitive ? [.caseInsensitive] : []
    guard let re = try? NSRegularExpression(pattern: pattern, options: opts) else {
      return nil
    }
    let ns = text as NSString
    let range = NSRange(location: 0, length: ns.length)
    guard let match = re.firstMatch(in: text, options: [], range: range),
          match.numberOfRanges > 1 else {
      return nil
    }
    let g = match.range(at: 1)
    guard g.location != NSNotFound else { return nil }
    return ns.substring(with: g)
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
  /// Uses the Nitro bridge helpers from DLScan-Swift-Cxx-Bridge.hpp for
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
  static func toLicenseDataSpec(_ ld: dlscan.LicenseData, cardImagePath: String? = nil, ocrObservations: [OcrObservationSpec]? = nil, headshotImagePath: String? = nil) -> LicenseDataSpec {
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
      ocrObservations: ocrObservations,
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
  ///
  /// #82: also runs a whole-card OCR pass over the EXACT image being saved
  /// and returns the per-line observations alongside the path. The in-
  /// pipeline OCR ran on a DIFFERENT rectification (unpadded corners from
  /// an independent doc-seg pass), so its boxes do NOT live in this image's
  /// pixel space and cannot be reused. Observations are fail-soft: nil on
  /// any OCR difficulty, never blocking the card save itself.
  ///
  /// `withObservations: false` skips that dedicated OCR pass entirely —
  /// used by the images-only capture mode, whose contract is "no OCR runs"
  /// (observations are documented absent there, and skipping the pass is
  /// part of the mode's performance win).
  private static func saveRectifiedCard(
    sourceBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation,
    withObservations: Bool = true
  ) -> (path: String, observations: [OcrObservationSpec]?)? {
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
    } catch {
      NSLog("[DLScan] saveRectifiedCard failed: \(error)")
      return nil
    }
    return (path: url.absoluteString,
            observations: withObservations ? cardImageObservations(on: cgImage) : nil)
  }

  /// #82: per-line OCR observations over the EXACT saved card image, so the
  /// returned boxes share `cardImagePath`'s pixel space. Boxes are normalized
  /// [0,1], origin TOP-LEFT, +y down (Vision reports bottom-left origin —
  /// flipped here). Fires once per scan, immediately after the card JPEG is
  /// written. Fail-soft: any error or empty OCR → nil.
  private static func cardImageObservations(on cgImage: CGImage) -> [OcrObservationSpec]? {
    var results: [OcrObservationSpec] = []
    let request = VNRecognizeTextRequest { request, error in
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation] else {
        return
      }
      for observation in observations {
        guard let candidate = observation.topCandidates(1).first,
              candidate.confidence >= 0.3 else { continue }
        // VNRectangleObservation.boundingBox is normalized [0,1] with a
        // BOTTOM-LEFT origin; the spec contract is top-left, +y down.
        let bb = observation.boundingBox
        results.append(OcrObservationSpec(
          text: candidate.string,
          x: Double(bb.origin.x),
          y: Double(1.0 - bb.origin.y - bb.height),
          width: Double(bb.width),
          height: Double(bb.height)
        ))
      }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do { try handler.perform([request]) } catch { return nil }
    return results.isEmpty ? nil : results
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
      NSLog("[DLScan] VNDetectFaceRectanglesRequest failed: \(error)")
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
      NSLog("[DLScan] extractHeadshot write failed: \(error)")
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

  private static func writeTailFile() {
    guard let dir = diagDocumentsURL() else { return }
    let url = dir.appendingPathComponent("dlscan-diag-tail.log")
    let text = diagTailBuffer.joined(separator: "\n") + "\n"
    try? text.write(to: url, atomically: true, encoding: .utf8)
  }

}
