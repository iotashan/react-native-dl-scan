// dlscan-debug-cli — runs the iOS post-docSeg OCR pipeline (YOLO → VisionKit
// OCR → bbox-match) on a still image and dumps every stage's output. Lets
// us iterate on accuracy heuristics (bareDigitAlias, tightenByContentShape,
// clusterLineByElementHeight, lookahead) in seconds without rebuilding /
// reinstalling the iOS app.
//
// Usage:
//   swift run dlscan-debug-cli /path/to/rectified.jpg
//
// Output: structured per-stage dump (YOLO dets, OCR observations, IoU
// matches, post-strip values). Each stage runs the same code an iOS device
// would run; the CLI omits docSeg + voter + C++ extract (we feed an
// already-rectified buffer in and inspect the bbox-match output directly).

import Foundation
import DLScanDebugCore
import Vision
import CoreML
import CoreImage
import AppKit

// MARK: - YOLO class table (mirrors cpp/yolo/field_classes.cpp)

let kFieldClassNames: [String] = [
    "birthday", "card_num1", "card_num2", "country", "donor",
    "expire_date", "face", "gender", "ghostimg", "given_name",
    "list_1", "list_12", "list_15", "list_16", "list_17",
    "list_18", "list_19", "list_2", "list_3", "list_3c",
    "list_4a", "list_4b", "list_4d", "list_5", "list_8f",
    "list_8s", "list_9", "list_9a", "personal_num", "surname",
]

// MARK: - YOLO NMS decode (Swift port of cpp/yolo/yolo_postprocess.cpp)
// Note: `YoloDetection` struct + `iou` function moved to DLScanDebugCore
// (task #68) so the library target's ProductionStrip.swift can also see
// them. `import DLScanDebugCore` at the top of this file pulls them in.

func decodeAndNms(
    tensor: UnsafePointer<Float>,
    numClasses: Int,
    numAnchors: Int,
    confThreshold: Float = 0.01,
    iouThreshold: Float = 0.45,
    maxDetections: Int = 100
) -> [YoloDetection] {
    // ChannelMajor: tensor[ch * numAnchors + a]
    // (`totalChannels = 4 + numClasses` is implicit in the index arithmetic
    // below; not needed as a named binding.)
    var raw: [YoloDetection] = []
    raw.reserveCapacity(numAnchors)
    for a in 0..<numAnchors {
        let cx = tensor[0 * numAnchors + a]
        let cy = tensor[1 * numAnchors + a]
        let w  = tensor[2 * numAnchors + a]
        let h  = tensor[3 * numAnchors + a]
        var bestClass = -1
        var bestScore: Float = 0
        for cls in 0..<numClasses {
            let s = tensor[(4 + cls) * numAnchors + a]
            if s > bestScore {
                bestScore = s
                bestClass = cls
            }
        }
        guard bestScore >= confThreshold, bestClass >= 0 else { continue }
        let x1 = cx - w / 2
        let y1 = cy - h / 2
        let x2 = cx + w / 2
        let y2 = cy + h / 2
        raw.append(YoloDetection(
            classId: bestClass,
            name: kFieldClassNames[bestClass],
            confidence: bestScore,
            bbox: CGRect(x: CGFloat(x1), y: CGFloat(y1),
                         width: CGFloat(x2 - x1), height: CGFloat(y2 - y1))
        ))
    }
    // Per-class NMS
    raw.sort { $0.confidence > $1.confidence }
    var kept: [YoloDetection] = []
    for det in raw {
        if kept.count >= maxDetections { break }
        var suppressed = false
        for k in kept where k.classId == det.classId {
            if Float(iou(det.bbox, k.bbox)) > iouThreshold {
                suppressed = true
                break
            }
        }
        if !suppressed {
            kept.append(det)
        }
    }
    return kept
}

// `iou` moved to DLScanDebugCore/CommonTypes.swift (task #68).

// MARK: - Pipeline

func loadCVPixelBuffer(from url: URL) -> CVPixelBuffer? {
    guard let img = NSImage(contentsOf: url),
          let cg  = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return nil
    }
    let w = cg.width, h = cg.height
    let attrs: [String: Any] = [
        kCVPixelBufferIOSurfacePropertiesKey as String: [:]
    ]
    var buf: CVPixelBuffer?
    let status = CVPixelBufferCreate(
        kCFAllocatorDefault, w, h,
        kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buf)
    guard status == kCVReturnSuccess, let pb = buf else { return nil }
    let ci = CIImage(cgImage: cg)
    let ctx = CIContext()
    ctx.render(ci, to: pb)
    return pb
}

func loadYoloModel() throws -> VNCoreMLModel {
    // Look for the model in two places:
    //   1. iOS Resources (the source path, used for SPM dev)
    //   2. The current app bundle (when running inside a build)
    let candidates = [
        URL(fileURLWithPath: "ios/Resources/DLScanFieldDetector.mlmodelc"),
        URL(fileURLWithPath: "../../ios/Resources/DLScanFieldDetector.mlmodelc"),
    ]
    for c in candidates {
        if FileManager.default.fileExists(atPath: c.path) {
            let mlModel = try MLModel(contentsOf: c)
            return try VNCoreMLModel(for: mlModel)
        }
    }
    fatalError("Could not find DLScanFieldDetector.mlmodelc")
}

func runYolo(buffer: CVPixelBuffer) throws -> [YoloDetection] {
    let model = try loadYoloModel()
    let request = VNCoreMLRequest(model: model)
    request.imageCropAndScaleOption = .scaleFill
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    try handler.perform([request])
    guard let obs = request.results?.first as? VNCoreMLFeatureValueObservation,
          let arr = obs.featureValue.multiArrayValue,
          arr.dataType == .float32 else {
        return []
    }
    let shape = arr.shape.map { $0.intValue }
    let totalChannels: Int
    let numAnchors: Int
    if shape.count == 3 {
        totalChannels = shape[1]
        numAnchors    = shape[2]
    } else {
        totalChannels = shape[0]
        numAnchors    = shape[1]
    }
    let numClasses = totalChannels - 4
    let ptr = arr.dataPointer.assumingMemoryBound(to: Float.self)
    let dets = decodeAndNms(tensor: ptr, numClasses: numClasses, numAnchors: numAnchors)
    // Reverse anisotropic .scaleFill to map back to image space.
    let imgW = CGFloat(CVPixelBufferGetWidth(buffer))
    let imgH = CGFloat(CVPixelBufferGetHeight(buffer))
    let sx = 640.0 / imgW
    let sy = 640.0 / imgH
    return dets.map { d in
        YoloDetection(
            classId: d.classId,
            name: d.name,
            confidence: d.confidence,
            bbox: CGRect(x: d.bbox.minX / sx, y: d.bbox.minY / sy,
                         width: d.bbox.width / sx, height: d.bbox.height / sy)
        )
    }
}

struct OcrObservation {
    let text: String
    let confidence: Float
    let bbox: CGRect       // image-pixel space, top-left origin
    let heightPx: CGFloat  // bbox height (proxy for glyph size)
}

/// One Vision per-character glyph rect (image-pixel space, top-left origin).
struct GlyphRect {
    let char: Character
    let bbox: CGRect
    let heightPx: CGFloat
}

/// Per-observation glyph telemetry, computed alongside the regular OCR pool.
/// Populated only for observations whose text is multi-character (single
/// glyphs are uninteresting for height clustering).
var lastVisionGlyphs: [Int: [GlyphRect]] = [:]

/// Iter 7 D-lite probe: run Vision per-YOLO-region, returning the best
/// observation text for each detection. Avoids whole-card OCR and the
/// downstream bbox-IoU matching entirely; tests whether field-localised
/// OCR (made cheap by Vision's `regionOfInterest`, no bitmap crop) beats
/// the whole-card + heuristics pipeline.
///
/// `pad` (normalised) widens the region slightly on every side so glyphs
/// straddling the YOLO bbox edge aren't clipped — Vision's recogniser
/// needs a few px of context.
///
/// Returns one entry per detection; the text is the joined output of all
/// observations Vision returned in that region (usually 1, sometimes 2
/// when MLKit-style row splits happen).
func runVisionKitPerRegion(
    buffer: CVPixelBuffer,
    detections: [YoloDetection],
    pad: CGFloat = 0.005,
    parallel: Bool = true
) throws -> [(yoloClass: String, text: String, latencyMs: Double)] {
    let imgW = CGFloat(CVPixelBufferGetWidth(buffer))
    let imgH = CGFloat(CVPixelBufferGetHeight(buffer))

    // Iter-11: parallel per-bbox dispatch.
    // VNImageRequestHandler is documented as one-shot — `perform` once,
    // reuse not guaranteed. Each parallel task creates its own handler;
    // CVPixelBuffer is read-only and safe to share. DispatchQueue.
    // concurrentPerform fans out across cores up to the system's
    // automatic concurrency limit (typically perf-cores count).
    //
    // The serial path is kept (parallel=false) for A/B measurement; the
    // CLI eval defaults to parallel.

    // Iter-11: filter out non-AAMVA / non-OCR'able YOLO classes BEFORE
    // running Vision. face/donor/ghostimg are graphical regions with no
    // text we care about; card_num1/card_num2 are barcode regions;
    // list_3c is jurisdiction-specific noise; list_5 is the synthetic
    // IDNet ID field. Saves 5-7 of ~20 detections per frame = ~25%
    // latency.
    let kNonOcrClasses: Set<String> = [
        "face", "donor", "ghostimg", "card_num1", "card_num2",
        "list_3c", "list_5"
    ]
    let eligibleDetections = detections.filter { !kNonOcrClasses.contains($0.name) }

    // Pre-build region rects per detection so the task closures don't
    // capture the loop variable in shared mutable state.
    struct Region { let yoloClass: String; let roi: CGRect }
    // Per-class padding overrides. The defaults of 0.5% on each side
    // work for most fields, but a few need more breathing room:
    //   list_17: right-pad +6% to capture trailing "lb" suffix (iter 8)
    //   list_16: y-pad +3% above and below — height region is only ~18px
    //            tall, Vision returns empty with the default 0.5%
    //            padding because the recogniser needs more vertical
    //            context for tiny text (iter 12)
    let regions: [Region] = eligibleDetections.map { det in
        let rightPad: CGFloat = (det.name == "list_17") ? 0.06 : pad
        let yPad: CGFloat = (det.name == "list_16") ? 0.03 : pad
        let x = max(0, det.bbox.minX / imgW - pad)
        let xMax = min(1, det.bbox.maxX / imgW + rightPad)
        let yBot = max(0, (imgH - det.bbox.maxY) / imgH - yPad)
        let yTop = min(1, (imgH - det.bbox.minY) / imgH + yPad)
        return Region(yoloClass: det.name,
                      roi: CGRect(x: x, y: yBot, width: xMax - x, height: yTop - yBot))
    }

    let outBox = OutputBox(count: regions.count)
    let work: (Int) -> Void = { i in
        let region = regions[i]
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.regionOfInterest = region.roi
        let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
        let t0 = DispatchTime.now()
        do { try handler.perform([request]) } catch { return }
        let dtMs = Double(DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1e6
        let texts = (request.results ?? []).compactMap {
            $0.topCandidates(1).first?.string
        }
        outBox.set(i, (region.yoloClass, texts.joined(separator: " "), dtMs))
    }
    if parallel {
        // Single shared handler, one perform() call with N requests.
        // Avoids per-task handler-init overhead (each
        // VNImageRequestHandler call resamples the CVPixelBuffer into
        // Vision's internal format; doing that 20× dominates serial latency).
        // Pass all requests in one perform([reqs]) call; Vision schedules
        // them internally with shared input prep.
        let requests: [VNRecognizeTextRequest] = (0..<regions.count).map { i in
            let r = regions[i]
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = false
            req.regionOfInterest = r.roi
            return req
        }
        let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
        let t0 = DispatchTime.now()
        do { try handler.perform(requests) } catch { /* ignore */ }
        let dtMs = Double(DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1e6
        let perCall = dtMs / Double(max(1, regions.count))
        for i in 0..<regions.count {
            let req = requests[i]
            let texts = (req.results ?? []).compactMap {
                $0.topCandidates(1).first?.string
            }
            outBox.set(i, (regions[i].yoloClass, texts.joined(separator: " "), perCall))
        }
    } else {
        for i in 0..<regions.count { work(i) }
    }
    return outBox.collect()
}

/// Thread-safe output slot for runVisionKitPerRegion parallel dispatch.
/// Each task writes to its own index; reader collects after the
/// concurrentPerform barrier (no concurrent read-after-write).
final class OutputBox {
    private var storage: [(yoloClass: String, text: String, latencyMs: Double)?]
    private let lock = NSLock()
    init(count: Int) { storage = Array(repeating: nil, count: count) }
    func set(_ i: Int, _ v: (String, String, Double)) {
        lock.lock(); defer { lock.unlock() }
        storage[i] = v
    }
    func collect() -> [(yoloClass: String, text: String, latencyMs: Double)] {
        return storage.compactMap { $0 }
    }
}

func runVisionKit(buffer: CVPixelBuffer) throws -> [OcrObservation] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
    try handler.perform([request])
    let imgW = CGFloat(CVPixelBufferGetWidth(buffer))
    let imgH = CGFloat(CVPixelBufferGetHeight(buffer))
    lastVisionGlyphs.removeAll(keepingCapacity: false)
    var out: [OcrObservation] = []
    for observation in (request.results ?? []) {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let bb = observation.boundingBox
        let x1 = bb.minX * imgW
        let x2 = bb.maxX * imgW
        // Vision: bottom-left origin; flip to top-left for image-pixel space.
        let y1 = (1.0 - bb.maxY) * imgH
        let y2 = (1.0 - bb.minY) * imgH
        let rect = CGRect(x: x1, y: y1, width: x2 - x1, height: y2 - y1)

        // Per-character bboxes — the Android-clusterLineByElementHeight
        // analog. Vision's `boundingBox(for: Range<String.Index>)` returns
        // a `VNRectangleObservation` in normalised image coords whose
        // topLeft → bottomLeft distance is the perspective-aware glyph
        // height (post-rectify the perspective component is gone, but
        // axis-aligned height already captures font size faithfully).
        let str = candidate.string
        var glyphs: [GlyphRect] = []
        var idx = str.startIndex
        while idx < str.endIndex {
            let next = str.index(after: idx)
            let range = idx..<next
            if let g = try? candidate.boundingBox(for: range) {
                // VNRectangleObservation is bottom-left-origin, normalised.
                // Distance topLeft → bottomLeft gives glyph height; we keep
                // axis-aligned bbox for cluster geometry.
                let gx1 = g.topLeft.x * imgW
                let gx2 = g.topRight.x * imgW
                let gy1 = (1.0 - g.topLeft.y) * imgH
                let gy2 = (1.0 - g.bottomLeft.y) * imgH
                let xL = min(gx1, gx2); let xR = max(gx1, gx2)
                let yT = min(gy1, gy2); let yB = max(gy1, gy2)
                let height = hypot(g.topLeft.x - g.bottomLeft.x,
                                   g.topLeft.y - g.bottomLeft.y) * imgH
                glyphs.append(GlyphRect(
                    char: str[idx],
                    bbox: CGRect(x: xL, y: yT, width: xR - xL, height: yB - yT),
                    heightPx: height
                ))
            }
            idx = next
        }
        if glyphs.count > 1 {
            lastVisionGlyphs[out.count] = glyphs
        }
        out.append(OcrObservation(
            text: candidate.string,
            confidence: candidate.confidence,
            bbox: rect,
            heightPx: rect.height
        ))
    }
    return out
}

// MARK: - Match step (mirrors the iOS matchObservationsToFields)

struct Match {
    let det: YoloDetection
    let observation: OcrObservation
    let iou: CGFloat
}

func matchObservationsToFields(
    observations: [OcrObservation],
    detections: [YoloDetection]
) -> [Match] {
    let threshold: CGFloat = 0.08
    var out: [Match] = []
    for det in detections {
        var best: (Int, CGFloat)? = nil
        for (oi, obs) in observations.enumerated() {
            let i = iou(det.bbox, obs.bbox)
            if i >= threshold, best == nil || i > best!.1 {
                best = (oi, i)
            }
        }
        if let b = best {
            out.append(Match(det: det, observation: observations[b.0], iou: b.1))
        }
    }
    return out
}

// MARK: - Heuristics ported from Android (HybridDLScanAndroid.kt)

/// Strip AAMVA prefix candidates from a raw OCR string for a given YOLO
/// class. Mirrors stripAamvaPrefixForClass in HybridDLScanAndroid.
let kExpectedAamvaIndex: [String: String] = [
    "list_1":  "1", "list_2":  "2", "list_3":  "3",
    "list_4a": "4a", "list_4b": "4b", "list_4d": "4d",
    "list_5":  "5", "list_8f": "8", "list_8s": "8",
    "list_9":  "9", "list_9a": "9a", "list_12": "12",
    "list_15": "15", "list_16": "16", "list_17": "17",
    "list_18": "18", "list_19": "19",
]
let kDropOnIndexMismatch: Set<String> = [
    "list_9", "list_15", "list_16", "list_17", "list_18", "list_19"
]
// VisionKit-observed substitutions of the AAMVA index when OCR'd:
//   "4d" → "a" (the 'd' fuses with surrounding letters)
//   "9a" → "9" or "a" (single-letter cases)
// The bareDigitAlias was Android's recovery path for "4d" → "4". On iOS
// we additionally need OCR-character recovery for "4d" → "a".
let kIndexAliases: [String: [String]] = [
    "4d": ["4d", "4", "a", "ad"],
    "4a": ["4a", "4", "a"],
    "4b": ["4b", "4"],
    "9a": ["9a", "9", "a"],
]

func stripAamvaPrefixForClass(text: String, yoloClass: String) -> String {
    guard let expected = kExpectedAamvaIndex[yoloClass] else { return text }
    let aliases = kIndexAliases[expected] ?? [expected]
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    // Match a leading alias followed by whitespace OR hyphen.
    for alias in aliases.sorted(by: { $0.count > $1.count }) {
        let prefixUpper = alias.uppercased()
        let textUpper = trimmed.uppercased()
        if textUpper.hasPrefix(prefixUpper) {
            // Must be followed by whitespace, hyphen, or end of string.
            let idx = trimmed.index(trimmed.startIndex, offsetBy: alias.count)
            if idx == trimmed.endIndex {
                return ""
            }
            let nextChar = trimmed[idx]
            if nextChar.isWhitespace || nextChar == "-" {
                return String(trimmed[idx...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
    }
    return trimmed
}

/// Tighten OCR text to the canonical content shape for a given field.
/// Truncate OCR text proportionally to the YOLO field bbox.
///
/// VisionKit can return an observation whose horizontal extent exceeds the
/// YOLO field bbox — typically because OCR fused adjacent visual elements
/// (the small AAMVA index "4d" on the left, the "9 CLASS D" on the right)
/// into one observation. Per-character bboxes aren't available (Vision's
/// boundingBox(for:) gives per-WORD positions, not per-char), so we
/// approximate by linearly interpolating character index along the
/// observation's x-extent.
///
/// `slop` (default 3%) skips truncation when the observation is mostly
/// inside the field bbox already — avoids corrupting tight, correct OCR.
///
/// On rectified2.jpg: obs="a D440-1234-5678-991" bbox=(420..932), field
/// bbox=(470..897). leftFrac=0.098, rightFrac=0.932. Drops "a" (left
/// outside) AND trailing "1" (right outside) → "D440-1234-5678-99".
func truncateByYoloBbox(text: String, obsBbox: CGRect, fieldBbox: CGRect, slop: CGFloat = 0.03) -> String {
    if text.count <= 1 || obsBbox.width <= 0 || obsBbox.height <= 0 { return text }
    // GUARD against multi-row fused observations. VisionKit sometimes
    // packages two physical text rows into one observation (e.g. the
    // JOHN QUINCY row + the row below got fused on rectified2.jpg).
    // For such observations the character-index ↔ x-position proportion
    // is broken because characters wrap. We detect this by comparing the
    // observation's height to the YOLO field bbox height — if the
    // observation is much taller than the field, the observation
    // straddles multiple visual rows and we MUST NOT do positional
    // truncation. 1.6x is empirically generous (real single-row obs may
    // be ~20% taller than the YOLO bbox due to descenders / antialias
    // halos; 60% above that is solidly multi-row).
    if obsBbox.height > fieldBbox.height * 1.6 { return text }
    // RIGHT-ONLY truncation. Left-side prefix cleanup is the AAMVA lexer's
    // job (stripAamvaPrefixForClass) — fighting that with linear-interp
    // bbox math left "d " in list_4d when the lexer correctly identifies
    // "4d" as the index. Trailing-OCR bleed (the trailing "1" from the
    // adjacent "9 CLASS" field, or "I" misread of a separator past the
    // field) is the only consistent win we get from bbox-driven truncation.
    let rightFrac = (fieldBbox.maxX - obsBbox.minX) / obsBbox.width
    let rightClamp = max(0, min(1, rightFrac))
    if rightClamp >= 1.0 - slop {
        return text  // observation's right edge is already inside field bbox
    }
    let n = text.count
    let endIdx = Int(ceil(CGFloat(n) * rightClamp))
    if endIdx <= 0 || endIdx >= n { return text }
    let e = text.index(text.startIndex, offsetBy: endIdx)
    return String(text[text.startIndex..<e]).trimmingCharacters(in: .whitespaces)
}

/// Mirrors the production iOS HybridDLScanIOS.tightenByContentShape exactly.
/// Anchored at start, uppercase-only, minimum length 4.
func tightenByContentShape(text: String, yoloClass: String) -> String {
    if text.isEmpty { return text }
    switch yoloClass {
    case "list_4d":
        let ns = text as NSString
        let nsRange = NSRange(location: 0, length: ns.length)
        if let re = try? NSRegularExpression(pattern: "^[A-Z0-9]+(?:-[A-Z0-9]+)*"),
           let m = re.firstMatch(in: text, range: nsRange),
           m.range.length >= 4 {
            return ns.substring(with: m.range)
        }
        return text
    default:
        return text
    }
}

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("Usage: \(args[0]) [--eval] <image-path>")
    exit(1)
}
let evalMode = args.contains("--eval")
let imagePath = args.first { $0.hasSuffix(".jpg") || $0.hasSuffix(".jpeg") || $0.hasSuffix(".png") } ?? args.last!
let url = URL(fileURLWithPath: imagePath)

if !evalMode { print("Loading: \(imagePath)") }
guard let buf = loadCVPixelBuffer(from: url) else {
    print("Failed to load image: \(imagePath)")
    exit(1)
}
let w = CVPixelBufferGetWidth(buf)
let h = CVPixelBufferGetHeight(buf)
if !evalMode { print("Buffer: \(w)x\(h)") }

if !evalMode { print("\n=== YOLO Detections ===") }
do {
    let dets = try runYolo(buffer: buf)
    if !evalMode {
        print("\(dets.count) detection(s) after NMS")
        for d in dets.sorted(by: { $0.bbox.minY < $1.bbox.minY }) {
            let b = d.bbox
            print(String(format: "  %-12@ conf=%.3f  bbox=(%.0f,%.0f .. %.0f,%.0f) %.0fx%.0f",
                         d.name as NSString, d.confidence,
                         b.minX, b.minY, b.maxX, b.maxY, b.width, b.height))
        }
    }
    let observations = try runVisionKit(buffer: buf)
    if !evalMode {
        print("\n=== VisionKit OCR Observations ===")
        print("\(observations.count) observation(s)")
        for (i, o) in observations.sorted(by: { $0.bbox.minY < $1.bbox.minY }).enumerated() {
            let b = o.bbox
            print(String(format: "  [%2d] %.0fx%.0f bbox=(%.0f,%.0f .. %.0f,%.0f) conf=%.2f text=\"%@\"",
                         i, b.width, b.height,
                         b.minX, b.minY, b.maxX, b.maxY, o.confidence, o.text as NSString))
        }
        print("\n=== Bbox-Match Results (IoU >= 0.08) ===")
    }
    let matches = matchObservationsToFields(observations: observations, detections: dets)
    if !evalMode {
        for m in matches.sorted(by: { $0.det.bbox.minY < $1.det.bbox.minY }) {
            print(String(format: "  %-12@ iou=%.2f  text=\"%@\"",
                         m.det.name as NSString, m.iou, m.observation.text as NSString))
        }
        print("\n=== After full pipeline (truncateByYoloBbox + strip + tighten) ===")
    }
    // Build the SIMPLE pipeline output (old CLI logic) per field for eval.
    var simpleByClass: [String: String] = [:]
    for m in matches {
        let rawStripped = stripAamvaPrefixForClass(text: m.observation.text, yoloClass: m.det.name)
        let rawTightened = tightenByContentShape(text: rawStripped, yoloClass: m.det.name)
        if !rawTightened.isEmpty && simpleByClass[m.det.name] == nil {
            simpleByClass[m.det.name] = rawTightened
        }
    }

    // PRODUCTION pipeline: split observations by AAMVA indices, then run
    // the lexer-backed bbox match + strict-text-pool demographic parser.
    // Strict-text-pool wins over bbox for any field both produce (matches
    // the StrictAgrees → CrossValidated upgrade behaviour in production).
    let obsTuples: [(text: String, bbox: CGRect)] =
        observations.map { ($0.text, $0.bbox) }
    let splitObs = prodSplitObservationsByAamvaIndices(obsTuples)
    let prodBbox = prodMatchObservationsToFields(observations: splitObs, detections: dets)
    let prodStrict = prodParseAamvaDemographicFields(splitObs)
    var prodByClass: [String: String] = [:]
    for c in prodBbox { prodByClass[c.yoloClass] = c.text }
    for c in prodStrict { prodByClass[c.yoloClass] = c.text }  // strict wins

    // Iter 7 D-lite probe: run per-YOLO-region OCR and apply the same
    // strip+tighten chain. This bypasses bbox-IoU matching entirely.
    let wallT0 = DispatchTime.now()
    let perRegion = (try? runVisionKitPerRegion(buffer: buf, detections: dets)) ?? []
    let wallDtMs = Double(DispatchTime.now().uptimeNanoseconds - wallT0.uptimeNanoseconds) / 1e6
    var regionByClass: [String: String] = [:]
    var regionLatencyTotalMs: Double = 0
    for (cls, raw, ms) in perRegion {
        regionLatencyTotalMs += ms
        let stripped = prodStripAamvaPrefixForClass(text: raw, yoloClass: cls)
        let tightened = prodTightenByContentShape(text: stripped, yoloClass: cls,
                                                  detectedState: nil)
        // Take last-wins (highest YOLO confidence ordering already in dets).
        if !tightened.isEmpty { regionByClass[cls] = tightened }
    }
    // Detect state once on the per-region pool too (state banner is large
    // text + a YOLO class of its own; if the banner has a detection,
    // its region will OCR cleanly).
    let regionStateText = perRegion.map { $0.text }.joined(separator: " ")
    let regionState = kStateNameToCode.first { regionStateText.uppercased().contains($0.0) }?.1
    // Second pass: re-tighten list_4d with state.
    if let l4 = regionByClass["list_4d"], regionState != nil {
        let raw = perRegion.first { $0.yoloClass == "list_4d" }?.text ?? l4
        let stripped = prodStripAamvaPrefixForClass(text: raw, yoloClass: "list_4d")
        regionByClass["list_4d"] = prodTightenByContentShape(text: stripped,
            yoloClass: "list_4d", detectedState: regionState)
    }

    // COMBINED pipeline (iter 8): REGION wins when non-empty; else PROD.
    // We deliberately keep REGION-vs-PROD per-field divergence visible so
    // we can spot fields where one strictly dominates the other.
    var combinedByClass: [String: String] = [:]
    let allClassKeys = Set(prodByClass.keys).union(regionByClass.keys)
    for k in allClassKeys {
        let r = regionByClass[k] ?? ""
        let p = prodByClass[k] ?? ""
        combinedByClass[k] = !r.isEmpty ? r : p
    }

    if evalMode {
        // Tab-separated: FIELD<TAB>SIMPLE<TAB>PRODUCTION<TAB>REGION<TAB>COMBINED
        func esc(_ s: String) -> String {
            return s.replacingOccurrences(of: "\t", with: "\\t")
                    .replacingOccurrences(of: "\n", with: "\\n")
        }
        let allKeys = Set(simpleByClass.keys)
            .union(prodByClass.keys)
            .union(regionByClass.keys)
            .union(combinedByClass.keys)
        for k in allKeys.sorted() {
            let s = simpleByClass[k] ?? ""
            let p = prodByClass[k] ?? ""
            let r = regionByClass[k] ?? ""
            let c = combinedByClass[k] ?? ""
            print("FIELD\t\(k)\t\(esc(s))\t\(esc(p))\t\(esc(r))\t\(esc(c))")
        }
        print(String(format: "REGION_LATENCY_MS\t%.1f", regionLatencyTotalMs))
    } else {
        print("\n=== Simple (old) vs Production (lexer-backed + strict text-pool) vs Region (D-lite) ===")
        let allKeys = Set(simpleByClass.keys)
            .union(prodByClass.keys)
            .union(regionByClass.keys)
        for k in allKeys.sorted() {
            let s = simpleByClass[k] ?? ""
            let p = prodByClass[k] ?? ""
            let r = regionByClass[k] ?? ""
            print(String(format: "  %-12@  simple=\"%@\"  prod=\"%@\"  region=\"%@\"",
                         k as NSString, s as NSString, p as NSString, r as NSString))
        }
        print(String(format: "  region wall=%.0fms sum=%.0fms calls=%d (avg %.0fms/call, speedup vs serial: %.2fx)",
                     wallDtMs, regionLatencyTotalMs, perRegion.count,
                     regionLatencyTotalMs / Double(max(1, perRegion.count)),
                     regionLatencyTotalMs / max(1, wallDtMs)))
    }

    if evalMode { exit(0) }
    print("\n=== Per-Glyph Height (Vision boundingBox(for:) — Android clusterLineByElementHeight analog) ===")
    print("  Indexes are in observations' NATURAL (unsorted) order.")
    let keys = lastVisionGlyphs.keys.sorted()
    for k in keys {
        let glyphs = lastVisionGlyphs[k] ?? []
        let text = observations[k].text
        // Compute median height for context.
        let heights = glyphs.map { $0.heightPx }.sorted()
        let median = heights.isEmpty ? 0 : heights[heights.count / 2]
        print(String(format: "  [%2d] text=\"%@\"  median_h=%.1fpx  n=%d", k, text as NSString, median, glyphs.count))
        var line = "       "
        for g in glyphs {
            let ratio = median > 0 ? g.heightPx / median : 0
            let marker = ratio < 0.75 ? "*" : " "  // mark outliers
            line += String(format: "%@%@:%.0f ",
                           marker,
                           String(g.char) as NSString,
                           g.heightPx)
        }
        print(line)
        var xLine = "       x: "
        for g in glyphs {
            xLine += String(format: "%@:%.0f ",
                            String(g.char) as NSString, g.bbox.midX)
        }
        print(xLine)
    }
} catch {
    print("Error: \(error)")
    exit(1)
}

print("\nDone.")
