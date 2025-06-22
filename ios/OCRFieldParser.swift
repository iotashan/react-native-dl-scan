import Foundation
import Vision
import os.log

/**
 * OCRFieldParser - Core Parsing Engine for OCR Field Extraction
 * 
 * Implements intelligent field identification and extraction from Vision Framework
 * OCR text observations. Uses hybrid approach combining regex patterns with
 * positional analysis and contextual clues.
 */
@objc public class OCRFieldParser: NSObject {
    
    // MARK: - Properties
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "OCRFieldParser")
    
    // Pattern cache for performance optimization
    private var compiledPatterns: [String: NSRegularExpression] = [:]
    
    // Field extraction components
    private let textPreprocessor = TextPreprocessor()
    private let confidenceCalculator = ConfidenceCalculator()
    private let fieldValidator = FieldValidator()
    private let stateRuleEngine = StateRuleEngine()
    private let errorCorrector = ErrorCorrector()
    
    // Performance tracking
    private var lastProcessingTime: TimeInterval = 0
    
    // MARK: - Initialization
    
    @objc public override init() {
        super.init()
        compilePatterns()
    }
    
    // MARK: - Public Interface
    
    /**
     * Parse OCR text observations into structured license data
     * Entry point following existing LicenseParser pattern
     */
    @objc public func parseOCRFields(from textObservations: [[String: Any]], error: NSErrorPointer) -> [String: Any]? {
        let startTime = CFAbsoluteTimeGetCurrent()
        defer {
            lastProcessingTime = CFAbsoluteTimeGetCurrent() - startTime
            os_log(.debug, log: logger, "OCR field parsing took %.3f seconds", lastProcessingTime)
        }
        
        do {
            let licenseData = try extractFields(from: textObservations)
            return formatForReactNative(licenseData)
        } catch let swiftError {
            if let errorPointer = error {
                errorPointer.pointee = swiftError as NSError
            }
            return nil
        }
    }
    
    /**
     * Get last processing time for performance monitoring
     */
    @objc public func getLastProcessingTime() -> TimeInterval {
        return lastProcessingTime
    }
    
    // MARK: - Core Field Extraction
    
    /**
     * Extract structured license fields from text observations
     */
    private func extractFields(from observations: [[String: Any]]) throws -> OCRLicenseData {
        // Step 1: Preprocess and normalize text observations
        let normalizedObservations = textPreprocessor.normalizeObservations(observations)
        
        // Step 2: Detect state from license content
        let detectedState = stateRuleEngine.detectState(from: normalizedObservations)
        
        // Step 3: Extract individual fields using hybrid approach
        var extractedFields = performFieldExtraction(from: normalizedObservations)
        
        // Step 4: Apply state-specific parsing rules if state detected
        if let state = detectedState {
            os_log(.debug, log: logger, "Applying state-specific rules for: %@", state)
            extractedFields = stateRuleEngine.applyStateSpecificRules(
                for: state,
                to: extractedFields,
                from: normalizedObservations
            )
        } else {
            os_log(.debug, log: logger, "No state detected, using generic parsing rules")
        }
        
        // Step 5: Apply OCR error correction to extracted fields
        let correctedFields = errorCorrector.correctFields(
            extractedFields,
            detectedState: detectedState,
            from: normalizedObservations
        )
        
        // Step 6: Calculate confidence scores for each field
        let confidenceWeights = detectedState != nil ? 
            stateRuleEngine.getStateConfidenceWeights(for: detectedState!) : 
            stateRuleEngine.getStateConfidenceWeights(for: "generic")
        
        let fieldsWithConfidence = confidenceCalculator.calculateConfidenceScores(
            for: correctedFields,
            from: normalizedObservations,
            using: confidenceWeights
        )
        
        // Step 7: Validate and clean extracted data
        let validatedFields = fieldValidator.validateAndCleanFields(fieldsWithConfidence)
        
        // Step 8: Assemble final license data structure
        return assembleOCRLicenseData(from: validatedFields, detectedState: detectedState)
    }
    
    /**
     * Perform field extraction using hybrid regex + positional analysis
     */
    private func performFieldExtraction(from observations: [NormalizedTextObservation]) -> [String: FieldExtractionResult] {
        var extractedFields: [String: FieldExtractionResult] = [:]
        
        // Extract each field type using specialized patterns
        extractedFields["firstName"] = extractFirstName(from: observations)
        extractedFields["lastName"] = extractLastName(from: observations)
        extractedFields["licenseNumber"] = extractLicenseNumber(from: observations)
        extractedFields["dateOfBirth"] = extractDateOfBirth(from: observations)
        extractedFields["address"] = extractAddress(from: observations)
        extractedFields["expirationDate"] = extractExpirationDate(from: observations)
        extractedFields["issueDate"] = extractIssueDate(from: observations)
        extractedFields["sex"] = extractSex(from: observations)
        extractedFields["height"] = extractHeight(from: observations)
        extractedFields["weight"] = extractWeight(from: observations)
        extractedFields["eyeColor"] = extractEyeColor(from: observations)
        extractedFields["hairColor"] = extractHairColor(from: observations)
        extractedFields["licenseClass"] = extractLicenseClass(from: observations)
        extractedFields["restrictions"] = extractRestrictions(from: observations)
        extractedFields["endorsements"] = extractEndorsements(from: observations)
        
        return extractedFields
    }
    
    // MARK: - Field Extraction Methods (California/Texas focused initially)
    
    /**
     * Extract first name using patterns and positional analysis
     */
    private func extractFirstName(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        // Pattern-based extraction
        let patterns = [
            "(?:FIRST|GIVEN|FN|4D)\\s*:?\\s*([A-Z][A-Z\\s]{1,20})",
            "(?:LN|4C)\\s*([A-Z][A-Z\\s]{1,30})\\s*(?:FN|4D)\\s*([A-Z][A-Z\\s]{1,20})",
            "^([A-Z][A-Z\\s]{1,20})$" // Stand-alone name line
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "firstName") {
                return result
            }
        }
        
        // Positional analysis - look for name patterns in typical license layouts
        return extractNameUsingPositionalAnalysis(observations, nameType: .first)
    }
    
    /**
     * Extract last name using patterns and positional analysis
     */
    private func extractLastName(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:LAST|FAMILY|LN|4C)\\s*:?\\s*([A-Z][A-Z\\s]{1,30})",
            "^([A-Z][A-Z\\s]{1,30})\\s*,",  // Last name followed by comma
            "^([A-Z][A-Z\\s]{1,30})$" // Stand-alone name line (typically last name appears first)
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "lastName") {
                return result
            }
        }
        
        return extractNameUsingPositionalAnalysis(observations, nameType: .last)
    }
    
    /**
     * Extract license number using state-specific patterns
     */
    private func extractLicenseNumber(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        // California: Letter + 7 digits (e.g., D1234567)
        // Texas: 8 digits (e.g., 12345678)
        let patterns = [
            "(?:DL|LICENSE|ID|NO|4A)\\s*:?\\s*([A-Z]?\\d{7,8}[A-Z]?)",
            "([A-Z]\\d{7})",  // California format
            "(\\d{8})",       // Texas format
            "([A-Z]{1,2}\\d{6,8})", // Generic state variations
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "licenseNumber") {
                // Additional validation for license number format
                if isValidLicenseNumberFormat(result.value) {
                    return result
                }
            }
        }
        
        return nil
    }
    
    /**
     * Extract date of birth using multiple date formats
     */
    private func extractDateOfBirth(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:DOB|BORN|BIRTH|4B)\\s*:?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})",
            "(?:DOB|BORN|BIRTH|4B)\\s*:?\\s*(\\d{2,4}[/-]\\d{1,2}[/-]\\d{1,2})",
            "(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})" // Standalone date pattern
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "dateOfBirth") {
                // Validate date format and convert to standard format
                if let validatedDate = validateAndFormatDate(result.value) {
                    return FieldExtractionResult(
                        value: validatedDate,
                        confidence: result.confidence,
                        extractionMethod: result.extractionMethod,
                        boundingBox: result.boundingBox
                    )
                }
            }
        }
        
        return nil
    }
    
    /**
     * Extract address components using layout analysis
     */
    private func extractAddress(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        // Look for address patterns - typically on multiple lines
        var addressComponents: [String] = []
        var totalConfidence: Float = 0
        var boundingBoxes: [CGRect] = []
        
        // Street address patterns
        let streetPatterns = [
            "(?:ADDR|ADDRESS|8)\\s*:?\\s*([\\d]+\\s+[A-Z\\s]+(?:ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|CT|COURT))",
            "(\\d+\\s+[A-Z\\s]+(?:ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|CT|COURT))"
        ]
        
        for observation in observations {
            for pattern in streetPatterns {
                if let match = findMatch(pattern: pattern, in: observation.text) {
                    addressComponents.append(match)
                    totalConfidence += observation.confidence
                    boundingBoxes.append(observation.boundingBox)
                    break
                }
            }
        }
        
        if !addressComponents.isEmpty {
            let avgConfidence = totalConfidence / Float(addressComponents.count)
            let combinedBoundingBox = combineBoundingBoxes(boundingBoxes)
            
            return FieldExtractionResult(
                value: addressComponents.joined(separator: " "),
                confidence: avgConfidence,
                extractionMethod: .patternMatching,
                boundingBox: combinedBoundingBox
            )
        }
        
        return nil
    }
    
    /**
     * Extract expiration date
     */
    private func extractExpirationDate(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:EXP|EXPIRES|EXPIRATION|4A)\\s*:?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})",
            "(?:EXP|EXPIRES|EXPIRATION|4A)\\s*:?\\s*(\\d{2,4}[/-]\\d{1,2}[/-]\\d{1,2})"
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "expirationDate") {
                if let validatedDate = validateAndFormatDate(result.value) {
                    return FieldExtractionResult(
                        value: validatedDate,
                        confidence: result.confidence,
                        extractionMethod: result.extractionMethod,
                        boundingBox: result.boundingBox
                    )
                }
            }
        }
        
        return nil
    }
    
    /**
     * Extract issue date
     */
    private func extractIssueDate(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:ISS|ISSUED|ISSUE|4F)\\s*:?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})",
            "(?:ISS|ISSUED|ISSUE|4F)\\s*:?\\s*(\\d{2,4}[/-]\\d{1,2}[/-]\\d{1,2})"
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "issueDate") {
                if let validatedDate = validateAndFormatDate(result.value) {
                    return FieldExtractionResult(
                        value: validatedDate,
                        confidence: result.confidence,
                        extractionMethod: result.extractionMethod,
                        boundingBox: result.boundingBox
                    )
                }
            }
        }
        
        return nil
    }
    
    /**
     * Extract sex/gender
     */
    private func extractSex(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:SEX|GENDER|5)\\s*:?\\s*([MF])",
            "\\b([MF])\\b"  // Standalone M or F
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "sex") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract height
     */
    private func extractHeight(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:HGT|HEIGHT|6)\\s*:?\\s*(\\d['-]\\d{1,2}\"?)",
            "(?:HGT|HEIGHT|6)\\s*:?\\s*(\\d{3})",  // Height in cm
            "(\\d['-]\\d{1,2}\"?)"  // Standalone height format
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "height") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract weight
     */
    private func extractWeight(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:WGT|WEIGHT|7)\\s*:?\\s*(\\d{2,3})\\s*(?:LBS?)?",
            "(\\d{2,3})\\s*LBS?"  // Standalone weight
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "weight") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract eye color
     */
    private func extractEyeColor(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:EYES|EYE|9)\\s*:?\\s*(BRN|BLU|GRN|GRY|HAZ|BLK)",
            "\\b(BRN|BLU|GRN|GRY|HAZ|BLK)\\b"
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "eyeColor") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract hair color
     */
    private func extractHairColor(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:HAIR|10)\\s*:?\\s*(BRN|BLK|BLN|RED|GRY|WHI)",
            "\\b(BRN|BLK|BLN|RED|GRY|WHI)\\b"
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "hairColor") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract license class
     */
    private func extractLicenseClass(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:CLASS|CL|11)\\s*:?\\s*([A-Z]{1,3})",
            "\\b(CDL-[A-Z])\\b",
            "\\b([ABCM])\\b"  // Common license classes
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "licenseClass") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract restrictions
     */
    private func extractRestrictions(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:RESTRICTIONS|REST|12)\\s*:?\\s*([A-Z\\s,]+)",
            "CORRECTIVE LENSES",
            "DAYLIGHT ONLY",
            "NO FREEWAY"
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "restrictions") {
                return result
            }
        }
        
        return nil
    }
    
    /**
     * Extract endorsements
     */
    private func extractEndorsements(from observations: [NormalizedTextObservation]) -> FieldExtractionResult? {
        let patterns = [
            "(?:ENDORSEMENTS|END|13)\\s*:?\\s*([A-Z\\s,]+)",
            "MOTORCYCLE",
            "HAZMAT",
            "PASSENGER"
        ]
        
        for pattern in patterns {
            if let result = extractUsingPattern(pattern, from: observations, field: "endorsements") {
                return result
            }
        }
        
        return nil
    }
    
    // MARK: - Helper Methods
    
    /**
     * Extract field using regex pattern
     */
    private func extractUsingPattern(_ pattern: String, from observations: [NormalizedTextObservation], field: String) -> FieldExtractionResult? {
        guard let regex = getCompiledPattern(pattern) else { return nil }
        
        for observation in observations {
            let range = NSRange(location: 0, length: observation.text.utf16.count)
            if let match = regex.firstMatch(in: observation.text, options: [], range: range) {
                let extractedValue = extractFromMatch(match, in: observation.text)
                
                return FieldExtractionResult(
                    value: extractedValue,
                    confidence: observation.confidence,
                    extractionMethod: .patternMatching,
                    boundingBox: observation.boundingBox
                )
            }
        }
        
        return nil
    }
    
    /**
     * Get compiled regex pattern (cached for performance)
     */
    private func getCompiledPattern(_ pattern: String) -> NSRegularExpression? {
        if let cached = compiledPatterns[pattern] {
            return cached
        }
        
        do {
            let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            compiledPatterns[pattern] = regex
            return regex
        } catch {
            os_log(.error, log: logger, "Failed to compile regex pattern: %@", pattern)
            return nil
        }
    }
    
    /**
     * Extract text from regex match
     */
    private func extractFromMatch(_ match: NSTextCheckingResult, in text: String) -> String {
        // Use the first capture group if available, otherwise use the full match
        let rangeIndex = match.numberOfRanges > 1 ? 1 : 0
        let range = match.range(at: rangeIndex)
        
        if let swiftRange = Range(range, in: text) {
            return String(text[swiftRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        
        return ""
    }
    
    /**
     * Find pattern match in text
     */
    private func findMatch(pattern: String, in text: String) -> String? {
        guard let regex = getCompiledPattern(pattern) else { return nil }
        
        let range = NSRange(location: 0, length: text.utf16.count)
        if let match = regex.firstMatch(in: text, options: [], range: range) {
            return extractFromMatch(match, in: text)
        }
        
        return nil
    }
    
    /**
     * Validate license number format
     */
    private func isValidLicenseNumberFormat(_ licenseNumber: String) -> Bool {
        // Basic validation - license numbers are typically 7-9 characters
        let cleanNumber = licenseNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleanNumber.count >= 7 && cleanNumber.count <= 9
    }
    
    /**
     * Validate and format date string
     */
    private func validateAndFormatDate(_ dateString: String) -> String? {
        let cleanDate = dateString.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Try to parse various date formats
        let formatters = [
            "MM/dd/yyyy", "MM-dd-yyyy", "yyyy/MM/dd", "yyyy-MM-dd",
            "MM/dd/yy", "MM-dd-yy", "yy/MM/dd", "yy-MM-dd"
        ]
        
        for format in formatters {
            let formatter = DateFormatter()
            formatter.dateFormat = format
            if let date = formatter.date(from: cleanDate) {
                // Return in ISO format
                let isoFormatter = DateFormatter()
                isoFormatter.dateFormat = "yyyy-MM-dd"
                return isoFormatter.string(from: date)
            }
        }
        
        return nil
    }
    
    /**
     * Extract names using positional analysis
     */
    private func extractNameUsingPositionalAnalysis(_ observations: [NormalizedTextObservation], nameType: NameType) -> FieldExtractionResult? {
        // Names typically appear in the upper portion of the license
        // and are often the largest text blocks
        
        let upperObservations = observations.filter { obs in
            obs.boundingBox.origin.y > 0.7  // Upper 30% of document
        }
        
        let nameObservations = upperObservations.filter { obs in
            let text = obs.text.trimmingCharacters(in: .whitespacesAndNewlines)
            return isLikelyNameText(text)
        }
        
        // Sort by confidence and position
        let sortedNames = nameObservations.sorted { first, second in
            if abs(first.confidence - second.confidence) < 0.1 {
                // If confidence is similar, prefer left-most (for first name) or top-most
                return nameType == .first ? first.boundingBox.origin.x < second.boundingBox.origin.x
                                          : first.boundingBox.origin.y > second.boundingBox.origin.y
            }
            return first.confidence > second.confidence
        }
        
        if let bestMatch = sortedNames.first {
            return FieldExtractionResult(
                value: bestMatch.text,
                confidence: bestMatch.confidence,
                extractionMethod: .positionalAnalysis,
                boundingBox: bestMatch.boundingBox
            )
        }
        
        return nil
    }
    
    /**
     * Check if text is likely a name
     */
    private func isLikelyNameText(_ text: String) -> Bool {
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        
        // Basic name validation
        guard cleanText.count >= 2 && cleanText.count <= 30 else { return false }
        guard cleanText.allSatisfy({ $0.isLetter || $0.isWhitespace || $0 == "'" || $0 == "-" }) else { return false }
        
        // Exclude common non-name text
        let excludePatterns = [
            "DRIVER", "LICENSE", "IDENTIFICATION", "CALIFORNIA", "TEXAS",
            "EXPIRES", "ISSUED", "CLASS", "RESTRICTIONS", "ENDORSEMENTS"
        ]
        
        for pattern in excludePatterns {
            if cleanText.contains(pattern) { return false }
        }
        
        return true
    }
    
    /**
     * Combine multiple bounding boxes
     */
    private func combineBoundingBoxes(_ boxes: [CGRect]) -> CGRect {
        guard !boxes.isEmpty else { return CGRect.zero }
        
        var combinedBox = boxes[0]
        for box in boxes.dropFirst() {
            combinedBox = combinedBox.union(box)
        }
        
        return combinedBox
    }
    
    /**
     * Compile all regex patterns for performance
     */
    private func compilePatterns() {
        // Pre-compile commonly used patterns
        let commonPatterns = [
            "([A-Z]\\d{7})",  // CA license format
            "(\\d{8})",       // TX license format
            "(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})", // Date formats
            "([MF])",         // Gender
            "(\\d['-]\\d{1,2}\"?)", // Height format
        ]
        
        for pattern in commonPatterns {
            _ = getCompiledPattern(pattern)
        }
    }
    
    /**
     * Assemble final OCR license data structure
     */
    private func assembleOCRLicenseData(from fields: [String: ValidatedField]) -> OCRLicenseData {
        let fieldConfidences = fields.compactMapValues { $0.confidence }
        let extractionMethods = fields.compactMapValues { _ in "hybrid" } // Placeholder
        let correctionsSummary = fields.compactMapValues { _ in 0 } // Placeholder
        
        return OCRLicenseData(
            firstName: fields["firstName"]?.value,
            lastName: fields["lastName"]?.value,
            licenseNumber: fields["licenseNumber"]?.value,
            dateOfBirth: fields["dateOfBirth"]?.value,
            expirationDate: fields["expirationDate"]?.value,
            issueDate: fields["issueDate"]?.value,
            sex: fields["sex"]?.value,
            height: fields["height"]?.value,
            weight: fields["weight"]?.value,
            eyeColor: fields["eyeColor"]?.value,
            hairColor: fields["hairColor"]?.value,
            licenseClass: fields["licenseClass"]?.value,
            restrictions: fields["restrictions"]?.value,
            endorsements: fields["endorsements"]?.value,
            address: fields["address"]?.value,
            confidence: calculateOverallConfidence(from: fields),
            detectedState: nil,
            fieldConfidences: fieldConfidences,
            extractionMethods: extractionMethods,
            correctionsSummary: correctionsSummary
        )
    }
    
    /**
     * Assemble final OCR license data structure with detected state
     */
    private func assembleOCRLicenseData(from fields: [String: ValidatedField], detectedState: String?) -> OCRLicenseData {
        let fieldConfidences = fields.compactMapValues { $0.confidence }
        let extractionMethods = fields.compactMapValues { _ in "hybrid" } // Placeholder
        let correctionsSummary = fields.compactMapValues { _ in 0 } // Placeholder
        
        return OCRLicenseData(
            firstName: fields["firstName"]?.value,
            lastName: fields["lastName"]?.value,
            licenseNumber: fields["licenseNumber"]?.value,
            dateOfBirth: fields["dateOfBirth"]?.value,
            expirationDate: fields["expirationDate"]?.value,
            issueDate: fields["issueDate"]?.value,
            sex: fields["sex"]?.value,
            height: fields["height"]?.value,
            weight: fields["weight"]?.value,
            eyeColor: fields["eyeColor"]?.value,
            hairColor: fields["hairColor"]?.value,
            licenseClass: fields["licenseClass"]?.value,
            restrictions: fields["restrictions"]?.value,
            endorsements: fields["endorsements"]?.value,
            address: fields["address"]?.value,
            confidence: calculateOverallConfidence(from: fields),
            detectedState: detectedState,
            fieldConfidences: fieldConfidences,
            extractionMethods: extractionMethods,
            correctionsSummary: correctionsSummary
        )
    }
    
    /**
     * Calculate overall parsing confidence
     */
    private func calculateOverallConfidence(from fields: [String: ValidatedField]) -> Float {
        let validFields = fields.compactMap { $0.value.confidence }
        guard !validFields.isEmpty else { return 0.0 }
        
        return validFields.reduce(0.0, +) / Float(validFields.count)
    }
    
    
    /**
     * Format OCR license data for React Native (following existing pattern)
     */
    private func formatForReactNative(_ data: OCRLicenseData) -> [String: Any] {
        var result: [String: Any] = [:]
        
        // Personal Information
        if let firstName = data.firstName {
            result["firstName"] = firstName
        }
        if let lastName = data.lastName {
            result["lastName"] = lastName
        }
        
        // License Information
        if let licenseNumber = data.licenseNumber {
            result["licenseNumber"] = licenseNumber
        }
        if let licenseClass = data.licenseClass {
            result["licenseClass"] = licenseClass
        }
        
        // Dates
        if let dob = data.dateOfBirth {
            result["dateOfBirth"] = dob
        }
        if let expDate = data.expirationDate {
            result["expirationDate"] = expDate
        }
        if let issueDate = data.issueDate {
            result["issueDate"] = issueDate
        }
        
        // Physical characteristics
        if let sex = data.sex {
            result["sex"] = sex
        }
        if let height = data.height {
            result["height"] = height
        }
        if let weight = data.weight {
            result["weight"] = weight
        }
        if let eyeColor = data.eyeColor {
            result["eyeColor"] = eyeColor
        }
        if let hairColor = data.hairColor {
            result["hairColor"] = hairColor
        }
        
        // Address
        if let address = data.address {
            result["address"] = ["street": address]
        }
        
        // Additional fields
        if let restrictions = data.restrictions {
            result["restrictions"] = restrictions
        }
        if let endorsements = data.endorsements {
            result["endorsements"] = endorsements
        }
        
        // OCR-specific metadata
        result["ocrConfidence"] = data.confidence
        result["processingTime"] = lastProcessingTime
        result["extractionMethod"] = "OCR"
        
        // Field-level confidence metadata
        result["fieldConfidences"] = data.fieldConfidences
        result["extractionMethods"] = data.extractionMethods
        result["correctionsSummary"] = data.correctionsSummary
        
        // State detection metadata
        if let detectedState = data.detectedState {
            result["detectedState"] = detectedState
            result["stateSpecificRulesApplied"] = true
        } else {
            result["stateSpecificRulesApplied"] = false
        }
        
        return result
    }
}

// MARK: - Supporting Data Structures

/**
 * Normalized text observation for internal processing
 */
struct NormalizedTextObservation {
    let text: String
    let confidence: Float
    let boundingBox: CGRect
}

/**
 * Field extraction result with metadata
 */
struct FieldExtractionResult {
    let value: String
    let confidence: Float
    let extractionMethod: ExtractionMethod
    let boundingBox: CGRect
}

/**
 * Validated field with cleaned data
 */
struct ValidatedField {
    let value: String
    let confidence: Float?
    let isValid: Bool
}

/**
 * OCR-specific license data structure with confidence metadata
 */
struct OCRLicenseData {
    let firstName: String?
    let lastName: String?
    let licenseNumber: String?
    let dateOfBirth: String?
    let expirationDate: String?
    let issueDate: String?
    let sex: String?
    let height: String?
    let weight: String?
    let eyeColor: String?
    let hairColor: String?
    let licenseClass: String?
    let restrictions: String?
    let endorsements: String?
    let address: String?
    let confidence: Float
    let detectedState: String?
    
    // Field-level confidence metadata
    let fieldConfidences: [String: Float]
    let extractionMethods: [String: String]
    let correctionsSummary: [String: Int]  // Number of corrections applied per field
}

/**
 * Field extraction methods
 */
enum ExtractionMethod {
    case patternMatching
    case positionalAnalysis
    case contextualAnalysis
    case hybridApproach
}

/**
 * Name type for positional analysis
 */
enum NameType {
    case first
    case last
}

/**
 * ErrorCorrector - Comprehensive OCR Error Correction System
 */
class ErrorCorrector {
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "ErrorCorrector")
    
    // Character substitution tables for common OCR errors
    private let characterSubstitutions = CharacterSubstitutions()
    
    /**
     * Apply OCR error correction to extracted fields
     */
    func correctFields(
        _ fields: [String: FieldExtractionResult],
        detectedState: String?,
        from observations: [NormalizedTextObservation]
    ) -> [String: FieldExtractionResult] {
        
        var correctedFields: [String: FieldExtractionResult] = [:]
        
        for (fieldName, field) in fields {
            let correctedValue = applyFieldSpecificCorrections(
                value: field.value,
                fieldName: fieldName,
                detectedState: detectedState,
                observations: observations
            )
            
            // Track confidence impact of corrections
            let confidenceAdjustment = calculateConfidenceAdjustment(
                original: field.value,
                corrected: correctedValue,
                fieldName: fieldName
            )
            
            correctedFields[fieldName] = FieldExtractionResult(
                value: correctedValue,
                confidence: max(field.confidence + confidenceAdjustment, 0.0),
                extractionMethod: field.extractionMethod,
                boundingBox: field.boundingBox
            )
        }
        
        return correctedFields
    }
    
    /**
     * Apply field-specific OCR error corrections
     */
    private func applyFieldSpecificCorrections(
        value: String,
        fieldName: String,
        detectedState: String?,
        observations: [NormalizedTextObservation]
    ) -> String {
        
        var corrected = value
        
        // Apply field-specific correction strategies
        switch fieldName {
        case "firstName", "lastName":
            corrected = applyNameCorrections(corrected)
        case "licenseNumber":
            corrected = applyLicenseNumberCorrections(corrected, state: detectedState)
        case "dateOfBirth", "expirationDate", "issueDate":
            corrected = applyDateCorrections(corrected)
        case "address":
            corrected = applyAddressCorrections(corrected)
        case "sex":
            corrected = applySexCorrections(corrected)
        case "height":
            corrected = applyHeightCorrections(corrected)
        case "weight":
            corrected = applyWeightCorrections(corrected)
        case "eyeColor", "hairColor":
            corrected = applyColorCodeCorrections(corrected)
        case "licenseClass":
            corrected = applyLicenseClassCorrections(corrected)
        default:
            // Apply general character corrections for other fields
            corrected = applyGeneralCharacterCorrections(corrected)
        }
        
        // Apply context-aware corrections using surrounding observations
        corrected = applyContextAwareCorrections(
            corrected,
            fieldName: fieldName,
            observations: observations
        )
        
        // Apply state-specific corrections if state is detected
        if let state = detectedState {
            corrected = applyStateSpecificCorrections(
                corrected,
                fieldName: fieldName,
                state: state
            )
        }
        
        return corrected
    }
    
    /**
     * Apply name-specific OCR corrections (safe character substitutions)
     */
    private func applyNameCorrections(_ name: String) -> String {
        var corrected = name
        
        // Safe substitutions for names
        corrected = corrected.replacingOccurrences(of: "0", with: "O")  // 0 → O
        corrected = corrected.replacingOccurrences(of: "1", with: "I")  // 1 → I
        corrected = corrected.replacingOccurrences(of: "5", with: "S")  // 5 → S
        corrected = corrected.replacingOccurrences(of: "8", with: "B")  // 8 → B
        corrected = corrected.replacingOccurrences(of: "6", with: "G")  // 6 → G
        corrected = corrected.replacingOccurrences(of: "3", with: "E")  // 3 → E (less common)
        
        // Remove extra spaces and normalize
        corrected = corrected.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        corrected = corrected.trimmingCharacters(in: .whitespacesAndNewlines)
        
        return corrected
    }
    
    /**
     * Apply license number OCR corrections (context-aware)
     */
    private func applyLicenseNumberCorrections(_ licenseNumber: String, state: String?) -> String {
        var corrected = licenseNumber
        
        // State-specific license number corrections
        if let state = state {
            switch state {
            case "CA":
                // California: Letter + 7 digits (e.g., D1234567)
                corrected = applyCalifornaLicenseCorrections(corrected)
            case "TX":
                // Texas: 8 digits (e.g., 12345678)
                corrected = applyTexasLicenseCorrections(corrected)
            case "FL":
                // Florida: Letter + 12 digits (e.g., D123456789012)
                corrected = applyFloridaLicenseCorrections(corrected)
            case "NY":
                // New York: 9 digits or 1 letter + 18 digits
                corrected = applyNewYorkLicenseCorrections(corrected)
            default:
                corrected = applyGeneralLicenseCorrections(corrected)
            }
        } else {
            corrected = applyGeneralLicenseCorrections(corrected)
        }
        
        return corrected
    }
    
    /**
     * Apply date field OCR corrections
     */
    private func applyDateCorrections(_ date: String) -> String {
        var corrected = date
        
        // Common date OCR errors
        corrected = corrected.replacingOccurrences(of: "O", with: "0")  // O → 0 in dates
        corrected = corrected.replacingOccurrences(of: "l", with: "1")  // l → 1 in dates
        corrected = corrected.replacingOccurrences(of: "I", with: "1")  // I → 1 in dates
        corrected = corrected.replacingOccurrences(of: "S", with: "5")  // S → 5 in dates
        corrected = corrected.replacingOccurrences(of: "B", with: "8")  // B → 8 in dates
        corrected = corrected.replacingOccurrences(of: "G", with: "6")  // G → 6 in dates
        
        // Normalize date separators
        corrected = corrected.replacingOccurrences(of: "\\\\", with: "/")  // \ → /
        corrected = corrected.replacingOccurrences(of: "\\|", with: "/")  // | → /
        corrected = corrected.replacingOccurrences(of: "\\.", with: "/")  // . → /
        
        return corrected
    }
    
    /**
     * Apply address-specific OCR corrections
     */
    private func applyAddressCorrections(_ address: String) -> String {
        var corrected = address
        
        // Common street abbreviation corrections
        let addressSubstitutions = [
            "5T": "ST",      // 5T → ST (Street)
            "5TREET": "STREET",
            "AVE": "AVE",
            "BLVD": "BLVD",
            "RD": "RD",
            "DR": "DR",
            "LN": "LN",
            "CT": "CT"
        ]
        
        for (incorrect, correct) in addressSubstitutions {
            corrected = corrected.replacingOccurrences(of: incorrect, with: correct)
        }
        
        // Correct common number confusions in addresses
        corrected = corrected.replacingOccurrences(of: "O", with: "0")  // O → 0 in addresses
        corrected = corrected.replacingOccurrences(of: "l", with: "1")  // l → 1 in addresses
        
        return corrected
    }
    
    /**
     * Apply sex/gender field corrections
     */
    private func applySexCorrections(_ sex: String) -> String {
        let cleaned = sex.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Common sex field OCR errors
        switch cleaned {
        case "N", "H", "W":
            return "M"  // Common misreads of M
        case "E", "P":
            return "F"  // Common misreads of F
        default:
            return cleaned
        }
    }
    
    /**
     * Apply height field corrections
     */
    private func applyHeightCorrections(_ height: String) -> String {
        var corrected = height
        
        // Height-specific corrections
        corrected = corrected.replacingOccurrences(of: "O", with: "0")  // O → 0
        corrected = corrected.replacingOccurrences(of: "I", with: "1")  // I → 1
        corrected = corrected.replacingOccurrences(of: "S", with: "5")  // S → 5
        
        // Fix common quote/apostrophe confusion
        corrected = corrected.replacingOccurrences(of: "'", with: "'")  // Smart quote → apostrophe
        corrected = corrected.replacingOccurrences(of: """, with: "\"") // Smart quote → inch mark
        
        return corrected
    }
    
    /**
     * Apply weight field corrections
     */
    private func applyWeightCorrections(_ weight: String) -> String {
        var corrected = weight
        
        // Weight-specific corrections (numbers only)
        corrected = corrected.replacingOccurrences(of: "O", with: "0")  // O → 0
        corrected = corrected.replacingOccurrences(of: "I", with: "1")  // I → 1
        corrected = corrected.replacingOccurrences(of: "l", with: "1")  // l → 1
        corrected = corrected.replacingOccurrences(of: "S", with: "5")  // S → 5
        corrected = corrected.replacingOccurrences(of: "B", with: "8")  // B → 8
        corrected = corrected.replacingOccurrences(of: "G", with: "6")  // G → 6
        
        return corrected
    }
    
    /**
     * Apply color code corrections (eye/hair color)
     */
    private func applyColorCodeCorrections(_ color: String) -> String {
        let cleaned = color.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Common color code OCR errors
        let colorCorrections = [
            "8RN": "BRN",    // 8RN → BRN (Brown)
            "8LU": "BLU",    // 8LU → BLU (Blue)
            "8LK": "BLK",    // 8LK → BLK (Black)
            "6RN": "GRN",    // 6RN → GRN (Green)
            "HAL": "HAZ",    // HAL → HAZ (Hazel)
            "6RY": "GRY",    // 6RY → GRY (Gray)
            "WH1": "WHI",    // WH1 → WHI (White)
            "8LN": "BLN",    // 8LN → BLN (Blonde)
            "RE0": "RED"     // RE0 → RED (Red)
        ]
        
        return colorCorrections[cleaned] ?? cleaned
    }
    
    /**
     * Apply license class corrections
     */
    private func applyLicenseClassCorrections(_ licenseClass: String) -> String {
        let cleaned = licenseClass.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Common license class OCR errors
        let classCorrections = [
            "C0L": "CDL",    // C0L → CDL
            "CQL": "CDL",    // CQL → CDL
            "C8": "CB",      // C8 → CB
            "A8": "AB",      // A8 → AB
            "M0": "MC"       // M0 → MC (Motorcycle)
        ]
        
        return classCorrections[cleaned] ?? cleaned
    }
    
    /**
     * Apply general character corrections for miscellaneous fields
     */
    private func applyGeneralCharacterCorrections(_ text: String) -> String {
        var corrected = text
        
        // Apply basic character substitutions from lookup table
        for (incorrect, correct) in characterSubstitutions.basicSubstitutions {
            corrected = corrected.replacingOccurrences(of: incorrect, with: correct)
        }
        
        return corrected
    }
    
    /**
     * Apply context-aware corrections using surrounding text observations
     */
    private func applyContextAwareCorrections(
        _ value: String,
        fieldName: String,
        observations: [NormalizedTextObservation]
    ) -> String {
        // Look for contextual clues in nearby observations
        // This is a simplified implementation - could be enhanced with ML
        
        var corrected = value
        
        // Find observations that might provide context
        let contextObservations = observations.filter { obs in
            // Look for observations that contain field labels or related keywords
            let keywords = getContextKeywords(for: fieldName)
            return keywords.contains { keyword in
                obs.text.uppercased().contains(keyword)
            }
        }
        
        // Apply context-specific corrections based on nearby labels
        if !contextObservations.isEmpty {
            corrected = applyContextSpecificCorrections(corrected, fieldName: fieldName)
        }
        
        return corrected
    }
    
    /**
     * Apply state-specific OCR corrections
     */
    private func applyStateSpecificCorrections(
        _ value: String,
        fieldName: String,
        state: String
    ) -> String {
        // State-specific correction patterns
        switch state {
        case "CA":
            return applyCaliformaSpecificCorrections(value, fieldName: fieldName)
        case "TX":
            return applyTexasSpecificCorrections(value, fieldName: fieldName)
        case "FL":
            return applyFloridaSpecificCorrections(value, fieldName: fieldName)
        case "NY":
            return applyNewYorkSpecificCorrections(value, fieldName: fieldName)
        default:
            return value
        }
    }
    
    /**
     * Calculate confidence adjustment based on corrections applied
     */
    private func calculateConfidenceAdjustment(
        original: String,
        corrected: String,
        fieldName: String
    ) -> Float {
        // If no changes were made, no adjustment
        if original == corrected {
            return 0.0
        }
        
        // Calculate the extent of changes
        let changeRatio = Float(levenshteinDistance(original, corrected)) / Float(max(original.count, 1))
        
        // Minor corrections (like single character substitutions) increase confidence slightly
        // Major corrections decrease confidence
        if changeRatio <= 0.2 {
            return 0.1  // Small boost for minor corrections
        } else if changeRatio <= 0.5 {
            return 0.0  // Neutral for moderate corrections
        } else {
            return -0.1 // Small penalty for major corrections
        }
    }
    
    // MARK: - State-Specific Correction Methods
    
    private func applyCalifornaLicenseCorrections(_ license: String) -> String {
        var corrected = license
        
        // California format: Letter + 7 digits
        if corrected.count == 8 && corrected.first?.isLetter == true {
            // Apply digit corrections to the numeric part
            let firstChar = String(corrected.first!)
            let numericPart = String(corrected.dropFirst())
            let correctedNumeric = numericPart
                .replacingOccurrences(of: "O", with: "0")
                .replacingOccurrences(of: "I", with: "1")
                .replacingOccurrences(of: "S", with: "5")
                .replacingOccurrences(of: "B", with: "8")
            
            corrected = firstChar + correctedNumeric
        }
        
        return corrected
    }
    
    private func applyTexasLicenseCorrections(_ license: String) -> String {
        // Texas format: 8 digits
        return license
            .replacingOccurrences(of: "O", with: "0")
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "l", with: "1")
            .replacingOccurrences(of: "S", with: "5")
            .replacingOccurrences(of: "B", with: "8")
            .replacingOccurrences(of: "G", with: "6")
    }
    
    private func applyFloridaLicenseCorrections(_ license: String) -> String {
        // Florida format: Letter + 12 digits
        var corrected = license
        
        if corrected.count == 13 && corrected.first?.isLetter == true {
            let firstChar = String(corrected.first!)
            let numericPart = String(corrected.dropFirst())
            let correctedNumeric = numericPart
                .replacingOccurrences(of: "O", with: "0")
                .replacingOccurrences(of: "I", with: "1")
                .replacingOccurrences(of: "S", with: "5")
                .replacingOccurrences(of: "B", with: "8")
            
            corrected = firstChar + correctedNumeric
        }
        
        return corrected
    }
    
    private func applyNewYorkLicenseCorrections(_ license: String) -> String {
        // New York formats: 9 digits or 1 letter + 18 digits
        return license
            .replacingOccurrences(of: "O", with: "0")
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "l", with: "1")
            .replacingOccurrences(of: "S", with: "5")
            .replacingOccurrences(of: "B", with: "8")
    }
    
    private func applyGeneralLicenseCorrections(_ license: String) -> String {
        return license
            .replacingOccurrences(of: "O", with: "0")
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "l", with: "1")
            .replacingOccurrences(of: "S", with: "5")
            .replacingOccurrences(of: "B", with: "8")
    }
    
    private func applyCaliformaSpecificCorrections(_ value: String, fieldName: String) -> String {
        // California-specific OCR correction patterns
        return value // Placeholder - could add specific CA patterns
    }
    
    private func applyTexasSpecificCorrections(_ value: String, fieldName: String) -> String {
        // Texas-specific OCR correction patterns
        return value // Placeholder - could add specific TX patterns
    }
    
    private func applyFloridaSpecificCorrections(_ value: String, fieldName: String) -> String {
        // Florida-specific OCR correction patterns
        return value // Placeholder - could add specific FL patterns
    }
    
    private func applyNewYorkSpecificCorrections(_ value: String, fieldName: String) -> String {
        // New York-specific OCR correction patterns
        return value // Placeholder - could add specific NY patterns
    }
    
    private func applyContextSpecificCorrections(_ value: String, fieldName: String) -> String {
        // Apply corrections based on contextual field labels
        return value // Placeholder for context-aware corrections
    }
    
    private func getContextKeywords(for fieldName: String) -> [String] {
        switch fieldName {
        case "firstName":
            return ["FIRST", "GIVEN", "FN"]
        case "lastName":
            return ["LAST", "FAMILY", "LN"]
        case "licenseNumber":
            return ["DL", "LICENSE", "ID", "NO"]
        case "dateOfBirth":
            return ["DOB", "BORN", "BIRTH"]
        case "expirationDate":
            return ["EXP", "EXPIRES", "EXPIRATION"]
        default:
            return []
        }
    }
    
    /**
     * Calculate Levenshtein distance between two strings
     */
    private func levenshteinDistance(_ s1: String, _ s2: String) -> Int {
        let a = Array(s1)
        let b = Array(s2)
        let m = a.count
        let n = b.count
        
        var dp = Array(repeating: Array(repeating: 0, count: n + 1), count: m + 1)
        
        for i in 0...m {
            dp[i][0] = i
        }
        
        for j in 0...n {
            dp[0][j] = j
        }
        
        for i in 1...m {
            for j in 1...n {
                if a[i - 1] == b[j - 1] {
                    dp[i][j] = dp[i - 1][j - 1]
                } else {
                    dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
                }
            }
        }
        
        return dp[m][n]
    }
}

/**
 * Character substitution tables for OCR error correction
 */
struct CharacterSubstitutions {
    
    // Basic character substitution mappings
    let basicSubstitutions: [String: String] = [
        // Numbers confused with letters
        "0": "O",  // Context-dependent
        "1": "I",  // Context-dependent
        "5": "S",  // Context-dependent
        "8": "B",  // Context-dependent
        "6": "G",  // Context-dependent
        "3": "E",  // Less common
        "2": "Z",  // Very rare
        
        // Letters confused with numbers (reverse mappings applied contextually)
        "O": "0",  // Context-dependent
        "I": "1",  // Context-dependent
        "l": "1",  // Common lowercase l confusion
        "S": "5",  // Context-dependent
        "B": "8",  // Context-dependent
        "G": "6",  // Context-dependent
        "E": "3",  // Less common
        "Z": "2",  // Very rare
        
        // Common punctuation confusions
        "|": "I",  // Vertical bar to I
        "/": "7",  // Slash to 7 in some contexts
        "\\": "1", // Backslash to 1
        "'": "'",  // Smart quote normalization
        """: "\"", // Smart quote to regular quote
        """: "\"", // Smart quote to regular quote
        "–": "-",  // En dash to hyphen
        "—": "-",  // Em dash to hyphen
    ]
    
    // State-specific substitution patterns
    let stateSpecificSubstitutions: [String: [String: String]] = [
        "CA": [
            "0": "O",  // More aggressive O correction for CA
        ],
        "TX": [
            "1": "I",  // More aggressive I correction for TX
        ],
        "FL": [
            "5": "S",  // More aggressive S correction for FL
        ]
    ]
    
    // Field-specific substitution patterns
    let fieldSpecificSubstitutions: [String: [String: String]] = [
        "licenseNumber": [
            "O": "0",  // Prefer numbers in license numbers
            "I": "1",
            "l": "1",
            "S": "5",
            "B": "8",
            "G": "6"
        ],
        "firstName": [
            "0": "O",  // Prefer letters in names
            "1": "I",
            "5": "S",
            "8": "B",
            "6": "G",
            "3": "E"
        ],
        "lastName": [
            "0": "O",  // Prefer letters in names
            "1": "I",
            "5": "S",
            "8": "B",
            "6": "G",
            "3": "E"
        ],
        "dateOfBirth": [
            "O": "0",  // Prefer numbers in dates
            "I": "1",
            "l": "1",
            "S": "5",
            "B": "8",
            "G": "6"
        ]
    ]
}

// MARK: - Component Classes (to be implemented in separate files)

/**
 * Text preprocessing component
 */
class TextPreprocessor {
    func normalizeObservations(_ observations: [[String: Any]]) -> [NormalizedTextObservation] {
        return observations.compactMap { obs in
            guard let text = obs["text"] as? String,
                  let confidence = obs["confidence"] as? Float,
                  let boundingBoxDict = obs["boundingBox"] as? [String: Double] else {
                return nil
            }
            
            let boundingBox = CGRect(
                x: boundingBoxDict["x"] ?? 0,
                y: boundingBoxDict["y"] ?? 0,
                width: boundingBoxDict["width"] ?? 0,
                height: boundingBoxDict["height"] ?? 0
            )
            
            // Normalize text: trim whitespace, handle common OCR errors
            let normalizedText = normalizeOCRText(text)
            
            return NormalizedTextObservation(
                text: normalizedText,
                confidence: confidence,
                boundingBox: boundingBox
            )
        }
    }
    
    private func normalizeOCRText(_ text: String) -> String {
        var normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Convert to uppercase first
        normalized = normalized.uppercased()
        
        // Note: OCR error correction should be context-aware and done at the field level,
        // not globally. Global replacements can corrupt valid data like license numbers.
        // Field-specific corrections are handled in the respective extraction methods.
        
        return normalized
    }
}

/**
 * Confidence calculation component with multi-factor scoring
 */
class ConfidenceCalculator {
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "ConfidenceCalculator")
    
    // Confidence factor weights for multi-factor scoring
    private let confidenceWeights = ConfidenceWeights(
        ocrQuality: 0.3,
        patternMatch: 0.25,
        validation: 0.2,
        stateRules: 0.15,
        contextual: 0.1
    )
    
    func calculateConfidenceScores(for fields: [String: FieldExtractionResult], from observations: [NormalizedTextObservation]) -> [String: FieldExtractionResult] {
        var enhancedFields: [String: FieldExtractionResult] = [:]
        
        for (fieldName, field) in fields {
            let confidenceScore = calculateMultiFactorConfidence(
                for: field,
                fieldName: fieldName,
                from: observations
            )
            
            enhancedFields[fieldName] = FieldExtractionResult(
                value: field.value,
                confidence: confidenceScore,
                extractionMethod: field.extractionMethod,
                boundingBox: field.boundingBox
            )
        }
        
        return enhancedFields
    }
    
    func calculateConfidenceScores(for fields: [String: FieldExtractionResult], from observations: [NormalizedTextObservation], using weights: [String: Float]) -> [String: FieldExtractionResult] {
        var enhancedFields: [String: FieldExtractionResult] = [:]
        
        for (fieldName, field) in fields {
            // Calculate base multi-factor confidence
            let baseConfidence = calculateMultiFactorConfidence(
                for: field,
                fieldName: fieldName,
                from: observations
            )
            
            // Apply state-specific weight adjustment
            let stateWeight = weights[fieldName] ?? 0.0
            let adjustedConfidence = min(baseConfidence * (1.0 + stateWeight), 1.0)
            
            enhancedFields[fieldName] = FieldExtractionResult(
                value: field.value,
                confidence: adjustedConfidence,
                extractionMethod: field.extractionMethod,
                boundingBox: field.boundingBox
            )
        }
        
        return enhancedFields
    }
    
    /**
     * Calculate multi-factor confidence score using weighted algorithm
     */
    private func calculateMultiFactorConfidence(
        for field: FieldExtractionResult,
        fieldName: String,
        from observations: [NormalizedTextObservation]
    ) -> Float {
        
        // Factor 1: OCR Quality Confidence (from Vision Framework)
        let ocrQuality = field.confidence
        
        // Factor 2: Pattern Match Confidence (regex pattern strength)
        let patternMatch = calculatePatternMatchConfidence(field: field, fieldName: fieldName)
        
        // Factor 3: Validation Confidence (field format validation)
        let validation = calculateValidationConfidence(field: field, fieldName: fieldName)
        
        // Factor 4: State Rule Confidence (state-specific compliance)
        let stateRules = calculateStateRuleConfidence(field: field, fieldName: fieldName)
        
        // Factor 5: Contextual Confidence (cross-field consistency)
        let contextual = calculateContextualConfidence(field: field, fieldName: fieldName, from: observations)
        
        // Weighted combination
        let weightedScore = (ocrQuality * confidenceWeights.ocrQuality) +
                           (patternMatch * confidenceWeights.patternMatch) +
                           (validation * confidenceWeights.validation) +
                           (stateRules * confidenceWeights.stateRules) +
                           (contextual * confidenceWeights.contextual)
        
        let finalScore = min(max(weightedScore, 0.0), 1.0)
        
        os_log(.debug, log: logger, "Confidence for %@: OCR=%.2f, Pattern=%.2f, Validation=%.2f, State=%.2f, Contextual=%.2f, Final=%.2f",
               fieldName, ocrQuality, patternMatch, validation, stateRules, contextual, finalScore)
        
        return finalScore
    }
    
    /**
     * Calculate pattern match confidence based on regex pattern strength
     */
    private func calculatePatternMatchConfidence(field: FieldExtractionResult, fieldName: String) -> Float {
        switch field.extractionMethod {
        case .patternMatching:
            // High confidence for pattern-based extraction
            return calculatePatternStrength(field: field, fieldName: fieldName)
        case .positionalAnalysis:
            // Medium confidence for positional analysis
            return 0.7
        case .contextualAnalysis:
            // Medium-high confidence for contextual analysis
            return 0.75
        case .hybridApproach:
            // High confidence for hybrid approach
            return 0.85
        }
    }
    
    /**
     * Calculate pattern strength based on field type and value characteristics
     */
    private func calculatePatternStrength(field: FieldExtractionResult, fieldName: String) -> Float {
        let value = field.value
        
        switch fieldName {
        case "licenseNumber":
            // Strong patterns for license numbers
            if value.count >= 7 && value.count <= 9 {
                return 0.9
            } else if value.count >= 6 && value.count <= 10 {
                return 0.7
            }
            return 0.5
            
        case "dateOfBirth", "expirationDate", "issueDate":
            // Date format validation
            return isValidDateFormat(value) ? 0.9 : 0.4
            
        case "sex":
            // Simple M/F validation
            return (value == "M" || value == "F") ? 1.0 : 0.3
            
        case "firstName", "lastName":
            // Name pattern validation
            return isValidNamePattern(value) ? 0.8 : 0.5
            
        case "height":
            // Height format validation
            return isValidHeightFormat(value) ? 0.85 : 0.4
            
        case "weight":
            // Weight format validation
            return isValidWeightFormat(value) ? 0.85 : 0.4
            
        default:
            return 0.7 // Default confidence for other fields
        }
    }
    
    /**
     * Calculate validation confidence based on field format compliance
     */
    private func calculateValidationConfidence(field: FieldExtractionResult, fieldName: String) -> Float {
        let value = field.value.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Length-based validation
        let lengthValid = isValidFieldLength(value: value, fieldName: fieldName)
        
        // Format-based validation
        let formatValid = isValidFieldFormat(value: value, fieldName: fieldName)
        
        // Character set validation
        let charSetValid = isValidCharacterSet(value: value, fieldName: fieldName)
        
        // Combine validation factors
        let validationFactors = [lengthValid, formatValid, charSetValid]
        let validCount = validationFactors.filter { $0 }.count
        
        return Float(validCount) / Float(validationFactors.count)
    }
    
    /**
     * Calculate state rule confidence (placeholder for state-specific validation)
     */
    private func calculateStateRuleConfidence(field: FieldExtractionResult, fieldName: String) -> Float {
        // This will be enhanced with actual state-specific rules
        // For now, return medium confidence
        return 0.7
    }
    
    /**
     * Calculate contextual confidence based on cross-field relationships
     */
    private func calculateContextualConfidence(field: FieldExtractionResult, fieldName: String, from observations: [NormalizedTextObservation]) -> Float {
        // Look for supporting evidence in nearby text observations
        let fieldBounds = field.boundingBox
        let nearbyObservations = observations.filter { obs in
            // Check if observation is near the field
            let distance = sqrt(pow(obs.boundingBox.midX - fieldBounds.midX, 2) + 
                              pow(obs.boundingBox.midY - fieldBounds.midY, 2))
            return distance < 0.2 // Within 20% of document size
        }
        
        // Look for contextual keywords that support the field
        let supportingKeywords = getSupportingKeywords(for: fieldName)
        var keywordMatches = 0
        
        for observation in nearbyObservations {
            for keyword in supportingKeywords {
                if observation.text.uppercased().contains(keyword) {
                    keywordMatches += 1
                    break
                }
            }
        }
        
        // Calculate contextual confidence based on supporting evidence
        if keywordMatches > 0 {
            return min(0.8 + Float(keywordMatches) * 0.1, 1.0)
        }
        
        return 0.5 // Neutral confidence when no contextual evidence
    }
    
    // MARK: - Helper Methods
    
    private func isValidDateFormat(_ dateString: String) -> Bool {
        let datePattern = "^\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}$"
        return dateString.range(of: datePattern, options: .regularExpression) != nil
    }
    
    private func isValidNamePattern(_ name: String) -> Bool {
        let namePattern = "^[A-Za-z][A-Za-z\\s'-]{1,29}$"
        return name.range(of: namePattern, options: .regularExpression) != nil
    }
    
    private func isValidHeightFormat(_ height: String) -> Bool {
        let heightPattern = "^\\d['-]\\d{1,2}\"?$|^\\d{3}$"
        return height.range(of: heightPattern, options: .regularExpression) != nil
    }
    
    private func isValidWeightFormat(_ weight: String) -> Bool {
        let weightPattern = "^\\d{2,3}$"
        return weight.range(of: weightPattern, options: .regularExpression) != nil
    }
    
    private func isValidFieldLength(value: String, fieldName: String) -> Bool {
        switch fieldName {
        case "firstName", "lastName":
            return value.count >= 2 && value.count <= 30
        case "licenseNumber":
            return value.count >= 6 && value.count <= 10
        case "sex":
            return value.count == 1
        case "height":
            return value.count >= 3 && value.count <= 6
        case "weight":
            return value.count >= 2 && value.count <= 3
        default:
            return value.count >= 1 && value.count <= 50
        }
    }
    
    private func isValidFieldFormat(value: String, fieldName: String) -> Bool {
        switch fieldName {
        case "dateOfBirth", "expirationDate", "issueDate":
            return isValidDateFormat(value)
        case "firstName", "lastName":
            return isValidNamePattern(value)
        case "height":
            return isValidHeightFormat(value)
        case "weight":
            return isValidWeightFormat(value)
        case "sex":
            return value.uppercased() == "M" || value.uppercased() == "F"
        default:
            return true // No specific format requirements
        }
    }
    
    private func isValidCharacterSet(value: String, fieldName: String) -> Bool {
        switch fieldName {
        case "firstName", "lastName":
            return value.allSatisfy { $0.isLetter || $0.isWhitespace || $0 == "'" || $0 == "-" }
        case "licenseNumber":
            return value.allSatisfy { $0.isLetter || $0.isNumber }
        case "dateOfBirth", "expirationDate", "issueDate":
            return value.allSatisfy { $0.isNumber || $0 == "/" || $0 == "-" }
        case "sex":
            return value.uppercased() == "M" || value.uppercased() == "F"
        case "height":
            return value.allSatisfy { $0.isNumber || $0 == "'" || $0 == "\"" || $0 == "-" }
        case "weight":
            return value.allSatisfy { $0.isNumber }
        default:
            return true // No specific character set requirements
        }
    }
    
    private func getSupportingKeywords(for fieldName: String) -> [String] {
        switch fieldName {
        case "firstName":
            return ["FIRST", "GIVEN", "FN", "4D"]
        case "lastName":
            return ["LAST", "FAMILY", "LN", "4C"]
        case "licenseNumber":
            return ["DL", "LICENSE", "ID", "NO", "4A"]
        case "dateOfBirth":
            return ["DOB", "BORN", "BIRTH", "4B"]
        case "expirationDate":
            return ["EXP", "EXPIRES", "EXPIRATION"]
        case "issueDate":
            return ["ISS", "ISSUED", "ISSUE"]
        case "sex":
            return ["SEX", "GENDER", "5"]
        case "height":
            return ["HGT", "HEIGHT", "6"]
        case "weight":
            return ["WGT", "WEIGHT", "7"]
        case "address":
            return ["ADDR", "ADDRESS", "8"]
        case "eyeColor":
            return ["EYES", "EYE", "9"]
        case "hairColor":
            return ["HAIR", "10"]
        case "licenseClass":
            return ["CLASS", "CL", "11"]
        case "restrictions":
            return ["RESTRICTIONS", "REST", "12"]
        case "endorsements":
            return ["ENDORSEMENTS", "END", "13"]
        default:
            return []
        }
    }
}

/**
 * Confidence factor weights for multi-factor scoring
 */
struct ConfidenceWeights {
    let ocrQuality: Float     // Vision Framework confidence
    let patternMatch: Float   // Regex pattern match strength
    let validation: Float     // Field format validation
    let stateRules: Float     // State-specific rule compliance
    let contextual: Float     // Cross-field consistency
}

/**
 * Confidence thresholds for field acceptance
 */
struct ConfidenceThresholds {
    
    // Field-specific confidence thresholds (0.0 - 1.0)
    private let thresholds: [String: Float] = [
        // Critical identification fields require higher confidence
        "firstName": 0.7,
        "lastName": 0.7,
        "licenseNumber": 0.8,      // Very important for ID verification
        "dateOfBirth": 0.75,       // Important for age verification
        
        // Secondary identification fields
        "expirationDate": 0.7,
        "issueDate": 0.6,
        "sex": 0.8,                // Simple M/F should be highly confident
        
        // Physical characteristics (less critical)
        "height": 0.6,
        "weight": 0.6,
        "eyeColor": 0.5,
        "hairColor": 0.5,
        
        // License details
        "licenseClass": 0.6,
        "restrictions": 0.5,       // Often optional
        "endorsements": 0.5,       // Often optional
        
        // Address (less critical for identification)
        "address": 0.5
    ]
    
    // Default threshold for fields not specifically configured
    private let defaultThreshold: Float = 0.6
    
    /**
     * Get confidence threshold for specific field
     */
    func getThreshold(for fieldName: String) -> Float {
        return thresholds[fieldName] ?? defaultThreshold
    }
    
    /**
     * Get all thresholds for debugging/monitoring
     */
    func getAllThresholds() -> [String: Float] {
        return thresholds
    }
    
    /**
     * Check if field meets minimum confidence requirements
     */
    func meetsThreshold(_ confidence: Float, for fieldName: String) -> Bool {
        return confidence >= getThreshold(for: fieldName)
    }
    
    /**
     * Calculate confidence margin (how much above/below threshold)
     */
    func getConfidenceMargin(_ confidence: Float, for fieldName: String) -> Float {
        return confidence - getThreshold(for: fieldName)
    }
}

/**
 * Field validation component with confidence-based acceptance thresholds
 */
class FieldValidator {
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "FieldValidator")
    
    // Confidence thresholds for field acceptance
    private let confidenceThresholds = ConfidenceThresholds()
    
    func validateAndCleanFields(_ fields: [String: FieldExtractionResult]) -> [String: ValidatedField] {
        var validatedFields: [String: ValidatedField] = [:]
        
        for (fieldName, field) in fields {
            let cleanedValue = cleanFieldValue(field.value, for: fieldName)
            let formatValid = validateField(cleanedValue, for: fieldName)
            let confidenceValid = validateFieldConfidence(field.confidence, for: fieldName)
            
            // Field is valid if both format and confidence meet thresholds
            let isValid = formatValid && confidenceValid
            
            // Log confidence-based rejections
            if formatValid && !confidenceValid {
                os_log(.debug, log: logger, "Field %@ rejected due to low confidence: %.2f < %.2f", 
                       fieldName, field.confidence, confidenceThresholds.getThreshold(for: fieldName))
            }
            
            validatedFields[fieldName] = ValidatedField(
                value: cleanedValue,
                confidence: field.confidence,
                isValid: isValid
            )
        }
        
        return validatedFields
    }
    
    /**
     * Validate field confidence against acceptance thresholds
     */
    private func validateFieldConfidence(_ confidence: Float, for fieldName: String) -> Bool {
        let threshold = confidenceThresholds.getThreshold(for: fieldName)
        return confidence >= threshold
    }
    
    private func cleanFieldValue(_ value: String, for fieldName: String) -> String {
        var cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Field-specific cleaning
        switch fieldName {
        case "firstName", "lastName":
            cleaned = cleaned.capitalized
        case "licenseNumber":
            cleaned = cleaned.uppercased().replacingOccurrences(of: " ", with: "")
        case "sex":
            cleaned = cleaned.uppercased()
        default:
            break
        }
        
        return cleaned
    }
    
    private func validateField(_ value: String, for fieldName: String) -> Bool {
        switch fieldName {
        case "licenseNumber":
            return value.count >= 7 && value.count <= 9
        case "sex":
            return value == "M" || value == "F"
        case "firstName", "lastName":
            return value.count >= 2 && value.count <= 30
        default:
            return !value.isEmpty
        }
    }
}