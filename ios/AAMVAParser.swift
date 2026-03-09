import Foundation

/// Parses AAMVA-standard PDF417 barcode data from US/Canadian driver's licenses.
/// Supports AAMVA versions 1–11 with version-specific field code mappings,
/// date format handling, and name resolution fallback chains.
/// Ported from DLParser-Swift (MIT) by Andrew Johnson.
@objc public class AAMVAParser: NSObject {

    // MARK: - Public API

    /// Parse raw AAMVA barcode string into a dictionary of license fields.
    /// Returns nil if the data is not valid AAMVA format.
    @objc public static func parse(_ rawData: String) -> [String: Any]? {
        guard rawData.contains("ANSI") || rawData.contains("AAMVA") else {
            return nil
        }

        let elements = extractDataElements(from: rawData)
        guard !elements.isEmpty else { return nil }

        let version = detectVersion(from: rawData)
        let country = elements["DCG"]
        let dateFmt = dateFormat(for: version, country: country)

        var result: [String: Any] = [:]

        // Name resolution with version-aware fallback chains
        result["firstName"] = resolveFirstName(elements)
        result["lastName"] = resolveLastName(elements)
        result["middleName"] = resolveMiddleName(elements)

        // Core fields
        result["licenseNumber"] = elements["DAQ"]
        result["dateOfBirth"] = parseDate(elements["DBB"], format: dateFmt)
        result["expirationDate"] = parseDate(elements["DBA"], format: dateFmt)
        result["issueDate"] = parseDate(elements["DBD"], format: dateFmt)
        result["sex"] = mapSex(elements["DBC"])
        result["eyeColor"] = elements["DAY"]
        result["height"] = elements["DAU"]
        result["street"] = elements["DAG"]
        result["city"] = elements["DAI"]
        result["state"] = elements["DAJ"]
        result["postalCode"] = cleanPostalCode(elements["DAK"])
        result["country"] = country ?? "USA"

        // Vehicle class/restrictions/endorsements with v1 fallback to PA* codes
        result["vehicleClass"] = elements["DCA"] ?? elements["PAA"]
        result["restrictions"] = elements["DCB"] ?? elements["PAE"]
        result["endorsements"] = elements["DCD"] ?? elements["PAF"]

        if let v = version {
            result["aamvaVersion"] = v
        }

        return result
    }

    // MARK: - Version Detection

    /// Detect AAMVA version from the header.
    /// Header format: "ANSI " or "AAMVA" + 6-digit IIN + 2-digit version + ...
    /// Regex is anchored to require ANSI/AAMVA prefix to avoid false positives.
    private static func detectVersion(from data: String) -> Int? {
        guard let regex = try? NSRegularExpression(
                  pattern: "(?:ANSI\\s?|AAMVA)\\d{6}(\\d{2})"
              ),
              let match = regex.firstMatch(
                  in: data,
                  range: NSRange(data.startIndex..., in: data)
              ),
              match.numberOfRanges >= 2,
              let versionRange = Range(match.range(at: 1), in: data) else {
            return nil
        }
        return Int(data[versionRange])
    }

    // MARK: - Date Format by Version + Country

    /// Returns the date format string based on AAMVA version and issuing country.
    ///
    /// | Version | US format   | Canada format |
    /// |---------|-------------|---------------|
    /// | 1       | yyyyMMdd    | yyyyMMdd      |
    /// | 2       | MMddyyyy    | MMddyyyy      |
    /// | 3+      | MMddyyyy    | yyyyMMdd      |
    private static func dateFormat(for version: Int?, country: String?) -> String {
        let isCanada = country?.uppercased() == "CAN"

        switch version {
        case 1:
            return "yyyyMMdd"
        case 2:
            return "MMddyyyy"
        default:
            return isCanada ? "yyyyMMdd" : "MMddyyyy"
        }
    }

    // MARK: - Data Element Extraction

    /// Extract AAMVA element codes and their values from raw barcode data.
    /// Handles standard separators (LF, CR, RS, GS), DL/ID subfile prefixes,
    /// and header lines with embedded field data.
    private static func extractDataElements(from data: String) -> [String: String] {
        var elements: [String: String] = [:]

        let separators = CharacterSet(charactersIn: "\n\r\u{1C}\u{1E}\u{1D}")
        let lines = data.components(separatedBy: separators)

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 3 else { continue }

            var codeLine = trimmed

            // Strip DL/ID subfile prefix when followed by a valid element code
            if (codeLine.hasPrefix("DL") || codeLine.hasPrefix("ID")) && codeLine.count >= 5 {
                let afterPrefix = String(codeLine.dropFirst(2))
                if let first = afterPrefix.first,
                   first == "D" || first == "P" || first == "Z" {
                    codeLine = afterPrefix
                }
            }

            let code = String(codeLine.prefix(3))

            // Valid AAMVA codes: 3 alphanumeric chars starting with D, P, or Z
            guard let first = code.first,
                  (first == "D" || first == "P" || first == "Z"),
                  code.count == 3,
                  code.allSatisfy({ $0.isUppercase || $0.isNumber }) else {
                // Check if this is an AAMVA header with embedded field data
                if codeLine.contains("ANSI") || codeLine.contains("AAMVA") {
                    extractHeaderElement(from: codeLine, into: &elements)
                }
                continue
            }

            let value = String(codeLine.dropFirst(3))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty {
                elements[code] = value
            }
        }

        return elements
    }

    /// Extract the first data element embedded in an AAMVA header line.
    /// Handles cases like "ANSI 636...DL00390187DLDAATESTER,JOEY" or
    /// "AAMVA6360060101DL00290179DAACTLIC,ADULT,A" where the first field
    /// code is concatenated with the header offset table.
    private static func extractHeaderElement(from line: String, into elements: inout [String: String]) {
        let chars = Array(line)
        var i = 15 // Skip past minimum header length (ANSI/AAMVA + IIN + version)
        while i < chars.count - 2 {
            // Check for DL/ID subfile marker followed by a valid field code
            if i + 4 < chars.count,
               (String(chars[i..<i+2]) == "DL" || String(chars[i..<i+2]) == "ID") {
                let codeStart = i + 2
                if codeStart + 3 <= chars.count {
                    let code = String(chars[codeStart..<codeStart+3])
                    if code.allSatisfy({ $0.isUppercase && $0.isLetter }),
                       let first = code.first,
                       (first == "D" || first == "P" || first == "Z") {
                        let valueStart = codeStart + 3
                        if valueStart < chars.count {
                            let value = String(chars[valueStart...])
                                .trimmingCharacters(in: .whitespacesAndNewlines)
                            if !value.isEmpty { elements[code] = value }
                        }
                        return
                    }
                }
                i += 2
                continue
            }

            // Check for field code directly after offset table digits (no DL/ID marker)
            if i + 3 <= chars.count {
                let code = String(chars[i..<i+3])
                if code.allSatisfy({ $0.isUppercase && $0.isLetter }),
                   let first = code.first,
                   (first == "D" || first == "P" || first == "Z"),
                   i > 0, chars[i-1].isNumber {
                    let valueStart = i + 3
                    if valueStart < chars.count {
                        let value = String(chars[valueStart...])
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if !value.isEmpty { elements[code] = value }
                    }
                    return
                }
            }

            i += 1
        }
    }

    // MARK: - Name Resolution

    /// Trim trailing commas and whitespace from name values (common AAMVA artifact).
    private static func cleanName(_ raw: String?) -> String? {
        guard var result = raw?.trimmingCharacters(in: .whitespaces),
              !result.isEmpty else { return nil }
        while result.hasSuffix(",") {
            result = String(result.dropLast()).trimmingCharacters(in: .whitespaces)
        }
        return result.isEmpty ? nil : result
    }

    /// Resolve first name across AAMVA versions.
    /// Priority: DAC (v1,v4+) → DCT first component (v1-3) → DAA second component (v1 composite)
    private static func resolveFirstName(_ e: [String: String]) -> String? {
        if let name = cleanName(e["DAC"]) { return name }

        // DCT (givenName) may contain "FIRST,MIDDLE" or just "FIRST"
        if let dct = e["DCT"], !dct.isEmpty {
            let parts = dct.split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
            if let first = parts.first, !first.isEmpty { return first }
        }

        // DAA (driverLicenseName): "LAST,FIRST,MIDDLE,SUFFIX"
        if let daa = e["DAA"], !daa.isEmpty {
            let parts = daa.split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
            if parts.count >= 2 { return parts[1] }
        }

        return nil
    }

    /// Resolve last name across AAMVA versions.
    /// Priority: DCS (v2+) → DAB (v1) → DAA first component (v1 composite)
    private static func resolveLastName(_ e: [String: String]) -> String? {
        if let name = cleanName(e["DCS"]) { return name }
        if let name = cleanName(e["DAB"]) { return name }

        // DAA (driverLicenseName): "LAST,FIRST,MIDDLE,SUFFIX"
        if let daa = e["DAA"], !daa.isEmpty {
            let parts = daa.split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
            if let first = parts.first, !first.isEmpty { return first }
        }

        return nil
    }

    /// Resolve middle name across AAMVA versions.
    /// Priority: DAD (v1,v4+) → DCT remaining components (v1-3) → DAA third component (v1 composite)
    private static func resolveMiddleName(_ e: [String: String]) -> String? {
        if let name = cleanName(e["DAD"]) { return name }

        // DCT: "FIRST,MIDDLE1,MIDDLE2" → join components after first
        if let dct = e["DCT"], !dct.isEmpty {
            let parts = dct.split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
            if parts.count >= 2 {
                let middles = parts.dropFirst().filter { !$0.isEmpty }
                if !middles.isEmpty { return middles.joined(separator: " ") }
            }
        }

        // DAA: "LAST,FIRST,MIDDLE,SUFFIX"
        if let daa = e["DAA"], !daa.isEmpty {
            let parts = daa.split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
            if parts.count >= 3, !parts[2].isEmpty { return parts[2] }
        }

        return nil
    }

    // MARK: - Field Parsing

    /// Parse AAMVA date string to ISO 8601.
    /// Uses the version-determined format first, falls back to the alternate format.
    private static func parseDate(_ dateString: String?, format: String) -> String? {
        guard let str = dateString, str.count == 8 else { return nil }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")

        // Try version-determined format first
        formatter.dateFormat = format
        if let date = formatter.date(from: str) {
            return isoString(from: date)
        }

        // Fallback to alternate format
        let fallback = (format == "MMddyyyy") ? "yyyyMMdd" : "MMddyyyy"
        formatter.dateFormat = fallback
        if let date = formatter.date(from: str) {
            return isoString(from: date)
        }

        return nil
    }

    private static func isoString(from date: Date) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withFullDate]
        return iso.string(from: date)
    }

    /// Map AAMVA sex code (1=M, 2=F, 9=X) to standard letter.
    private static func mapSex(_ code: String?) -> String? {
        guard let c = code?.trimmingCharacters(in: .whitespaces) else { return nil }
        switch c {
        case "1", "M": return "M"
        case "2", "F": return "F"
        case "9", "X": return "X"
        default: return nil
        }
    }

    /// Clean postal code: strip trailing "0000" padding from US 9-digit zips.
    /// Only applies to all-digit codes (US ZIP format), preserving Canadian alphanumeric codes.
    private static func cleanPostalCode(_ code: String?) -> String? {
        guard let c = code else { return nil }
        let trimmed = c.trimmingCharacters(in: .whitespaces)
        if trimmed.count == 9,
           trimmed.hasSuffix("0000"),
           trimmed.allSatisfy({ $0.isNumber }) {
            return String(trimmed.prefix(5))
        }
        return trimmed
    }
}
