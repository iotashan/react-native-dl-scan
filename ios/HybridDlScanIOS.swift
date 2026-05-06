import Foundation
import NitroModules
import DlScanCxx
import CxxStdlib
import Vision
import VisionCamera

/// Swift implementation of the DlScan Nitro HybridObject.
///
/// Parses AAMVA-encoded PDF417 barcode strings by delegating directly to the
/// C++ core (dlscan::parse_aamva) so the same logic executes on the iOS
/// production path. The 66 GoogleTest cases cover this same C++ code.
///
/// OCR recognition is handled via VisionKit on a serial background queue.
/// The result is cached and returned synchronously from recognizeLicenseFields,
/// which is safe to call from a frame-processor worklet at 30 fps.
///
/// Registration is handled automatically by the auto-generated
/// DlScanAutolinking.mm (loaded via +load on first class access).
/// Host apps do NOT need to call any registration function manually —
/// CocoaPods autolinking handles it through pod_target_xcconfig.
class HybridDlScanIOS: HybridDlScanSpec {

  // MARK: - OCR state (guarded by ocrLock)

  private let ocrLock = NSLock()
  private var cachedOcrResult: LicenseDataSpec? = nil
  private var ocrInFlight = false
  private var lastOcrTime: CFAbsoluteTime = 0
  private let ocrQueue = DispatchQueue(label: "com.dlscan.ocr", qos: .userInitiated)

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
  /// Each call checks whether a new VisionKit job should be submitted
  /// (rate-limited to ~2 fps internally via a 0.5s cooldown). The first
  /// non-null result becomes available a few frames after the first call.
  /// The cache is NOT auto-cleared — the caller is responsible for stopping
  /// calls once a non-null result is consumed (e.g., via a Synchronizable guard).
  ///
  /// Frame pixel buffer access happens synchronously within this method;
  /// the VisionKit request runs asynchronously on ocrQueue but holds a
  /// CVPixelBuffer reference acquired here. CMSampleBuffer validity is checked
  /// before any work begins.
  func recognizeLicenseFields(frame: any HybridFrameSpec) throws -> Variant_NullType_LicenseDataSpec {
    let now = CFAbsoluteTimeGetCurrent()

    // Snapshot OCR state under lock — do NOT set ocrInFlight yet.
    // Keep the lock window minimal — no allocations inside.
    ocrLock.lock()
    let cached = cachedOcrResult
    let inFlight = ocrInFlight
    let elapsed = now - lastOcrTime
    let shouldStartNewJob = !inFlight && elapsed >= 0.5  // 2 fps rate limit
    ocrLock.unlock()

    // Return cached result immediately if no new job should be started.
    guard shouldStartNewJob else {
      if let result = cached {
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
      if let result = cached {
        return Variant_NullType_LicenseDataSpec.second(result)
      }
      return Variant_NullType_LicenseDataSpec.first(.null)
    }

    // Map the VC v5 CameraOrientation + isMirrored to CGImagePropertyOrientation
    // for VNImageRequestHandler. VNImageRequestHandler has no separate mirroring
    // parameter — mirroring must be encoded into the orientation enum.
    // orientation and isMirrored are directly on the HybridFrameSpec protocol.
    let frameOrientation: CGImagePropertyOrientation
    switch (frame.orientation, frame.isMirrored) {
    case (.up,    false): frameOrientation = .up
    case (.up,    true):  frameOrientation = .upMirrored
    case (.right, false): frameOrientation = .right
    case (.right, true):  frameOrientation = .rightMirrored
    case (.down,  false): frameOrientation = .down
    case (.down,  true):  frameOrientation = .downMirrored
    case (.left,  false): frameOrientation = .left
    case (.left,  true):  frameOrientation = .leftMirrored
    default:              frameOrientation = .up
    }

    // Commit to a new job: set ocrInFlight + lastOcrTime atomically.
    ocrLock.lock()
    ocrInFlight = true
    lastOcrTime = now
    ocrLock.unlock()

    // Retain the pixel buffer so it survives past this method call.
    // Swift's CVPixelBuffer bridging handles CF retention automatically.
    let retainedBuffer = pixelBuffer

    ocrQueue.async { [weak self] in
      guard let self else { return }
      defer {
        self.ocrLock.lock()
        self.ocrInFlight = false
        self.ocrLock.unlock()
      }

      let lines = self.runVisionKit(on: retainedBuffer, orientation: frameOrientation)

      // Convert [String] → std::vector<std::string> for the C++ OCR extractor.
      var cppLines = std.vector<std.string>()
      for s in lines {
        cppLines.push_back(std.string(s))
      }

      let cppResult = dlscan.extract_ocr_fields(cppLines)
      let nitroResult: LicenseDataSpec? = Optional(fromCxx: cppResult).map {
        HybridDlScanIOS.toLicenseDataSpec($0)
      }

      self.ocrLock.lock()
      self.cachedOcrResult = nitroResult
      self.ocrLock.unlock()
      // Note: ocrInFlight = false is in the defer block above, so it runs
      // even if the C++ extractor or Vision callback throws/traps.
    }

    // Return the existing cached result (may be nil on the first few frames).
    if let result = cached {
      return Variant_NullType_LicenseDataSpec.second(result)
    }
    return Variant_NullType_LicenseDataSpec.first(.null)
  }

  // MARK: - Private helpers

  /// Run VisionKit text recognition on a pixel buffer.
  /// Synchronous; blocks the calling thread until the request completes.
  private func runVisionKit(
    on buffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation = .up
  ) -> [String] {
    var lines: [String] = []
    let request = VNRecognizeTextRequest { request, error in
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation] else {
        return
      }
      for observation in observations {
        if let candidate = observation.topCandidates(1).first,
           candidate.confidence >= 0.3 {
          lines.append(candidate.string)
        }
      }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(
      cvPixelBuffer: buffer,
      orientation: orientation,
      options: [:]
    )
    try? handler.perform([request])
    return lines
  }

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
  static func toLicenseDataSpec(_ ld: dlscan.LicenseData) -> LicenseDataSpec {
    // sex: std::optional<std::string> ("M"/"F"/"X") → Sex?
    let sexStr: String? = optStr(ld.sex)
    let sexValue: Sex? = sexStr.flatMap { Sex(fromString: $0) }

    // aamvaVersion: std::optional<int> → Double?
    // Optional(fromCxx:) bridges std::optional<int> → Swift Int?, then
    // convert to Double (Nitro maps TS `number` to C++ double).
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
      let mrzSexVal: Sex = Sex(fromString: String(std.string(cppMrz.sex))) ?? .x
      mrzValue = MRZDataSpec(
        mrzType:             mrzTypeVal,
        documentCode:        String(std.string(cppMrz.documentCode)),
        issuingState:        String(std.string(cppMrz.issuingState)),
        documentNumber:      String(std.string(cppMrz.documentNumber)),
        primaryIdentifier:   String(std.string(cppMrz.primaryIdentifier)),
        secondaryIdentifier: String(std.string(cppMrz.secondaryIdentifier)),
        nationality:         String(std.string(cppMrz.nationality)),
        dateOfBirth:         String(std.string(cppMrz.dateOfBirth)),
        sex:                 mrzSexVal,
        dateOfExpiry:        String(std.string(cppMrz.dateOfExpiry)),
        optionalData:        String(std.string(cppMrz.optionalData)),
        checkDigitsValid:    cppMrz.checkDigitsValid
      )
    } else {
      mrzValue = nil
    }

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
      height:         optStr(ld.height),
      vehicleClass:   optStr(ld.vehicleClass),
      restrictions:   optStr(ld.restrictions),
      endorsements:   optStr(ld.endorsements),
      aamvaVersion:   versionValue,
      documentType:   docTypeValue,
      mrz:            mrzValue
    )
  }
}
