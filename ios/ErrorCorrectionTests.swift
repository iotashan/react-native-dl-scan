import XCTest
import Vision
@testable import RnDlScan

/**
 * Comprehensive test suite for OCR Error Correction System
 * Tests character substitution, context-aware correction, and state-specific patterns
 */
class ErrorCorrectionTests: XCTestCase {
    
    private var errorCorrector: ErrorCorrector!
    
    override func setUp() {
        super.setUp()
        errorCorrector = ErrorCorrector()
    }
    
    override func tearDown() {
        errorCorrector = nil
        super.tearDown()
    }
    
    // MARK: - Character Substitution Tests
    
    func testCharacterSubstitution_commonOCRErrors_correctsAccurately() {
        // Given: Common OCR character confusion patterns
        let testCases: [(fieldName: String, input: String, expected: String)] = [
            // Name fields - prefer letters
            ("firstName", "J0HN", "JOHN"),      // 0 → O
            ("firstName", "MAR1A", "MARIA"),    // 1 → I
            ("lastName", "SM1TH", "SMITH"),     // 1 → I
            ("lastName", "D0E", "DOE"),         // 0 → O
            ("firstName", "5ARAH", "SARAH"),    // 5 → S
            ("firstName", "8O8", "BOB"),        // 8 → B
            ("lastName", "6ARCIA", "GARCIA"),   // 6 → G
            ("lastName", "L33", "LEE"),         // 3 → E
            
            // License numbers - prefer numbers
            ("licenseNumber", "D123456O", "D1234560"),  // O → 0
            ("licenseNumber", "DI234567", "D1234567"),  // I → 1
            ("licenseNumber", "D12345G7", "D1234567"),  // G → 6
            ("licenseNumber", "DI2345B7", "D1234587"),  // I → 1, B → 8
            
            // Dates - prefer numbers
            ("dateOfBirth", "O1/15/199O", "01/15/1990"),    // O → 0
            ("dateOfBirth", "0I/I5/1990", "01/15/1990"),    // I → 1
            ("expirationDate", "12/25/202G", "12/25/2026"), // G → 6
            
            // Sex field
            ("sex", "N", "M"),  // N → M (common misread)
            ("sex", "E", "F"),  // E → F (common misread)
            
            // Height
            ("height", "S-10", "5-10"),  // S → 5
            ("height", "5-I0", "5-10"),  // I → 1
            
            // Weight  
            ("weight", "I80", "180"),    // I → 1
            ("weight", "I8O", "180"),    // I → 1, O → 0
            
            // Color codes
            ("eyeColor", "8RN", "BRN"),  // 8 → B
            ("eyeColor", "8LU", "BLU"),  // 8 → B
            ("hairColor", "8LK", "BLK"), // 8 → B
            ("eyeColor", "6RN", "GRN"),  // 6 → G
            
            // License class
            ("licenseClass", "C0L", "CDL"),  // 0 → D
            ("licenseClass", "C8", "CB"),    // 8 → B
        ]
        
        for (fieldName, input, expected) in testCases {
            // When: Applying error correction
            let fields = [
                fieldName: FieldExtractionResult(
                    value: input,
                    confidence: 0.7,
                    extractionMethod: .patternMatching,
                    boundingBox: CGRect.zero
                )
            ]
            
            let correctedFields = errorCorrector.correctFields(
                fields,
                detectedState: nil,
                from: []
            )
            
            // Then: Should correct to expected value
            XCTAssertEqual(correctedFields[fieldName]?.value, expected,
                "Field '\(fieldName)' should correct '\(input)' to '\(expected)'")
        }
    }
    
    // MARK: - Context-Aware Correction Tests
    
    func testContextAwareCorrection_usesFieldTypeForCorrection() {
        // Given: Same OCR error in different field types
        let ambiguousChar = "D0E"  // Could be DOE or D0E
        
        // Test 1: As a name field
        let nameFields = [
            "lastName": FieldExtractionResult(
                value: ambiguousChar,
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        let correctedNames = errorCorrector.correctFields(
            nameFields,
            detectedState: nil,
            from: []
        )
        
        // Should prefer letters for names
        XCTAssertEqual(correctedNames["lastName"]?.value, "DOE")
        
        // Test 2: As a license number component
        let licenseFields = [
            "licenseNumber": FieldExtractionResult(
                value: ambiguousChar,
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        let correctedLicense = errorCorrector.correctFields(
            licenseFields,
            detectedState: nil,
            from: []
        )
        
        // Should prefer numbers for license numbers
        XCTAssertEqual(correctedLicense["licenseNumber"]?.value, "D0E")
    }
    
    // MARK: - State-Specific Correction Tests
    
    func testStateSpecificCorrection_california_appliesCorrectPattern() {
        // Given: California license with OCR errors
        let fields = [
            "licenseNumber": FieldExtractionResult(
                value: "DI23456O",  // Should be D1234560
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying California-specific corrections
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: "CA",
            from: []
        )
        
        // Then: Should correct to California format (Letter + 7 digits)
        XCTAssertEqual(correctedFields["licenseNumber"]?.value, "D1234560")
    }
    
    func testStateSpecificCorrection_texas_appliesCorrectPattern() {
        // Given: Texas license with OCR errors
        let fields = [
            "licenseNumber": FieldExtractionResult(
                value: "I234567B",  // Should be 12345678
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying Texas-specific corrections
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: "TX",
            from: []
        )
        
        // Then: Should correct to Texas format (8 digits)
        XCTAssertEqual(correctedFields["licenseNumber"]?.value, "12345678")
    }
    
    func testStateSpecificCorrection_florida_appliesCorrectPattern() {
        // Given: Florida license with OCR errors
        let fields = [
            "licenseNumber": FieldExtractionResult(
                value: "GI23456789OI2",  // Should be G123456789012
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying Florida-specific corrections
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: "FL",
            from: []
        )
        
        // Then: Should correct to Florida format (Letter + 12 digits)
        XCTAssertEqual(correctedFields["licenseNumber"]?.value, "G123456789012")
    }
    
    // MARK: - Date Correction Tests
    
    func testDateCorrection_fixesCommonOCRErrors() {
        // Given: Dates with various OCR errors
        let testCases: [(input: String, expected: String)] = [
            ("O1/15/199O", "01/15/1990"),      // O → 0
            ("0I/I5/1990", "01/15/1990"),      // I → 1
            ("12\\25\\2025", "12/25/2025"),    // \ → /
            ("03|20|1985", "03/20/1985"),      // | → /
            ("07.04.1992", "07/04/1992"),      // . → /
            ("I2/25/202G", "12/25/2026")       // I → 1, G → 6
        ]
        
        for (input, expected) in testCases {
            let fields = [
                "dateOfBirth": FieldExtractionResult(
                    value: input,
                    confidence: 0.7,
                    extractionMethod: .patternMatching,
                    boundingBox: CGRect.zero
                )
            ]
            
            let correctedFields = errorCorrector.correctFields(
                fields,
                detectedState: nil,
                from: []
            )
            
            XCTAssertEqual(correctedFields["dateOfBirth"]?.value, expected,
                "Date '\(input)' should be corrected to '\(expected)'")
        }
    }
    
    // MARK: - Address Correction Tests
    
    func testAddressCorrection_fixesStreetAbbreviations() {
        // Given: Addresses with OCR errors in street abbreviations
        let testCases: [(input: String, expected: String)] = [
            ("123 MAIN 5T", "123 MAIN ST"),          // 5T → ST
            ("456 OAK 5TREET", "456 OAK STREET"),    // 5TREET → STREET
            ("789 ELM AVE", "789 ELM AVE"),          // Already correct
            ("I23 PINE RD", "123 PINE RD"),          // I → 1
            ("45G MAPLE DR", "456 MAPLE DR")         // G → 6
        ]
        
        for (input, expected) in testCases {
            let fields = [
                "address": FieldExtractionResult(
                    value: input,
                    confidence: 0.7,
                    extractionMethod: .patternMatching,
                    boundingBox: CGRect.zero
                )
            ]
            
            let correctedFields = errorCorrector.correctFields(
                fields,
                detectedState: nil,
                from: []
            )
            
            XCTAssertEqual(correctedFields["address"]?.value, expected,
                "Address '\(input)' should be corrected to '\(expected)'")
        }
    }
    
    // MARK: - Confidence Adjustment Tests
    
    func testConfidenceAdjustment_minorCorrections_increasesConfidence() {
        // Given: Field with minor OCR error
        let fields = [
            "firstName": FieldExtractionResult(
                value: "J0HN",  // Single character error
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying correction
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: nil,
            from: []
        )
        
        // Then: Confidence should increase slightly for minor correction
        if let correctedField = correctedFields["firstName"] {
            XCTAssertGreaterThan(correctedField.confidence, 0.7,
                "Confidence should increase for successful minor correction")
            XCTAssertLessThanOrEqual(correctedField.confidence, 0.85,
                "Confidence increase should be reasonable")
        }
    }
    
    func testConfidenceAdjustment_majorCorrections_maintainsOrDecreasesConfidence() {
        // Given: Field with major OCR errors
        let fields = [
            "firstName": FieldExtractionResult(
                value: "J0H|\|",  // Multiple significant errors
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying correction
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: nil,
            from: []
        )
        
        // Then: Confidence should not increase for major corrections
        if let correctedField = correctedFields["firstName"] {
            XCTAssertLessThanOrEqual(correctedField.confidence, 0.7,
                "Confidence should not increase for major corrections")
        }
    }
    
    // MARK: - Cross-Field Validation Tests
    
    func testCrossFieldValidation_usesRelatedFieldsForCorrection() {
        // Given: Multiple related fields with OCR errors
        let observations = [
            NormalizedTextObservation(
                text: "CALIFORNIA",
                confidence: 0.95,
                boundingBox: CGRect(x: 0.1, y: 0.9, width: 0.3, height: 0.05)
            ),
            NormalizedTextObservation(
                text: "DL",
                confidence: 0.9,
                boundingBox: CGRect(x: 0.1, y: 0.5, width: 0.1, height: 0.05)
            )
        ]
        
        let fields = [
            "licenseNumber": FieldExtractionResult(
                value: "DI23456O",  // OCR errors
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.2, y: 0.5, width: 0.2, height: 0.05)
            )
        ]
        
        // When: Applying correction with context
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: "CA",
            from: observations
        )
        
        // Then: Should use state context for better correction
        XCTAssertEqual(correctedFields["licenseNumber"]?.value, "D1234560",
            "Should correct based on California license format")
    }
    
    // MARK: - Performance Tests
    
    func testErrorCorrection_performanceWith100Fields() {
        // Given: Large number of fields with errors
        var fields: [String: FieldExtractionResult] = [:]
        for i in 0..<100 {
            let fieldName = i % 2 == 0 ? "firstName" : "licenseNumber"
            fields["field\(i)"] = FieldExtractionResult(
                value: "TEST\(i)0I5",  // Contains OCR errors
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        }
        
        // When: Measuring performance
        let startTime = CFAbsoluteTimeGetCurrent()
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: "CA",
            from: []
        )
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        
        // Then: Should complete within performance requirements
        XCTAssertLessThan(processingTime, 0.05, "Error correction should complete in <50ms")
        XCTAssertEqual(correctedFields.count, fields.count, "All fields should be processed")
    }
    
    // MARK: - Edge Case Tests
    
    func testErrorCorrection_withEmptyFields_returnsEmpty() {
        // Given: Empty fields
        let fields: [String: FieldExtractionResult] = [:]
        
        // When: Applying correction
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: nil,
            from: []
        )
        
        // Then: Should return empty
        XCTAssertTrue(correctedFields.isEmpty)
    }
    
    func testErrorCorrection_withAlreadyCorrectText_maintainsOriginal() {
        // Given: Fields with correct text
        let fields = [
            "firstName": FieldExtractionResult(
                value: "JOHN",
                confidence: 0.9,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            ),
            "licenseNumber": FieldExtractionResult(
                value: "D1234567",
                confidence: 0.95,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying correction
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: "CA",
            from: []
        )
        
        // Then: Should maintain original values and confidence
        XCTAssertEqual(correctedFields["firstName"]?.value, "JOHN")
        XCTAssertEqual(correctedFields["firstName"]?.confidence, 0.9)
        XCTAssertEqual(correctedFields["licenseNumber"]?.value, "D1234567")
        XCTAssertEqual(correctedFields["licenseNumber"]?.confidence, 0.95)
    }
    
    func testErrorCorrection_withUnknownFieldType_appliesGeneralCorrections() {
        // Given: Unknown field type
        let fields = [
            "customField": FieldExtractionResult(
                value: "TEST0I5",
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying correction
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: nil,
            from: []
        )
        
        // Then: Should apply general corrections
        XCTAssertNotNil(correctedFields["customField"])
        // Exact correction depends on general rules
    }
}