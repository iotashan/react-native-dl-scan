// Production-equivalent AAMVA strip / parse logic for the CLI eval.
//
// These functions are COPIED from ios/HybridDlScanIOS.swift and must be
// kept in sync. The production file references Nitro-generated types
// (FieldCandidate, FieldSource) that aren't available to the CLI's
// SwiftPM build, so the CLI uses lightweight CGRect / tuple equivalents.
//
// Reach-through to the SAME C++ AAMVA lexer (cpp/aamva/aamva_lexer_c.cpp)
// via the AamvaLexerC SwiftPM target — so the lexer behaviour (regex,
// canonicalize aliases, compatible-label gate, expected-domain gate) is
// byte-for-byte the same as production iOS.

import Foundation
import CoreGraphics

// MARK: - CLI-side type adapters

/// Lightweight production-style field candidate for CLI eval output.
public struct ProdFieldCandidate {
    public let yoloClass: String
    public let source: Int32     // 1 = BboxIoU, 3 = StrictTextPool
    public let text: String

    public init(yoloClass: String, source: Int32, text: String) {
        self.yoloClass = yoloClass
        self.source = source
        self.text = text
    }
}

// MARK: - Class metadata (copied verbatim from HybridDlScanIOS.swift)

public let expectedAamvaIndex: [String: String] = [
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

public let dropOnIndexMismatch: Set<String> = [
    "list_9", "list_15", "list_16", "list_17", "list_18", "list_19"
]

public let kVisionMisreadAlias: [String: [String]] = [
    "4d": ["ad", "4", "a", "A"],
    "4a": ["4", "a", "A"],
    "4b": ["4"],
    "9a": ["9", "a", "A"],
]

public let multilineFieldClasses: Set<String> = ["list_5", "list_8f"]

// Reverse lookup for the demographic parser's strict (a)+(b)+(c)+(d) pipeline.
public let demographicYoloClass: [String: String] = [
    "9":  "list_9",
    "15": "list_15",
    "16": "list_16",
    "17": "list_17",
    "18": "list_18",
    "19": "list_19",
]

// MARK: - stripAamvaPrefixForClass (lexer-backed)

/// Production-equivalent strip. Mirrors HybridDlScanIOS.stripAamvaPrefixForClass.
public func prodStripAamvaPrefixForClass(text: String, yoloClass: String) -> String {
    // Trust-the-class rule for street (list_8f).
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

    // Vision-misread alias fallback.
    if let aliases = kVisionMisreadAlias[expected] {
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

// AAMVA D-20 eye/hair color allowlists. Mirror of
// cpp/aamva/aamva_lexer.cpp.
public let kEyeColorCodes: Set<String> = [
    "BLK", "BLU", "BRO", "GRY", "GRN", "HAZ", "MAR", "PNK", "DIC", "UNK"
]
public let kHairColorCodes: Set<String> = [
    "BAL", "BLK", "BLN", "BRO", "GRY", "RED", "SDY", "WHI", "UNK"
]

/// Find the first 3-letter-exact token in `text` (case-insensitive) whose
/// upper form is in `allowlist`. Returns the uppercase code or nil.
public func firstColorCodeMatch(in text: String, allowlist: Set<String>) -> String? {
    let upper = text.uppercased()
    let ns = upper as NSString
    guard let re = try? NSRegularExpression(pattern: "[A-Z]{3,}") else { return nil }
    let matches = re.matches(in: upper, range: NSRange(location: 0, length: ns.length))
    for m in matches {
        let tok = ns.substring(with: m.range)
        if tok.count == 3 && allowlist.contains(tok) { return tok }
    }
    return nil
}

/// State-name -> 2-letter-code map for IDNet-covered US DL corpus.
public let kStateNameToCode: [(String, String)] = [
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

public let kStateLicensePatterns: [String: String] = [
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

public func detectState(observations: [(text: String, bbox: CGRect)]) -> String? {
    let pool = observations.map { $0.text.uppercased() }.joined(separator: " ")
    for (name, code) in kStateNameToCode {
        if pool.contains(name) { return code }
    }
    return nil
}

/// Single uppercase letter value extractor with label/diacritic strip.
public func extractSingleLetterValue(in text: String,
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
    for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
        let tok = ns.substring(with: m.range)
        if tok.count == 1 { return tok }
    }
    return nil
}

/// Extract a date pattern from `text`, tolerating OCR substitutions
/// (`O`->`0`, `I`/`l`->`1`) and `I` as a misread `/` separator.
/// Returns canonical "MM/DD/YYYY" or nil.
public func extractDate(from text: String, preferLast: Bool = false) -> String? {
    let stripped = text.replacingOccurrences(of: " ", with: "")
    let ns = stripped as NSString
    guard let re = try? NSRegularExpression(
            pattern: "([0-9OIl]{2})[/Il]([0-9OIl]{2})[/Il]([0-9OIl]{4})")
    else { return nil }
    let matches = re.matches(in: stripped,
                             range: NSRange(location: 0, length: ns.length))
    if matches.isEmpty { return nil }
    func canon(_ s: String) -> String {
        s.replacingOccurrences(of: "O", with: "0")
         .replacingOccurrences(of: "I", with: "1")
         .replacingOccurrences(of: "l", with: "1")
    }
    let candidates: [NSTextCheckingResult] = preferLast ? matches.reversed() : matches
    for m in candidates {
        guard m.numberOfRanges == 4 else { continue }
        let mm = canon(ns.substring(with: m.range(at: 1)))
        let dd = canon(ns.substring(with: m.range(at: 2)))
        let yy = canon(ns.substring(with: m.range(at: 3)))
        guard let mi = Int(mm), let di = Int(dd), let yi = Int(yy),
              mi >= 1, mi <= 12, di >= 1, di <= 31,
              yi >= 1900, yi <= 2100 else { continue }
        return String(format: "%02d/%02d/%04d", mi, di, yi)
    }
    return nil
}

// MARK: - tightenByContentShape

public func prodTightenByContentShape(text: String, yoloClass: String,
                               detectedState: String? = nil) -> String {
    if text.isEmpty { return text }
    switch yoloClass {
    case "list_4d":
        // State-aware list_4d (iter 6). Verified against IDNet ground truth
        // per state. Allows O/I/l in digit positions, substitutes back.
        if let state = detectedState,
           let pattern = kStateLicensePatterns[state] {
            var stripped = text.uppercased()
            for p in ["DLN:", "DLN", "DL:", "DL"] {
                if stripped.hasPrefix(p) {
                    stripped = String(stripped.dropFirst(p.count))
                        .trimmingCharacters(in: .whitespaces)
                    break
                }
            }
            let upper = stripped
            let ns = upper as NSString
            if let re = try? NSRegularExpression(pattern: pattern),
               let m = re.firstMatch(in: upper, range: NSRange(location: 0, length: ns.length)) {
                let raw = ns.substring(with: m.range)
                let prefixLen = ["AZ", "CA", "WV", "WI"].contains(state) ? 1 : 0
                var canon = ""
                for (i, c) in Array(raw).enumerated() {
                    if i < prefixLen {
                        canon.append(c)
                    } else {
                        switch c {
                        case "O": canon.append("0")
                        case "I": canon.append("1")
                        case "L": canon.append("1")
                        default:  canon.append(c)
                        }
                    }
                }
                return canon
            }
        }
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
        return firstColorCodeMatch(in: text, allowlist: kEyeColorCodes) ?? text
    case "list_19":
        return firstColorCodeMatch(in: text, allowlist: kHairColorCodes) ?? text
    case "list_15":
        let upper = text.uppercased()
        let ns = upper as NSString
        if let re = try? NSRegularExpression(pattern: "(?<![A-Z])[MFX](?![A-Z])"),
           let m = re.firstMatch(in: upper, range: NSRange(location: 0, length: ns.length)) {
            return ns.substring(with: m.range)
        }
        return text
    case "list_17":
        let upper = text.uppercased().replacingOccurrences(of: "IB", with: "LB").replacingOccurrences(of: "|B", with: "LB")
        let ns = upper as NSString
        if let re = try? NSRegularExpression(pattern: "(\\d{2,4})\\s*(LBS?|KGS?)"),
           let m = re.firstMatch(in: upper, range: NSRange(location: 0, length: ns.length)),
           m.numberOfRanges == 3 {
            return "\(ns.substring(with: m.range(at: 1))) \(ns.substring(with: m.range(at: 2)))"
        }
        return text
    case "list_9":
        return extractSingleLetterValue(in: text, dropTokens: ["NONE"]) ?? text
    case "list_9a":
        if text.uppercased().contains("NONE") { return "NONE" }
        return extractSingleLetterValue(in: text) ?? text
    case "list_12":
        if text.uppercased().contains("NONE") { return "NONE" }
        return extractSingleLetterValue(in: text, dropTokens: ["NONE"]) ?? text
    case "list_16":
        let ns = text as NSString
        if let re = try? NSRegularExpression(pattern: "(\\d+)'-(\\d+)(?:\"|'')"),
           let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
           m.numberOfRanges == 3 {
            let ft = ns.substring(with: m.range(at: 1))
            let inch = ns.substring(with: m.range(at: 2))
            return "\(ft)'-\(inch)''"
        }
        return text
    case "list_3":
        return extractDate(from: text, preferLast: false) ?? text
    case "list_4a":
        return extractDate(from: text, preferLast: false) ?? text
    case "list_4b":
        return extractDate(from: text, preferLast: true) ?? text
    default:
        return text
    }
}

// MARK: - splitObservationsByAamvaIndices

public func prodSplitObservationsByAamvaIndices(
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
            let subText = String(obs.text[s..<e]).trimmingCharacters(in: .whitespaces)
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

// MARK: - parseAamvaDemographicFields

public func prodParseAamvaDemographicFields(
    _ observations: [(text: String, bbox: CGRect)]
) -> [ProdFieldCandidate] {
    var candidatesByIndex: [String: [AamvaToken]] = [:]
    for obs in observations {
        for token in AamvaLexer.findAllAamvaTokens(in: obs.text) {
            guard demographicYoloClass[token.index] != nil else { continue }                                 // (a)
            guard AamvaLexer.isCompatibleLabel(canonicalIndex: token.index, label: token.label) else { continue } // (b)
            let cleaned = token.value
                .trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
            guard AamvaLexer.valueMatchesDomain(cleaned, domainKey: token.index) else { continue }            // (c)
            candidatesByIndex[token.index, default: []].append(token)
        }
    }
    var out: [ProdFieldCandidate] = []
    for (idx, toks) in candidatesByIndex {
        guard toks.count == 1, let yoloClass = demographicYoloClass[idx] else { continue }                    // (d)
        let tok = toks[0]
        let v: String
        switch idx {
        case "15": v = tok.value.uppercased().trimmingCharacters(in: .whitespaces)
        default:
            if let label = tok.label {
                v = "\(label) \(tok.value)".trimmingCharacters(in: .whitespaces)
            } else {
                v = tok.value.trimmingCharacters(in: .whitespaces)
            }
        }
        if !v.isEmpty {
            out.append(ProdFieldCandidate(yoloClass: yoloClass, source: 3, text: v))
        }
    }
    return out
}

// MARK: - matchObservationsToFields (production-equivalent best-IoU)

public func prodMatchObservationsToFields(
    observations: [(text: String, bbox: CGRect)],
    detections: [YoloDetection]
) -> [ProdFieldCandidate] {
    if detections.isEmpty || observations.isEmpty { return [] }
    let detectedState = detectState(observations: observations)
    let matchThreshold: CGFloat = 0.08

    struct M { let oi: Int; let iou: CGFloat }
    var matchesByDet: [Int: [M]] = [:]
    for (oi, obs) in observations.enumerated() {
        for (di, det) in detections.enumerated() {
            let v = iou(obs.bbox, det.bbox)
            if v >= matchThreshold {
                matchesByDet[di, default: []].append(M(oi: oi, iou: v))
            }
        }
    }

    var result: [String: String] = [:]
    for di in detections.indices {
        guard let ms = matchesByDet[di], !ms.isEmpty else { continue }
        let det = detections[di]
        if multilineFieldClasses.contains(det.name) {
            let sorted = ms.sorted { observations[$0.oi].bbox.midY < observations[$1.oi].bbox.midY }
            let lines = sorted.map { m -> String in
                let stripped = prodStripAamvaPrefixForClass(text: observations[m.oi].text, yoloClass: det.name)
                return prodTightenByContentShape(text: stripped, yoloClass: det.name, detectedState: detectedState)
            }.filter { !$0.isEmpty }
            if lines.isEmpty { continue }
            let joined = lines.joined(separator: "\n")
            if let existing = result[det.name] {
                result[det.name] = existing + "\n" + joined
            } else {
                result[det.name] = joined
            }
        } else {
            let winner = ms.max { lhs, rhs in
                if lhs.iou != rhs.iou { return lhs.iou < rhs.iou }
                return observations[lhs.oi].bbox.midY > observations[rhs.oi].bbox.midY
            }!
            let raw = observations[winner.oi].text
            let cleaned = prodStripAamvaPrefixForClass(text: raw, yoloClass: det.name)
            let tightened = prodTightenByContentShape(text: cleaned, yoloClass: det.name, detectedState: detectedState)
            if !tightened.isEmpty && result[det.name] == nil {
                result[det.name] = tightened
            }
        }
    }
    return result.map { ProdFieldCandidate(yoloClass: $0.key, source: 1, text: $0.value) }
}
