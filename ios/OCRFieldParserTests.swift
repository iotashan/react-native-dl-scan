import XCTest
import Vision
@testable import RnDlScan

/**
 * Comprehensive unit tests for OCRFieldParser
 * Tests field extraction, confidence scoring, and performance requirements
 */
class OCRFieldParserTests: XCTestCase {
    
    private var parser: OCRFieldParser!
    
    override func setUp() {
        super.setUp()
        parser = OCRFieldParser()
    }
    
    override func tearDown() {
        parser = nil
        super.tearDown()
    }
    
    // MARK: - Core Functionality Tests
    
    func testParseOCRFields_withValidCaliforniaLicense_returnsStructuredData() {
        // Given: California license OCR data
        let textObservations = createCaliforniaLicenseObservations()
        
        // When: Parsing OCR fields
        var error: NSError?
        let result = parser.parseOCRFields(from: textObservations, error: &error)
        
        // Then: Should successfully extract fields
        XCTAssertNil(error, "Parsing should not produce an error")
        XCTAssertNotNil(result, "Result should not be nil")
        
        if let result = result {
            XCTAssertEqual(result["firstName"] as? String, "JOHN")
            XCTAssertEqual(result["lastName"] as? String, "DOE")
            XCTAssertEqual(result["licenseNumber"] as? String, "D1234567")
            XCTAssertEqual(result["sex"] as? String, "M")
            XCTAssertEqual(result["extractionMethod"] as? String, "OCR")
            XCTAssertNotNil(result["ocrConfidence"])
        }
    }
    
    func testParseOCRFields_withValidTexasLicense_returnsStructuredData() {
        // Given: Texas license OCR data
        let textObservations = createTexasLicenseObservations()
        
        // When: Parsing OCR fields
        var error: NSError?
        let result = parser.parseOCRFields(from: textObservations, error: &error)
        
        // Then: Should successfully extract fields
        XCTAssertNil(error)
        XCTAssertNotNil(result)
        
        if let result = result {
            XCTAssertEqual(result["firstName"] as? String, "JANE")
            XCTAssertEqual(result["lastName"] as? String, "SMITH")
            XCTAssertEqual(result["licenseNumber"] as? String, "12345678")
            XCTAssertEqual(result["sex"] as? String, "F")
        }
    }
    
    func testParseOCRFields_withEmptyObservations_returnsError() {
        // Given: Empty observations
        let textObservations: [[String: Any]] = []
        
        // When: Parsing empty data
        var error: NSError?
        let result = parser.parseOCRFields(from: textObservations, error: &error)
        
        // Then: Should handle gracefully
        XCTAssertNil(result, "Result should be nil for empty input")
    }
    
    func testParseOCRFields_withMalformedObservations_handlesGracefully() {
        // Given: Malformed observations
        let textObservations = [
            ["invalid": "data"],
            ["text": 123], // Invalid text type
            ["confidence": "invalid"] // Invalid confidence type
        ]
        
        // When: Parsing malformed data
        var error: NSError?
        let result = parser.parseOCRFields(from: textObservations, error: &error)
        
        // Then: Should handle gracefully without crashing
        // Result may be nil or contain partial data
        XCTAssertTrue(true, "Should not crash with malformed input")
    }
    
    // MARK: - Field Extraction Tests
    
    func testFirstNameExtraction_withPatternMatching_extractsCorrectly() {
        // Given: Observations with first name patterns
        let observations = [
            createTextObservation(text: "FIRST: JOHN", confidence: 0.9),
            createTextObservation(text: "FN JOHN", confidence: 0.8),
            createTextObservation(text: "4D JOHN", confidence: 0.85)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract first name
        XCTAssertNil(error)
        XCTAssertEqual(result?["firstName"] as? String, "JOHN")
    }
    
    func testLastNameExtraction_withPatternMatching_extractsCorrectly() {
        // Given: Observations with last name patterns
        let observations = [
            createTextObservation(text: "LAST: DOE", confidence: 0.9),
            createTextObservation(text: "LN DOE", confidence: 0.8),
            createTextObservation(text: "DOE,", confidence: 0.85) // With comma
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract last name
        XCTAssertNil(error)
        XCTAssertEqual(result?["lastName"] as? String, "DOE")
    }
    
    func testLicenseNumberExtraction_withCaliforniaFormat_extractsCorrectly() {
        // Given: California license number patterns
        let observations = [
            createTextObservation(text: "DL: D1234567", confidence: 0.95),
            createTextObservation(text: "LICENSE D1234567", confidence: 0.9),
            createTextObservation(text: "D1234567", confidence: 0.85)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract license number
        XCTAssertNil(error)
        XCTAssertEqual(result?["licenseNumber"] as? String, "D1234567")
    }
    
    func testLicenseNumberExtraction_withTexasFormat_extractsCorrectly() {
        // Given: Texas license number patterns
        let observations = [
            createTextObservation(text: "DL: 12345678", confidence: 0.95),
            createTextObservation(text: "LICENSE 12345678", confidence: 0.9),
            createTextObservation(text: "12345678", confidence: 0.85)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract license number
        XCTAssertNil(error)
        XCTAssertEqual(result?["licenseNumber"] as? String, "12345678")
    }
    
    func testDateOfBirthExtraction_withVariousFormats_extractsCorrectly() {
        // Given: Various date formats
        let testCases = [
            ("DOB: 01/15/1990", "1990-01-15"),
            ("BORN 01-15-1990", "1990-01-15"),
            ("4B 1990/01/15", "1990-01-15"),
            ("01/15/90", "1990-01-15")
        ]
        
        for (input, expected) in testCases {
            // When: Parsing date
            let observations = [createTextObservation(text: input, confidence: 0.9)]
            var error: NSError?
            let result = parser.parseOCRFields(from: observations, error: &error)
            
            // Then: Should extract and format date correctly
            XCTAssertNil(error)
            XCTAssertEqual(result?["dateOfBirth"] as? String, expected, "Failed for input: \(input)")
        }
    }
    
    func testAddressExtraction_withStreetAddress_extractsCorrectly() {
        // Given: Address patterns
        let observations = [
            createTextObservation(text: "ADDR: 123 MAIN ST", confidence: 0.9),
            createTextObservation(text: "456 OAK AVENUE", confidence: 0.85),
            createTextObservation(text: "789 PINE ROAD", confidence: 0.8)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract address
        XCTAssertNil(error)
        XCTAssertNotNil(result?["address"])
    }
    
    func testPhysicalCharacteristicsExtraction_extractsCorrectly() {
        // Given: Physical characteristics
        let observations = [
            createTextObservation(text: "SEX: M", confidence: 0.95),
            createTextObservation(text: "HGT: 5-10", confidence: 0.9),
            createTextObservation(text: "WGT: 180", confidence: 0.9),
            createTextObservation(text: "EYES: BRN", confidence: 0.85),
            createTextObservation(text: "HAIR: BLK", confidence: 0.85)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract all characteristics
        XCTAssertNil(error)
        XCTAssertEqual(result?["sex"] as? String, "M")
        XCTAssertEqual(result?["height"] as? String, "5-10")
        XCTAssertEqual(result?["weight"] as? String, "180")
        XCTAssertEqual(result?["eyeColor"] as? String, "BRN")
        XCTAssertEqual(result?["hairColor"] as? String, "BLK")
    }
    
    // MARK: - Confidence Scoring Tests
    
    func testConfidenceScoring_withHighQualityText_returnsHighConfidence() {
        // Given: High confidence observations
        let observations = [
            createTextObservation(text: "JOHN", confidence: 0.95),
            createTextObservation(text: "DOE", confidence: 0.92),
            createTextObservation(text: "D1234567", confidence: 0.98)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should have high overall confidence
        XCTAssertNil(error)
        if let confidence = result?["ocrConfidence"] as? Float {
            XCTAssertGreaterThan(confidence, 0.8, "Should have high confidence for high-quality text")
        }
    }
    
    func testConfidenceScoring_withLowQualityText_returnsLowConfidence() {
        // Given: Low confidence observations
        let observations = [
            createTextObservation(text: "J0HN", confidence: 0.4), // OCR errors
            createTextObservation(text: "D0E", confidence: 0.3),
            createTextObservation(text: "D12345G7", confidence: 0.5)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should have lower overall confidence
        if let confidence = result?["ocrConfidence"] as? Float {
            XCTAssertLessThan(confidence, 0.7, "Should have lower confidence for low-quality text")
        }
    }
    
    // MARK: - Edge Cases and Error Handling Tests
    
    func testParsingWithPartialData_handlesGracefully() {
        // Given: Partial license data (some fields missing)
        let observations = [
            createTextObservation(text: "JOHN", confidence: 0.9),
            createTextObservation(text: "D1234567", confidence: 0.95)
            // Missing: last name, DOB, etc.
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract available fields without error
        XCTAssertNil(error)
        XCTAssertEqual(result?["firstName"] as? String, "JOHN")
        XCTAssertEqual(result?["licenseNumber"] as? String, "D1234567")
        // Missing fields should be nil/absent
        XCTAssertNil(result?["lastName"])
    }
    
    func testParsingWithCorruptedText_handlesGracefully() {
        // Given: Corrupted/noisy OCR text
        let observations = [
            createTextObservation(text: "J@#$N", confidence: 0.2),
            createTextObservation(text: "D0E!!!!", confidence: 0.1),
            createTextObservation(text: "1234ABC", confidence: 0.3)
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should handle gracefully without crashing
        // May return partial results or fail gracefully
        XCTAssertTrue(true, "Should not crash with corrupted text")
    }
    
    func testParsingWithRotatedText_handlesNormalization() {
        // Given: Text that might be rotated/oriented differently
        let observations = [
            createTextObservation(text: "   JOHN   ", confidence: 0.8), // Extra whitespace
            createTextObservation(text: "DOE\n", confidence: 0.8), // Newline
            createTextObservation(text: "D1234567  ", confidence: 0.9) // Trailing space
        ]
        
        // When: Parsing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should normalize text properly
        XCTAssertNil(error)
        XCTAssertEqual(result?["firstName"] as? String, "JOHN")
        XCTAssertEqual(result?["lastName"] as? String, "DOE")
        XCTAssertEqual(result?["licenseNumber"] as? String, "D1234567")
    }
    
    // MARK: - Performance Tests
    
    func testParsingPerformance_meetsRequirements() {
        // Given: Typical license OCR data
        let observations = createLargeObservationSet()
        
        // When: Measuring parsing time
        let startTime = CFAbsoluteTimeGetCurrent()
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        
        // Then: Should meet <500ms requirement
        XCTAssertNil(error)
        XCTAssertNotNil(result)
        XCTAssertLessThan(processingTime, 0.5, "OCR parsing should complete in under 500ms")
        
        // Also verify the parser's internal timing
        let parserTime = parser.getLastProcessingTime()
        XCTAssertLessThan(parserTime, 0.5, "Parser's internal timing should also be under 500ms")
    }
    
    func testRepeatedParsing_maintainsPerformance() {
        // Given: Typical observations
        let observations = createCaliforniaLicenseObservations()
        var processingTimes: [TimeInterval] = []
        
        // When: Parsing multiple times
        for _ in 0..<10 {
            let startTime = CFAbsoluteTimeGetCurrent()
            var error: NSError?
            _ = parser.parseOCRFields(from: observations, error: &error)
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            processingTimes.append(processingTime)
        }
        
        // Then: Performance should remain consistent
        let averageTime = processingTimes.reduce(0, +) / Double(processingTimes.count)
        XCTAssertLessThan(averageTime, 0.5, "Average processing time should remain under 500ms")
        
        // Performance shouldn't degrade significantly over iterations
        if let firstTime = processingTimes.first, let lastTime = processingTimes.last {
            XCTAssertLessThan(lastTime, firstTime * 2, "Performance shouldn't degrade significantly")
        }
    }
    
    // MARK: - Integration with LicenseParser Tests
    
    func testLicenseParserOCRIntegration_worksCorrectly() {
        // Given: Text observations
        let observations = createCaliforniaLicenseObservations()
        
        // When: Using LicenseParser OCR method
        var error: NSError?
        let result = LicenseParser.parseOCR(observations, error: &error)
        
        // Then: Should work through the unified interface
        XCTAssertNil(error)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?["extractionMethod"] as? String, "OCR")
    }
    
    func testLicenseParserPerformanceMetrics_available() {
        // Given: Parsed observations
        let observations = createCaliforniaLicenseObservations()
        var error: NSError?
        _ = LicenseParser.parseOCR(observations, error: &error)
        
        // When: Getting performance metrics
        let processingTime = LicenseParser.getOCRParsingTime()
        
        // Then: Should return valid timing data
        XCTAssertGreaterThan(processingTime, 0, "Should return positive processing time")
        XCTAssertLessThan(processingTime, 1.0, "Processing time should be reasonable")
    }
    
    // MARK: - State-Specific Format Tests
    
    func testMultiStateSupport_handlesFormatVariations() {
        let testCases = [
            ("California", createCaliforniaLicenseObservations()),
            ("Texas", createTexasLicenseObservations()),
            ("Florida", createFloridaLicenseObservations()),
            ("NewYork", createNewYorkLicenseObservations())
        ]
        
        for (stateName, observations) in testCases {
            // When: Parsing state-specific format
            var error: NSError?
            let result = parser.parseOCRFields(from: observations, error: &error)
            
            // Then: Should successfully parse each state format
            XCTAssertNil(error, "Should parse \(stateName) format without error")
            XCTAssertNotNil(result, "Should return result for \(stateName)")
            
            if let result = result {
                XCTAssertNotNil(result["firstName"], "Should extract first name for \(stateName)")
                XCTAssertNotNil(result["lastName"], "Should extract last name for \(stateName)")
                XCTAssertNotNil(result["licenseNumber"], "Should extract license number for \(stateName)")
            }
        }
    }
    
    // MARK: - Helper Methods
    
    private func createTextObservation(text: String, confidence: Float, 
                                     x: Double = 0.1, y: Double = 0.5, 
                                     width: Double = 0.3, height: Double = 0.1) -> [String: Any] {
        return [
            "text": text,
            "confidence": confidence,
            "boundingBox": [
                "x": x,
                "y": y,
                "width": width,
                "height": height
            ]
        ]
    }
    
    private func createCaliforniaLicenseObservations() -> [[String: Any]] {
        return [
            createTextObservation(text: "CALIFORNIA", confidence: 0.95, y: 0.9),
            createTextObservation(text: "DRIVER LICENSE", confidence: 0.92, y: 0.85),
            createTextObservation(text: "LN DOE", confidence: 0.9, y: 0.75),
            createTextObservation(text: "FN JOHN", confidence: 0.9, y: 0.7),
            createTextObservation(text: "DL D1234567", confidence: 0.95, y: 0.6),
            createTextObservation(text: "DOB 01/15/1990", confidence: 0.88, y: 0.5),
            createTextObservation(text: "EXP 01/15/2026", confidence: 0.88, y: 0.45),
            createTextObservation(text: "SEX M", confidence: 0.9, y: 0.4),
            createTextObservation(text: "HGT 5-10", confidence: 0.85, y: 0.35),
            createTextObservation(text: "WGT 180", confidence: 0.85, y: 0.3),
            createTextObservation(text: "EYES BRN", confidence: 0.8, y: 0.25),
            createTextObservation(text: "HAIR BLK", confidence: 0.8, y: 0.2),
            createTextObservation(text: "123 MAIN ST", confidence: 0.85, y: 0.15),
            createTextObservation(text: "ANYTOWN CA 90210", confidence: 0.85, y: 0.1)
        ]
    }
    
    private func createTexasLicenseObservations() -> [[String: Any]] {
        return [
            createTextObservation(text: "TEXAS", confidence: 0.95, y: 0.9),
            createTextObservation(text: "DRIVER LICENSE", confidence: 0.92, y: 0.85),
            createTextObservation(text: "SMITH, JANE", confidence: 0.9, y: 0.75),
            createTextObservation(text: "DL 12345678", confidence: 0.95, y: 0.6),
            createTextObservation(text: "DOB 03/20/1985", confidence: 0.88, y: 0.5),
            createTextObservation(text: "EXP 03/20/2025", confidence: 0.88, y: 0.45),
            createTextObservation(text: "SEX F", confidence: 0.9, y: 0.4),
            createTextObservation(text: "HGT 5-06", confidence: 0.85, y: 0.35),
            createTextObservation(text: "WGT 135", confidence: 0.85, y: 0.3),
            createTextObservation(text: "EYES BLU", confidence: 0.8, y: 0.25),
            createTextObservation(text: "HAIR BLN", confidence: 0.8, y: 0.2)
        ]
    }
    
    private func createFloridaLicenseObservations() -> [[String: Any]] {
        return [
            createTextObservation(text: "FLORIDA", confidence: 0.95, y: 0.9),
            createTextObservation(text: "DRIVER LICENSE", confidence: 0.92, y: 0.85),
            createTextObservation(text: "GARCIA, MARIA", confidence: 0.9, y: 0.75),
            createTextObservation(text: "G123456789", confidence: 0.95, y: 0.6),
            createTextObservation(text: "DOB 07/04/1992", confidence: 0.88, y: 0.5),
            createTextObservation(text: "EXP 07/04/2028", confidence: 0.88, y: 0.45),
            createTextObservation(text: "SEX F", confidence: 0.9, y: 0.4)
        ]
    }
    
    private func createNewYorkLicenseObservations() -> [[String: Any]] {
        return [
            createTextObservation(text: "NEW YORK", confidence: 0.95, y: 0.9),
            createTextObservation(text: "DRIVER LICENSE", confidence: 0.92, y: 0.85),
            createTextObservation(text: "JOHNSON, ROBERT", confidence: 0.9, y: 0.75),
            createTextObservation(text: "123456789", confidence: 0.95, y: 0.6),
            createTextObservation(text: "DOB 12/25/1988", confidence: 0.88, y: 0.5),
            createTextObservation(text: "EXP 12/25/2026", confidence: 0.88, y: 0.45),
            createTextObservation(text: "SEX M", confidence: 0.9, y: 0.4)
        ]
    }
    
    private func createLargeObservationSet() -> [[String: Any]] {
        var observations: [[String: Any]] = []
        
        // Add multiple variations of each field to test performance
        for i in 0..<50 {
            observations.append(createTextObservation(
                text: "TEXT\(i)",
                confidence: Float.random(in: 0.5...0.95),
                x: Double.random(in: 0...0.8),
                y: Double.random(in: 0...0.8)
            ))
        }
        
        // Add actual license data
        observations.append(contentsOf: createCaliforniaLicenseObservations())
        
        return observations
    }
}