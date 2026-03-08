import Foundation

/// Parses AAMVA-standard PDF417 barcode data from US driver's licenses.
@objc public class AAMVAParser: NSObject {

    /// Parse raw AAMVA barcode string into a dictionary of license fields.
    /// Returns nil if the data is not valid AAMVA format.
    @objc public static func parse(_ rawData: String) -> [String: Any]? {
        guard rawData.contains("ANSI") || rawData.contains("AAMVA") else {
            return nil
        }

        let elements = extractDataElements(from: rawData)
        guard !elements.isEmpty else { return nil }

        var result: [String: Any] = [:]

        // Personal information
        result["lastName"] = elements["DCS"]
        result["firstName"] = elements["DCT"] ?? elements["DAC"]
        result["middleName"] = elements["DAD"]

        // License number
        result["licenseNumber"] = elements["DAQ"]

        // Dates (convert MMDDYYYY or YYYYMMDD to ISO 8601)
        result["dateOfBirth"] = parseDate(elements["DBB"])
        result["expirationDate"] = parseDate(elements["DBA"])
        result["issueDate"] = parseDate(elements["DBD"])

        // Physical characteristics
        result["sex"] = mapSex(elements["DBC"])
        result["eyeColor"] = elements["DAY"]
        result["height"] = elements["DAU"]

        // Address
        result["street"] = elements["DAG"]
        result["city"] = elements["DAI"]
        result["state"] = elements["DAJ"]
        result["postalCode"] = cleanPostalCode(elements["DAK"])
        result["country"] = elements["DCG"] ?? "USA"

        // License classification
        result["vehicleClass"] = elements["DCA"]
        result["restrictions"] = elements["DCB"]
        result["endorsements"] = elements["DCD"]

        return result
    }

    // MARK: - Data Element Extraction

    /// Extract 3-character AAMVA element codes and their values from raw barcode data.
    private static func extractDataElements(from data: String) -> [String: String] {
        var elements: [String: String] = [:]

        // Split on common AAMVA record separators
        let separators = CharacterSet(charactersIn: "\n\r\u{1E}\u{1D}")
        let lines = data.components(separatedBy: separators)

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 3 else { continue }

            let code = String(trimmed.prefix(3))

            // Valid AAMVA codes start with D and are 3 uppercase alphanumeric chars
            guard code.first == "D",
                  code.allSatisfy({ $0.isLetter || $0.isNumber }) else {
                continue
            }

            let value = String(trimmed.dropFirst(3))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty {
                elements[code] = value
            }
        }

        return elements
    }

    // MARK: - Field Parsing

    /// Parse AAMVA date (MMDDYYYY or YYYYMMDD) to ISO 8601 string.
    private static func parseDate(_ dateString: String?) -> String? {
        guard let str = dateString, str.count == 8 else { return nil }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")

        // Try MMDDYYYY first (most common)
        formatter.dateFormat = "MMddyyyy"
        if let date = formatter.date(from: str) {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withFullDate]
            return iso.string(from: date)
        }

        // Try YYYYMMDD
        formatter.dateFormat = "yyyyMMdd"
        if let date = formatter.date(from: str) {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withFullDate]
            return iso.string(from: date)
        }

        return nil
    }

    /// Map AAMVA sex code (1=M, 2=F, 9=X) to standard letter.
    private static func mapSex(_ code: String?) -> String? {
        guard let c = code?.trimmingCharacters(in: .whitespaces) else { return nil }
        switch c {
        case "1", "M": return "M"
        case "2", "F": return "F"
        case "9", "X": return "X"
        default: return c
        }
    }

    /// Clean postal code (remove trailing spaces/zeros padding).
    private static func cleanPostalCode(_ code: String?) -> String? {
        guard let c = code else { return nil }
        // AAMVA often pads ZIP to 11 chars (ZIP+4 with trailing zeros)
        let trimmed = c.trimmingCharacters(in: .whitespaces)
        if trimmed.count > 5 && trimmed.hasSuffix("0000") {
            return String(trimmed.prefix(5))
        }
        return trimmed
    }
}
