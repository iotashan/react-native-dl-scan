import Foundation
import Vision
import os.log

/**
 * StateRuleEngine - State-Specific Parsing Rules for Driver's License OCR
 * 
 * Implements specialized parsing rules and patterns for the top 10 US states
 * (CA, TX, FL, NY, IL, PA, OH, GA, NC, MI) to handle license layout variations,
 * format differences, and state-specific field patterns.
 */
@objc public class StateRuleEngine: NSObject {
    
    // MARK: - Properties
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "StateRuleEngine")
    
    // Target states with specific parsing rules
    private let supportedStates: Set<String> = ["CA", "TX", "FL", "NY", "IL", "PA", "OH", "GA", "NC", "MI"]
    
    // State-specific license patterns
    private lazy var statePatterns: [String: StateLicensePattern] = {
        return initializeStatePatterns()
    }()
    
    // Compiled regex patterns cache
    private var compiledStatePatterns: [String: [String: NSRegularExpression]] = [:]
    
    // MARK: - Initialization
    
    @objc public override init() {
        super.init()
        compileStatePatterns()
    }
    
    // MARK: - Public Interface
    
    /**
     * Detect state from license content and format patterns
     */
    @objc public func detectState(from textObservations: [NormalizedTextObservation]) -> String? {
        os_log(.debug, log: logger, "Detecting state from %d text observations", textObservations.count)
        
        // Strategy 1: Look for explicit state identifiers
        if let explicitState = detectExplicitStateIdentifiers(from: textObservations) {
            os_log(.debug, log: logger, "State detected via explicit identifier: %@", explicitState)
            return explicitState
        }
        
        // Strategy 2: Analyze license number patterns
        if let patternState = detectStateFromLicensePattern(from: textObservations) {
            os_log(.debug, log: logger, "State detected via license number pattern: %@", patternState)
            return patternState
        }
        
        // Strategy 3: Address-based detection
        if let addressState = detectStateFromAddress(from: textObservations) {
            os_log(.debug, log: logger, "State detected via address: %@", addressState)
            return addressState
        }
        
        // Strategy 4: Layout-based detection
        if let layoutState = detectStateFromLayout(from: textObservations) {
            os_log(.debug, log: logger, "State detected via layout patterns: %@", layoutState)
            return layoutState
        }
        
        os_log(.debug, log: logger, "No state could be detected, using generic parsing")
        return nil
    }
    
    /**
     * Apply state-specific parsing rules to field extraction
     */
    @objc public func applyStateSpecificRules(
        for state: String,
        to basicFields: [String: FieldExtractionResult],
        from observations: [NormalizedTextObservation]
    ) -> [String: FieldExtractionResult] {
        
        guard supportedStates.contains(state) else {
            os_log(.debug, log: logger, "State %@ not supported, using generic parsing", state)
            return basicFields
        }
        
        os_log(.debug, log: logger, "Applying state-specific rules for: %@", state)
        
        var enhancedFields = basicFields
        
        // Apply state-specific license number validation and correction
        if let licenseResult = enhancedFields["licenseNumber"] {
            enhancedFields["licenseNumber"] = validateAndCorrectLicenseNumber(
                licenseResult, 
                for: state, 
                from: observations
            )
        }
        
        // Apply state-specific name parsing rules
        enhancedFields = applyStateSpecificNameParsing(enhancedFields, for: state, from: observations)
        
        // Apply state-specific address parsing
        enhancedFields = applyStateSpecificAddressParsing(enhancedFields, for: state, from: observations)
        
        // Apply state-specific date format handling
        enhancedFields = applyStateSpecificDateParsing(enhancedFields, for: state)
        
        // Apply state-specific OCR error corrections
        enhancedFields = applyStateSpecificOCRCorrections(enhancedFields, for: state)
        
        return enhancedFields
    }
    
    /**
     * Get state-specific confidence scoring weights
     */
    @objc public func getStateConfidenceWeights(for state: String) -> [String: Float] {
        guard let pattern = statePatterns[state] else {
            return getGenericConfidenceWeights()
        }
        
        return pattern.confidenceWeights
    }
    
    // MARK: - State Detection Methods
    
    /**
     * Detect state from explicit state identifiers in text
     */
    private func detectExplicitStateIdentifiers(from observations: [NormalizedTextObservation]) -> String? {
        let stateIdentifiers = [
            "CALIFORNIA": "CA", "CA": "CA",
            "TEXAS": "TX", "TX": "TX",
            "FLORIDA": "FL", "FL": "FL",
            "NEW YORK": "NY", "NY": "NY",
            "ILLINOIS": "IL", "IL": "IL",
            "PENNSYLVANIA": "PA", "PA": "PA",
            "OHIO": "OH", "OH": "OH",
            "GEORGIA": "GA", "GA": "GA",
            "NORTH CAROLINA": "NC", "NC": "NC",
            "MICHIGAN": "MI", "MI": "MI"
        ]
        
        for observation in observations {
            let text = observation.text.uppercased()
            for (identifier, state) in stateIdentifiers {
                if text.contains(identifier) {
                    return state
                }
            }
        }
        
        return nil
    }
    
    /**
     * Detect state from license number patterns
     */
    private func detectStateFromLicensePattern(from observations: [NormalizedTextObservation]) -> String? {
        // Extract potential license numbers
        let licensePatterns = [
            "([A-Z]\\d{7})",      // CA format
            "(\\d{8})",           // TX format
            "([A-Z]\\d{12})",     // FL format
            "(\\d{9})",           // NY format (9 digits)
            "(\\d{3}\\s?\\d{3}\\s?\\d{3})", // NY format (formatted)
            "([A-Z]\\d{11})"      // IL format
        ]
        
        for observation in observations {
            for pattern in licensePatterns {
                if let regex = getCompiledPattern(pattern, for: "generic"),
                   let match = regex.firstMatch(in: observation.text, options: [], range: NSRange(location: 0, length: observation.text.utf16.count)) {
                    
                    let licenseNumber = extractFromMatch(match, in: observation.text)
                    
                    // Match license number format to state
                    if licenseNumber.range(of: "^[A-Z]\\d{7}$", options: .regularExpression) != nil {
                        return "CA"
                    } else if licenseNumber.range(of: "^\\d{8}$", options: .regularExpression) != nil {
                        return "TX"
                    } else if licenseNumber.range(of: "^[A-Z]\\d{12}$", options: .regularExpression) != nil {
                        return "FL"
                    } else if licenseNumber.range(of: "^\\d{9}$", options: .regularExpression) != nil {
                        return "NY"
                    } else if licenseNumber.range(of: "^\\d{3}\\s?\\d{3}\\s?\\d{3}$", options: .regularExpression) != nil {
                        return "NY"
                    } else if licenseNumber.range(of: "^[A-Z]\\d{11}$", options: .regularExpression) != nil {
                        return "IL"
                    }
                }
            }
        }
        
        return nil
    }
    
    /**
     * Detect state from address information
     */
    private func detectStateFromAddress(from observations: [NormalizedTextObservation]) -> String? {
        let statePatterns = [
            ("CA", ["CALIFORNIA", "CA"]),
            ("TX", ["TEXAS", "TX"]),
            ("FL", ["FLORIDA", "FL"]),
            ("NY", ["NEW YORK", "NY"]),
            ("IL", ["ILLINOIS", "IL"]),
            ("PA", ["PENNSYLVANIA", "PA"]),
            ("OH", ["OHIO", "OH"]),
            ("GA", ["GEORGIA", "GA"]),
            ("NC", ["NORTH CAROLINA", "NC"]),
            ("MI", ["MICHIGAN", "MI"])
        ]
        
        for observation in observations {
            let text = observation.text.uppercased()
            
            // Look for state in typical address positions
            if text.contains("ADDRESS") || text.contains("ADDR") {
                for (state, patterns) in statePatterns {
                    for pattern in patterns {
                        if text.contains(pattern) {
                            return state
                        }
                    }
                }
            }
        }
        
        return nil
    }
    
    /**
     * Detect state from layout patterns and field positioning
     */
    private func detectStateFromLayout(from observations: [NormalizedTextObservation]) -> String? {
        // California: typically has "LAST, FIRST MIDDLE" name format
        // Texas: typically has "FIRST MIDDLE LAST" name format
        
        let nameObservations = observations.filter { obs in
            isLikelyNameText(obs.text)
        }
        
        for observation in nameObservations {
            let text = observation.text.uppercased()
            
            // California pattern: LAST, FIRST MIDDLE
            if text.contains(",") && text.range(of: "^[A-Z]+,\\s*[A-Z]+", options: .regularExpression) != nil {
                return "CA"
            }
        }
        
        return nil
    }
    
    // MARK: - State-Specific Rule Application
    
    /**
     * Validate and correct license number for specific state
     */
    private func validateAndCorrectLicenseNumber(
        _ result: FieldExtractionResult,
        for state: String,
        from observations: [NormalizedTextObservation]
    ) -> FieldExtractionResult {
        
        guard let pattern = statePatterns[state] else { return result }
        
        var correctedValue = result.value
        
        // Apply state-specific OCR corrections for license numbers
        switch state {
        case "CA":
            // California: 1 letter + 7 digits (e.g., D1234567)
            correctedValue = applyCaliforniaLicenseCorrections(correctedValue)
        case "TX":
            // Texas: 8 digits
            correctedValue = applyTexasLicenseCorrections(correctedValue)
        case "FL":
            // Florida: 1 letter + 12 digits
            correctedValue = applyFloridaLicenseCorrections(correctedValue)
        case "NY":
            // New York: 9 digits or formatted as XXX XXX XXX
            correctedValue = applyNewYorkLicenseCorrections(correctedValue)
        case "IL":
            // Illinois: 1 letter + 11 digits
            correctedValue = applyIllinoisLicenseCorrections(correctedValue)
        default:
            break
        }
        
        // Validate against state pattern
        if let regex = getCompiledPattern(pattern.licenseNumberPattern, for: state),
           regex.firstMatch(in: correctedValue, options: [], range: NSRange(location: 0, length: correctedValue.utf16.count)) != nil {
            
            return FieldExtractionResult(
                value: correctedValue,
                confidence: min(result.confidence + 0.1, 1.0), // Boost confidence for valid format
                extractionMethod: result.extractionMethod,
                boundingBox: result.boundingBox
            )
        }
        
        return result
    }
    
    /**
     * Apply state-specific name parsing rules
     */
    private func applyStateSpecificNameParsing(
        _ fields: [String: FieldExtractionResult],
        for state: String,
        from observations: [NormalizedTextObservation]
    ) -> [String: FieldExtractionResult] {
        
        var enhancedFields = fields
        
        guard let pattern = statePatterns[state] else { return enhancedFields }
        
        switch pattern.nameFormat {
        case .lastFirstMiddle:
            // California format: "LAST, FIRST MIDDLE"
            enhancedFields = parseLastFirstMiddleFormat(enhancedFields, from: observations)
        case .firstMiddleLast:
            // Texas format: "FIRST MIDDLE LAST"
            enhancedFields = parseFirstMiddleLastFormat(enhancedFields, from: observations)
        case .generic:
            break
        }
        
        return enhancedFields
    }
    
    /**
     * Apply state-specific address parsing
     */
    private func applyStateSpecificAddressParsing(
        _ fields: [String: FieldExtractionResult],
        for state: String,
        from observations: [NormalizedTextObservation]
    ) -> [String: FieldExtractionResult] {
        
        var enhancedFields = fields
        
        guard let pattern = statePatterns[state] else { return enhancedFields }
        
        // Apply state-specific address parsing based on typical line counts
        if pattern.addressLines > 2 {
            enhancedFields = parseMultiLineAddress(enhancedFields, from: observations, expectedLines: pattern.addressLines)
        }
        
        return enhancedFields
    }
    
    /**
     * Apply state-specific date parsing
     */
    private func applyStateSpecificDateParsing(
        _ fields: [String: FieldExtractionResult],
        for state: String
    ) -> [String: FieldExtractionResult] {
        
        var enhancedFields = fields
        
        guard let pattern = statePatterns[state] else { return enhancedFields }
        
        // Apply state-specific date format preferences
        for dateField in ["dateOfBirth", "expirationDate", "issueDate"] {
            if let dateResult = enhancedFields[dateField] {
                let correctedDate = validateDateWithStateFormat(dateResult.value, preferredFormat: pattern.dateFormat)
                
                if correctedDate != dateResult.value {
                    enhancedFields[dateField] = FieldExtractionResult(
                        value: correctedDate,
                        confidence: dateResult.confidence,
                        extractionMethod: dateResult.extractionMethod,
                        boundingBox: dateResult.boundingBox
                    )
                }
            }
        }
        
        return enhancedFields
    }
    
    /**
     * Apply state-specific OCR error corrections
     */
    private func applyStateSpecificOCRCorrections(
        _ fields: [String: FieldExtractionResult],
        for state: String
    ) -> [String: FieldExtractionResult] {
        
        var enhancedFields = fields
        
        guard let pattern = statePatterns[state] else { return enhancedFields }
        
        // Apply state-specific OCR corrections based on common errors
        for (fieldName, field) in enhancedFields {
            let correctedValue = applyStateOCRCorrections(field.value, for: state, field: fieldName)
            
            if correctedValue != field.value {
                enhancedFields[fieldName] = FieldExtractionResult(
                    value: correctedValue,
                    confidence: field.confidence,
                    extractionMethod: field.extractionMethod,
                    boundingBox: field.boundingBox
                )
            }
        }
        
        return enhancedFields
    }
    
    // MARK: - State-Specific Correction Methods
    
    private func applyCaliforniaLicenseCorrections(_ value: String) -> String {
        var corrected = value.uppercased().replacingOccurrences(of: " ", with: "")
        
        // California-specific OCR corrections for license numbers
        // Common patterns: D1234567, A1234567, etc.
        
        // Fix common OCR errors at the beginning (letter position)
        if corrected.count == 8 {
            let firstChar = String(corrected.prefix(1))
            let digits = String(corrected.dropFirst())
            
            // Common letter OCR errors
            var correctedFirstChar = firstChar
            switch firstChar {
            case "0": correctedFirstChar = "D" // 0 → D
            case "1": correctedFirstChar = "I" // 1 → I
            case "5": correctedFirstChar = "S" // 5 → S
            case "8": correctedFirstChar = "B" // 8 → B
            default: break
            }
            
            corrected = correctedFirstChar + digits
        }
        
        return corrected
    }
    
    private func applyTexasLicenseCorrections(_ value: String) -> String {
        var corrected = value.uppercased().replacingOccurrences(of: " ", with: "")
        
        // Texas: 8 digits only
        // Remove any letters that might be OCR errors
        corrected = String(corrected.compactMap { char in
            if char.isNumber {
                return char
            } else {
                // Convert common letter OCR errors to numbers
                switch char {
                case "O": return "0"
                case "I", "L": return "1" 
                case "S": return "5"
                case "B": return "8"
                default: return nil
                }
            }
        })
        
        return corrected
    }
    
    private func applyFloridaLicenseCorrections(_ value: String) -> String {
        var corrected = value.uppercased().replacingOccurrences(of: " ", with: "")
        
        // Florida: 1 letter + 12 digits
        if corrected.count == 13 {
            let firstChar = String(corrected.prefix(1))
            let digits = String(corrected.dropFirst())
            
            // Ensure first character is a letter
            var correctedFirstChar = firstChar
            switch firstChar {
            case "0": correctedFirstChar = "D"
            case "1": correctedFirstChar = "I"
            case "5": correctedFirstChar = "S"
            case "8": correctedFirstChar = "B"
            default: break
            }
            
            // Ensure remaining characters are digits
            let correctedDigits = String(digits.compactMap { char in
                if char.isNumber {
                    return char
                } else {
                    switch char {
                    case "O": return "0"
                    case "I", "L": return "1"
                    case "S": return "5"
                    case "B": return "8"
                    default: return nil
                    }
                }
            })
            
            corrected = correctedFirstChar + correctedDigits
        }
        
        return corrected
    }
    
    private func applyNewYorkLicenseCorrections(_ value: String) -> String {
        var corrected = value.uppercased()
        
        // New York: 9 digits, sometimes formatted as XXX XXX XXX
        corrected = corrected.replacingOccurrences(of: " ", with: "")
        
        // Convert letters to digits for NY format
        corrected = String(corrected.compactMap { char in
            if char.isNumber {
                return char
            } else {
                switch char {
                case "O": return "0"
                case "I", "L": return "1"
                case "S": return "5"
                case "B": return "8"
                default: return nil
                }
            }
        })
        
        return corrected
    }
    
    private func applyIllinoisLicenseCorrections(_ value: String) -> String {
        // Similar to California but with 11 digits after the letter
        var corrected = value.uppercased().replacingOccurrences(of: " ", with: "")
        
        if corrected.count == 12 {
            let firstChar = String(corrected.prefix(1))
            let digits = String(corrected.dropFirst())
            
            var correctedFirstChar = firstChar
            switch firstChar {
            case "0": correctedFirstChar = "D"
            case "1": correctedFirstChar = "I"
            case "5": correctedFirstChar = "S"
            case "8": correctedFirstChar = "B"
            default: break
            }
            
            corrected = correctedFirstChar + digits
        }
        
        return corrected
    }
    
    // MARK: - Name Parsing Methods
    
    private func parseLastFirstMiddleFormat(
        _ fields: [String: FieldExtractionResult],
        from observations: [NormalizedTextObservation]
    ) -> [String: FieldExtractionResult] {
        
        var enhancedFields = fields
        
        // Look for "LAST, FIRST MIDDLE" pattern
        for observation in observations {
            let text = observation.text.uppercased()
            
            if let commaRange = text.range(of: ",") {
                let lastName = String(text[..<commaRange.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                let remainingName = String(text[commaRange.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                
                let nameComponents = remainingName.components(separatedBy: " ").filter { !$0.isEmpty }
                
                if !lastName.isEmpty && nameComponents.count >= 1 {
                    enhancedFields["lastName"] = FieldExtractionResult(
                        value: lastName,
                        confidence: observation.confidence,
                        extractionMethod: .patternMatching,
                        boundingBox: observation.boundingBox
                    )
                    
                    enhancedFields["firstName"] = FieldExtractionResult(
                        value: nameComponents[0],
                        confidence: observation.confidence,
                        extractionMethod: .patternMatching,
                        boundingBox: observation.boundingBox
                    )
                    
                    break
                }
            }
        }
        
        return enhancedFields
    }
    
    private func parseFirstMiddleLastFormat(
        _ fields: [String: FieldExtractionResult],
        from observations: [NormalizedTextObservation]
    ) -> [String: FieldExtractionResult] {
        
        var enhancedFields = fields
        
        // Look for "FIRST MIDDLE LAST" pattern (no comma)
        let nameObservations = observations.filter { isLikelyNameText($0.text) }
        
        for observation in nameObservations {
            let text = observation.text.uppercased()
            let nameComponents = text.components(separatedBy: " ").filter { !$0.isEmpty }
            
            if nameComponents.count >= 2 && !text.contains(",") {
                enhancedFields["firstName"] = FieldExtractionResult(
                    value: nameComponents[0],
                    confidence: observation.confidence,
                    extractionMethod: .patternMatching,
                    boundingBox: observation.boundingBox
                )
                
                enhancedFields["lastName"] = FieldExtractionResult(
                    value: nameComponents.last!,
                    confidence: observation.confidence,
                    extractionMethod: .patternMatching,
                    boundingBox: observation.boundingBox
                )
                
                break
            }
        }
        
        return enhancedFields
    }
    
    // MARK: - Helper Methods
    
    private func parseMultiLineAddress(
        _ fields: [String: FieldExtractionResult],
        from observations: [NormalizedTextObservation],
        expectedLines: Int
    ) -> [String: FieldExtractionResult] {
        
        // Enhanced address parsing for states with specific line formats
        // This is a placeholder for more sophisticated address parsing
        return fields
    }
    
    private func validateDateWithStateFormat(_ dateString: String, preferredFormat: String) -> String {
        // State-specific date format validation and conversion
        // This is a placeholder for more sophisticated date parsing
        return dateString
    }
    
    private func applyStateOCRCorrections(_ value: String, for state: String, field: String) -> String {
        // Apply state and field-specific OCR corrections
        var corrected = value
        
        // Apply corrections based on state context
        switch state {
        case "CA", "FL", "IL":
            // States with letter-digit combinations
            if field == "licenseNumber" {
                // More conservative corrections for license numbers
                corrected = corrected.replacingOccurrences(of: "0", with: "O") // Only in letter positions
            }
        case "TX", "NY":
            // All-digit states
            if field == "licenseNumber" {
                corrected = corrected.replacingOccurrences(of: "O", with: "0")
                corrected = corrected.replacingOccurrences(of: "I", with: "1")
                corrected = corrected.replacingOccurrences(of: "S", with: "5")
                corrected = corrected.replacingOccurrences(of: "B", with: "8")
            }
        default:
            break
        }
        
        return corrected
    }
    
    private func isLikelyNameText(_ text: String) -> Bool {
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        
        guard cleanText.count >= 2 && cleanText.count <= 50 else { return false }
        guard cleanText.allSatisfy({ $0.isLetter || $0.isWhitespace || $0 == "'" || $0 == "-" || $0 == "," }) else { return false }
        
        let excludePatterns = [
            "DRIVER", "LICENSE", "IDENTIFICATION", "CALIFORNIA", "TEXAS", "FLORIDA",
            "EXPIRES", "ISSUED", "CLASS", "RESTRICTIONS", "ENDORSEMENTS", "ADDRESS"
        ]
        
        for pattern in excludePatterns {
            if cleanText.contains(pattern) { return false }
        }
        
        return true
    }
    
    private func getCompiledPattern(_ pattern: String, for state: String) -> NSRegularExpression? {
        if let statePatterns = compiledStatePatterns[state],
           let compiled = statePatterns[pattern] {
            return compiled
        }
        
        do {
            let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            
            if compiledStatePatterns[state] == nil {
                compiledStatePatterns[state] = [:]
            }
            compiledStatePatterns[state]![pattern] = regex
            
            return regex
        } catch {
            os_log(.error, log: logger, "Failed to compile pattern %@ for state %@", pattern, state)
            return nil
        }
    }
    
    private func extractFromMatch(_ match: NSTextCheckingResult, in text: String) -> String {
        let rangeIndex = match.numberOfRanges > 1 ? 1 : 0
        let range = match.range(at: rangeIndex)
        
        if let swiftRange = Range(range, in: text) {
            return String(text[swiftRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        
        return ""
    }
    
    private func getGenericConfidenceWeights() -> [String: Float] {
        return [
            "firstName": 0.15,
            "lastName": 0.15,
            "licenseNumber": 0.30,
            "address": 0.15,
            "dateOfBirth": 0.25
        ]
    }
    
    // MARK: - State Pattern Initialization
    
    private func initializeStatePatterns() -> [String: StateLicensePattern] {
        return [
            "CA": StateLicensePattern(
                licenseNumberPattern: "^[A-Z]\\d{7}$",
                nameFormat: .lastFirstMiddle,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.15,
                    "lastName": 0.15,
                    "licenseNumber": 0.35, // Higher weight for distinctive CA format
                    "address": 0.15,
                    "dateOfBirth": 0.20
                ]
            ),
            "TX": StateLicensePattern(
                licenseNumberPattern: "^\\d{8}$",
                nameFormat: .firstMiddleLast,
                addressLines: 2,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.20,
                    "lastName": 0.20,
                    "licenseNumber": 0.25, // Lower weight due to generic number format
                    "address": 0.15,
                    "dateOfBirth": 0.20
                ]
            ),
            "FL": StateLicensePattern(
                licenseNumberPattern: "^[A-Z]\\d{12}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.15,
                    "lastName": 0.15,
                    "licenseNumber": 0.40, // Very high weight for distinctive FL format
                    "address": 0.15,
                    "dateOfBirth": 0.15
                ]
            ),
            "NY": StateLicensePattern(
                licenseNumberPattern: "^\\d{9}$|^\\d{3}\\s?\\d{3}\\s?\\d{3}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.18,
                    "lastName": 0.18,
                    "licenseNumber": 0.28,
                    "address": 0.16,
                    "dateOfBirth": 0.20
                ]
            ),
            "IL": StateLicensePattern(
                licenseNumberPattern: "^[A-Z]\\d{11}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.15,
                    "lastName": 0.15,
                    "licenseNumber": 0.38, // High weight for distinctive IL format
                    "address": 0.15,
                    "dateOfBirth": 0.17
                ]
            ),
            "PA": StateLicensePattern(
                licenseNumberPattern: "^\\d{8}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: getGenericConfidenceWeights()
            ),
            "OH": StateLicensePattern(
                licenseNumberPattern: "^[A-Z]{2}\\d{6}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.15,
                    "lastName": 0.15,
                    "licenseNumber": 0.35,
                    "address": 0.15,
                    "dateOfBirth": 0.20
                ]
            ),
            "GA": StateLicensePattern(
                licenseNumberPattern: "^\\d{9}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: getGenericConfidenceWeights()
            ),
            "NC": StateLicensePattern(
                licenseNumberPattern: "^\\d{12}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: [
                    "firstName": 0.15,
                    "lastName": 0.15,
                    "licenseNumber": 0.35,
                    "address": 0.15,
                    "dateOfBirth": 0.20
                ]
            ),
            "MI": StateLicensePattern(
                licenseNumberPattern: "^[A-Z]\\s?\\d{3}\\s?\\d{3}\\s?\\d{3}\\s?\\d{3}$",
                nameFormat: .generic,
                addressLines: 3,
                dateFormat: "MM/dd/yyyy",
                confidenceWeights: getGenericConfidenceWeights()
            )
        ]
    }
    
    private func compileStatePatterns() {
        for (state, pattern) in statePatterns {
            _ = getCompiledPattern(pattern.licenseNumberPattern, for: state)
        }
    }
}

// MARK: - Supporting Data Structures

/**
 * State-specific license pattern configuration
 */
struct StateLicensePattern {
    let licenseNumberPattern: String
    let nameFormat: NameFormat
    let addressLines: Int
    let dateFormat: String
    let confidenceWeights: [String: Float]
}

/**
 * Name format variations by state
 */
enum NameFormat {
    case lastFirstMiddle  // "LAST, FIRST MIDDLE" (California)
    case firstMiddleLast  // "FIRST MIDDLE LAST" (Texas)
    case generic          // No specific format preference
}