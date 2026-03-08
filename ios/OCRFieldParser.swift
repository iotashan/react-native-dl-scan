import Foundation

/// Extracts driver's license fields from OCR-recognized text lines.
@objc public class OCRFieldParser: NSObject {

    /// Parse recognized text lines into license data fields.
    /// Returns nil if insufficient data could be extracted.
    @objc public static func parseFields(from lines: [String]) -> [String: Any]? {
        var result: [String: Any] = [:]

        let joined = lines.joined(separator: "\n")

        // Extract dates (MM/DD/YYYY, MM-DD-YYYY, MMDDYYYY patterns)
        let dates = extractDates(from: lines)

        // Try to identify name fields
        if let name = extractName(from: lines) {
            result["firstName"] = name.first
            result["lastName"] = name.last
            if let middle = name.middle {
                result["middleName"] = middle
            }
        }

        // License number — typically a label like "DL", "LIC", "LICENSE" followed by alphanumeric
        if let licenseNumber = extractLicenseNumber(from: lines) {
            result["licenseNumber"] = licenseNumber
        }

        // Assign dates by context (DOB is usually earliest, EXP latest)
        assignDates(dates, to: &result)

        // Address extraction
        if let address = extractAddress(from: lines) {
            result["street"] = address.street
            result["city"] = address.city
            result["state"] = address.state
            result["postalCode"] = address.zip
        }

        // Sex
        if let sex = extractSex(from: joined) {
            result["sex"] = sex
        }

        // Need at least a name or license number to consider it a valid parse
        guard result["firstName"] != nil || result["licenseNumber"] != nil else {
            return nil
        }

        return result
    }

    // MARK: - Field Extractors

    private static func extractName(from lines: [String]) -> (first: String, last: String, middle: String?)? {
        for (i, line) in lines.enumerated() {
            let upper = line.uppercased()

            // Look for labeled name fields
            if upper.hasPrefix("LN ") || upper.hasPrefix("LAST ") {
                let lastName = extractValue(after: ["LN", "LAST NAME", "LAST"], in: line)
                let firstName = findNearbyValue(for: ["FN", "FIRST NAME", "FIRST"], in: lines, near: i)
                if let ln = lastName, let fn = firstName {
                    let mn = findNearbyValue(for: ["MN", "MIDDLE NAME", "MIDDLE"], in: lines, near: i)
                    return (fn, ln, mn)
                }
            }

            if upper.hasPrefix("FN ") || upper.hasPrefix("FIRST ") {
                let firstName = extractValue(after: ["FN", "FIRST NAME", "FIRST"], in: line)
                let lastName = findNearbyValue(for: ["LN", "LAST NAME", "LAST"], in: lines, near: i)
                if let fn = firstName, let ln = lastName {
                    let mn = findNearbyValue(for: ["MN", "MIDDLE NAME", "MIDDLE"], in: lines, near: i)
                    return (fn, ln, mn)
                }
            }
        }

        return nil
    }

    private static func extractLicenseNumber(from lines: [String]) -> String? {
        let patterns = ["DL[:\\s]*([A-Z0-9]{6,15})",
                        "LIC(?:ENSE)?[:\\s#]*([A-Z0-9]{6,15})",
                        "LICENSE\\s*(?:NO|NUMBER|#)?[:\\s]*([A-Z0-9]{6,15})"]

        for line in lines {
            for pattern in patterns {
                if let match = line.range(of: pattern, options: .regularExpression, range: line.startIndex..<line.endIndex) {
                    let matched = String(line[match])
                    // Extract just the alphanumeric ID portion
                    if let idRange = matched.range(of: "[A-Z0-9]{6,15}", options: .regularExpression) {
                        return String(matched[idRange])
                    }
                }
            }
        }
        return nil
    }

    private static func extractDates(from lines: [String]) -> [String] {
        var dates: [String] = []
        let datePattern = "\\b(\\d{2}[/\\-]\\d{2}[/\\-]\\d{4})\\b"

        for line in lines {
            let regex = try? NSRegularExpression(pattern: datePattern)
            let nsRange = NSRange(line.startIndex..<line.endIndex, in: line)
            let matches = regex?.matches(in: line, range: nsRange) ?? []

            for match in matches {
                if let range = Range(match.range(at: 1), in: line) {
                    dates.append(String(line[range]))
                }
            }
        }

        return dates
    }

    private static func assignDates(_ dates: [String], to result: inout [String: Any]) {
        guard !dates.isEmpty else { return }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")

        let parsedDates: [(String, Date)] = dates.compactMap { dateStr in
            for fmt in ["MM/dd/yyyy", "MM-dd-yyyy"] {
                formatter.dateFormat = fmt
                if let date = formatter.date(from: dateStr) {
                    let iso = ISO8601DateFormatter()
                    iso.formatOptions = [.withFullDate]
                    return (iso.string(from: date), date)
                }
            }
            return nil
        }.sorted { $0.1 < $1.1 }

        if parsedDates.count >= 1 {
            result["dateOfBirth"] = parsedDates[0].0
        }
        if parsedDates.count >= 2 {
            result["expirationDate"] = parsedDates[parsedDates.count - 1].0
        }
        if parsedDates.count >= 3 {
            result["issueDate"] = parsedDates[1].0
        }
    }

    private static func extractAddress(from lines: [String]) -> (street: String, city: String, state: String, zip: String)? {
        // Look for a line with a ZIP code pattern at the end
        let cityStateZip = "([A-Za-z\\s]+)[,\\s]+([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)"

        for (i, line) in lines.enumerated() {
            if let match = line.range(of: cityStateZip, options: .regularExpression) {
                let regex = try? NSRegularExpression(pattern: cityStateZip)
                let nsRange = NSRange(line.startIndex..<line.endIndex, in: line)
                if let m = regex?.firstMatch(in: line, range: nsRange) {
                    let city = extractGroup(m, at: 1, in: line)?.trimmingCharacters(in: .whitespaces) ?? ""
                    let state = extractGroup(m, at: 2, in: line) ?? ""
                    let zip = extractGroup(m, at: 3, in: line) ?? ""

                    // Street is likely the line above
                    let street = i > 0 ? lines[i - 1] : ""

                    if !city.isEmpty && !state.isEmpty {
                        return (street, city, state, zip)
                    }
                }
            }
        }
        return nil
    }

    private static func extractSex(from text: String) -> String? {
        let upper = text.uppercased()
        if upper.contains("SEX M") || upper.contains("SEX: M") || upper.contains("MALE") {
            return "M"
        }
        if upper.contains("SEX F") || upper.contains("SEX: F") || upper.contains("FEMALE") {
            return "F"
        }
        if upper.contains("SEX X") || upper.contains("SEX: X") {
            return "X"
        }
        return nil
    }

    // MARK: - Helpers

    private static func extractValue(after labels: [String], in line: String) -> String? {
        let upper = line.uppercased()
        for label in labels {
            if let range = upper.range(of: label) {
                let afterLabel = line[range.upperBound...]
                    .trimmingCharacters(in: .whitespaces.union(.punctuationCharacters))
                if !afterLabel.isEmpty {
                    return afterLabel
                }
            }
        }
        return nil
    }

    private static func findNearbyValue(for labels: [String], in lines: [String], near index: Int) -> String? {
        let searchRange = max(0, index - 3)...min(lines.count - 1, index + 3)
        for i in searchRange {
            if let value = extractValue(after: labels, in: lines[i]) {
                return value
            }
        }
        return nil
    }

    private static func extractGroup(_ match: NSTextCheckingResult, at index: Int, in text: String) -> String? {
        let range = match.range(at: index)
        guard let swiftRange = Range(range, in: text) else { return nil }
        return String(text[swiftRange])
    }
}
