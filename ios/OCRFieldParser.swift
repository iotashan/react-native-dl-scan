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
        
        // Step 5: Calculate confidence scores for each field
        let confidenceWeights = detectedState != nil ? 
            stateRuleEngine.getStateConfidenceWeights(for: detectedState!) : 
            stateRuleEngine.getStateConfidenceWeights(for: "generic")
        
        let fieldsWithConfidence = confidenceCalculator.calculateConfidenceScores(
            for: extractedFields,
            from: normalizedObservations,
            using: confidenceWeights
        )
        
        // Step 6: Validate and clean extracted data
        let validatedFields = fieldValidator.validateAndCleanFields(fieldsWithConfidence)
        
        // Step 7: Assemble final license data structure
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
                // Apply name-specific OCR corrections (safe for names)
                let correctedName = applyNameOCRCorrections(result.value)
                return FieldExtractionResult(
                    value: correctedName,
                    confidence: result.confidence,
                    extractionMethod: result.extractionMethod,
                    boundingBox: result.boundingBox
                )
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
                // Apply name-specific OCR corrections (safe for names)
                let correctedName = applyNameOCRCorrections(result.value)
                return FieldExtractionResult(
                    value: correctedName,
                    confidence: result.confidence,
                    extractionMethod: result.extractionMethod,
                    boundingBox: result.boundingBox
                )
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
            // Apply name-specific OCR corrections
            let correctedName = applyNameOCRCorrections(bestMatch.text)
            return FieldExtractionResult(
                value: correctedName,
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
            detectedState: nil
        )
    }
    
    /**
     * Assemble final OCR license data structure with detected state
     */
    private func assembleOCRLicenseData(from fields: [String: ValidatedField], detectedState: String?) -> OCRLicenseData {
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
            detectedState: detectedState
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
     * Apply name-specific OCR corrections
     * Safe to convert 0 to O and 1 to I in name contexts
     */
    private func applyNameOCRCorrections(_ name: String) -> String {
        var corrected = name
        
        // Common OCR errors in names (safe conversions)
        corrected = corrected.replacingOccurrences(of: "0", with: "O")  // 0 → O (e.g., J0HN → JOHN)
        corrected = corrected.replacingOccurrences(of: "1", with: "I")  // 1 → I (e.g., MAR1A → MARIA)
        corrected = corrected.replacingOccurrences(of: "5", with: "S")  // 5 → S (e.g., JE55ICA → JESSICA)
        corrected = corrected.replacingOccurrences(of: "8", with: "B")  // 8 → B (less common but possible)
        
        return corrected
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
 * OCR-specific license data structure
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
 * Confidence calculation component
 */
class ConfidenceCalculator {
    func calculateConfidenceScores(for fields: [String: FieldExtractionResult], from observations: [NormalizedTextObservation]) -> [String: FieldExtractionResult] {
        // For now, return the same confidence scores
        // Future implementation will use multi-factor scoring
        return fields
    }
    
    func calculateConfidenceScores(for fields: [String: FieldExtractionResult], from observations: [NormalizedTextObservation], using weights: [String: Float]) -> [String: FieldExtractionResult] {
        // Enhanced confidence calculation using state-specific weights
        var enhancedFields = fields
        
        for (fieldName, field) in fields {
            if let weight = weights[fieldName] {
                // Apply weight-based confidence adjustment
                let adjustedConfidence = min(field.confidence * (1.0 + weight), 1.0)
                enhancedFields[fieldName] = FieldExtractionResult(
                    value: field.value,
                    confidence: adjustedConfidence,
                    extractionMethod: field.extractionMethod,
                    boundingBox: field.boundingBox
                )
            }
        }
        
        return enhancedFields
    }
}

/**
 * Field validation component
 */
class FieldValidator {
    func validateAndCleanFields(_ fields: [String: FieldExtractionResult]) -> [String: ValidatedField] {
        var validatedFields: [String: ValidatedField] = [:]
        
        for (fieldName, field) in fields {
            let cleanedValue = cleanFieldValue(field.value, for: fieldName)
            let isValid = validateField(cleanedValue, for: fieldName)
            
            validatedFields[fieldName] = ValidatedField(
                value: cleanedValue,
                confidence: field.confidence,
                isValid: isValid
            )
        }
        
        return validatedFields
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