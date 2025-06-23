import XCTest
import Vision
@testable import RnDlScan

/**
 * Comprehensive test suite for Confidence Scoring System
 * Tests multi-factor confidence calculation, thresholds, and accuracy
 */
class ConfidenceScoringTests: XCTestCase {
    
    private var confidenceCalculator: ConfidenceCalculator!
    private var confidenceThresholds: ConfidenceThresholds!
    
    override func setUp() {
        super.setUp()
        confidenceCalculator = ConfidenceCalculator()
        confidenceThresholds = ConfidenceThresholds()
    }
    
    override func tearDown() {
        confidenceCalculator = nil
        confidenceThresholds = nil
        super.tearDown()
    }
    
    // MARK: - Multi-Factor Confidence Calculation Tests
    
    func testConfidenceCalculation_withHighQualityAllFactors_returnsHighScore() {
        // Given: High quality field extraction with all positive factors
        let fields = [
            "licenseNumber": FieldExtractionResult(
                value: "D1234567",
                confidence: 0.95,  // High OCR quality
                extractionMethod: .patternMatching,  // Strong pattern match
                boundingBox: CGRect(x: 0.1, y: 0.5, width: 0.3, height: 0.1)
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "DL D1234567",
                confidence: 0.95,
                boundingBox: CGRect(x: 0.05, y: 0.5, width: 0.35, height: 0.1)
            ),
            NormalizedTextObservation(
                text: "LICENSE",
                confidence: 0.92,
                boundingBox: CGRect(x: 0.05, y: 0.48, width: 0.2, height: 0.08)
            )
        ]
        
        // When: Calculating confidence scores
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        // Then: Should return high confidence score
        if let licenseField = enhancedFields["licenseNumber"] {
            XCTAssertGreaterThan(licenseField.confidence, 0.8)
            XCTAssertLessThanOrEqual(licenseField.confidence, 1.0)
        } else {
            XCTFail("License number field should be present")
        }
    }
    
    func testConfidenceCalculation_withLowOCRQuality_returnsLowerScore() {
        // Given: Low OCR quality extraction
        let fields = [
            "firstName": FieldExtractionResult(
                value: "J0HN",  // OCR errors present
                confidence: 0.4,  // Low OCR quality
                extractionMethod: .positionalAnalysis,
                boundingBox: CGRect(x: 0.1, y: 0.7, width: 0.2, height: 0.1)
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "J0HN",
                confidence: 0.4,
                boundingBox: CGRect(x: 0.1, y: 0.7, width: 0.2, height: 0.1)
            )
        ]
        
        // When: Calculating confidence scores
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        // Then: Should return lower confidence score
        if let nameField = enhancedFields["firstName"] {
            XCTAssertLessThan(nameField.confidence, 0.6)
            XCTAssertGreaterThanOrEqual(nameField.confidence, 0.0)
        }
    }
    
    func testConfidenceCalculation_withStateSpecificWeights_appliesCorrectly() {
        // Given: Fields with state-specific weights
        let fields = [
            "licenseNumber": FieldExtractionResult(
                value: "D1234567",
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.1, y: 0.5, width: 0.3, height: 0.1)
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "DL D1234567",
                confidence: 0.8,
                boundingBox: CGRect(x: 0.1, y: 0.5, width: 0.3, height: 0.1)
            )
        ]
        
        // California-specific weights (higher for license number)
        let stateWeights = ["licenseNumber": Float(0.2)]
        
        // When: Calculating with state weights
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations,
            using: stateWeights
        )
        
        // Then: Should apply state-specific weight boost
        if let licenseField = enhancedFields["licenseNumber"] {
            // Should be higher than the base confidence due to state weight
            XCTAssertGreaterThan(licenseField.confidence, 0.8)
        }
    }
    
    func testConfidenceCalculation_withMixedExtractionMethods_scoresAppropriately() {
        // Given: Fields extracted using different methods
        let testCases: [(ExtractionMethod, String, Float)] = [
            (.patternMatching, "licenseNumber", 0.7),    // High confidence for pattern
            (.positionalAnalysis, "firstName", 0.6),      // Medium for positional
            (.contextualAnalysis, "address", 0.65),       // Medium-high for contextual
            (.hybridApproach, "dateOfBirth", 0.75)        // High for hybrid
        ]
        
        for (method, fieldName, minExpected) in testCases {
            let fields = [
                fieldName: FieldExtractionResult(
                    value: "TEST_VALUE",
                    confidence: 0.8,
                    extractionMethod: method,
                    boundingBox: CGRect(x: 0.1, y: 0.5, width: 0.3, height: 0.1)
                )
            ]
            
            let observations = [
                NormalizedTextObservation(
                    text: "TEST_VALUE",
                    confidence: 0.8,
                    boundingBox: CGRect(x: 0.1, y: 0.5, width: 0.3, height: 0.1)
                )
            ]
            
            // When: Calculating confidence
            let enhancedFields = confidenceCalculator.calculateConfidenceScores(
                for: fields,
                from: observations
            )
            
            // Then: Should score based on extraction method
            if let field = enhancedFields[fieldName] {
                XCTAssertGreaterThan(field.confidence, minExpected,
                    "Field '\(fieldName)' with method '\(method)' should have confidence > \(minExpected)")
            }
        }
    }
    
    // MARK: - Field-Specific Confidence Tests
    
    func testFieldSpecificConfidence_forCriticalFields_requiresHigherScores() {
        // Given: Critical identification fields
        let criticalFields = ["firstName", "lastName", "licenseNumber", "dateOfBirth"]
        let lessCriticalFields = ["hairColor", "eyeColor", "restrictions", "endorsements"]
        
        // Test threshold requirements
        for fieldName in criticalFields {
            let threshold = confidenceThresholds.getThreshold(for: fieldName)
            XCTAssertGreaterThanOrEqual(threshold, 0.7,
                "Critical field '\(fieldName)' should have threshold >= 0.7")
        }
        
        for fieldName in lessCriticalFields {
            let threshold = confidenceThresholds.getThreshold(for: fieldName)
            XCTAssertLessThanOrEqual(threshold, 0.6,
                "Less critical field '\(fieldName)' should have threshold <= 0.6")
        }
    }
    
    func testConfidenceThresholds_meetsThresholdCheck_worksCorrectly() {
        // Given: Various confidence levels
        let testCases: [(String, Float, Bool)] = [
            ("licenseNumber", 0.85, true),   // Above threshold (0.8)
            ("licenseNumber", 0.75, false),  // Below threshold
            ("firstName", 0.72, true),       // Above threshold (0.7)
            ("firstName", 0.65, false),      // Below threshold
            ("hairColor", 0.52, true),       // Above threshold (0.5)
            ("hairColor", 0.45, false)       // Below threshold
        ]
        
        for (fieldName, confidence, expectedResult) in testCases {
            let meetsThreshold = confidenceThresholds.meetsThreshold(
                confidence,
                for: fieldName
            )
            XCTAssertEqual(meetsThreshold, expectedResult,
                "Field '\(fieldName)' with confidence \(confidence) should \(expectedResult ? "meet" : "not meet") threshold")
        }
    }
    
    func testConfidenceMargin_calculatesCorrectly() {
        // Given: Field with known threshold
        let fieldName = "licenseNumber"  // Threshold: 0.8
        let testConfidences: [Float] = [0.9, 0.8, 0.7, 0.5]
        let expectedMargins: [Float] = [0.1, 0.0, -0.1, -0.3]
        
        for (confidence, expectedMargin) in zip(testConfidences, expectedMargins) {
            let margin = confidenceThresholds.getConfidenceMargin(
                confidence,
                for: fieldName
            )
            XCTAssertEqual(margin, expectedMargin, accuracy: 0.01,
                "Margin calculation for confidence \(confidence) should be \(expectedMargin)")
        }
    }
    
    // MARK: - Contextual Confidence Tests
    
    func testContextualConfidence_withSupportingKeywords_boostsScore() {
        // Given: Field with nearby supporting keywords
        let fields = [
            "dateOfBirth": FieldExtractionResult(
                value: "01/15/1990",
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.3, y: 0.5, width: 0.2, height: 0.1)
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "01/15/1990",
                confidence: 0.7,
                boundingBox: CGRect(x: 0.3, y: 0.5, width: 0.2, height: 0.1)
            ),
            // Supporting keyword nearby
            NormalizedTextObservation(
                text: "DOB",
                confidence: 0.9,
                boundingBox: CGRect(x: 0.25, y: 0.5, width: 0.05, height: 0.1)
            )
        ]
        
        // When: Calculating confidence with contextual support
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        // Then: Should have boosted confidence due to contextual evidence
        if let dobField = enhancedFields["dateOfBirth"] {
            XCTAssertGreaterThan(dobField.confidence, 0.7,
                "Confidence should be boosted by supporting keywords")
        }
    }
    
    // MARK: - Cross-Field Validation Tests
    
    func testCrossFieldValidation_withConsistentDates_maintainsHighConfidence() {
        // Given: Consistent date fields
        let fields = [
            "dateOfBirth": FieldExtractionResult(
                value: "01/15/1990",
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.3, y: 0.5, width: 0.2, height: 0.1)
            ),
            "expirationDate": FieldExtractionResult(
                value: "01/15/2026",
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.3, y: 0.4, width: 0.2, height: 0.1)
            )
        ]
        
        let observations = createObservationsFromFields(fields)
        
        // When: Calculating confidence
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        // Then: Both dates should maintain high confidence
        XCTAssertGreaterThan(enhancedFields["dateOfBirth"]?.confidence ?? 0, 0.75)
        XCTAssertGreaterThan(enhancedFields["expirationDate"]?.confidence ?? 0, 0.75)
    }
    
    // MARK: - Performance Tests
    
    func testConfidenceCalculation_performanceWith50Fields() {
        // Given: Large number of fields
        var fields: [String: FieldExtractionResult] = [:]
        for i in 0..<50 {
            fields["field\(i)"] = FieldExtractionResult(
                value: "VALUE\(i)",
                confidence: Float.random(in: 0.5...0.95),
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.1, y: Double(i) * 0.02, width: 0.3, height: 0.02)
            )
        }
        
        let observations = createObservationsFromFields(fields)
        
        // When: Measuring performance
        let startTime = CFAbsoluteTimeGetCurrent()
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        
        // Then: Should complete within performance requirements
        XCTAssertLessThan(processingTime, 0.05, "Confidence calculation should complete in <50ms")
        XCTAssertEqual(enhancedFields.count, fields.count, "All fields should be processed")
    }
    
    // MARK: - Edge Case Tests
    
    func testConfidenceCalculation_withEmptyFields_returnsEmpty() {
        // Given: Empty fields
        let fields: [String: FieldExtractionResult] = [:]
        let observations: [NormalizedTextObservation] = []
        
        // When: Calculating confidence
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        // Then: Should return empty result
        XCTAssertTrue(enhancedFields.isEmpty)
    }
    
    func testConfidenceCalculation_withInvalidValues_handlesGracefully() {
        // Given: Field with extreme confidence values
        let fields = [
            "test1": FieldExtractionResult(
                value: "TEST",
                confidence: -0.5,  // Invalid negative
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            ),
            "test2": FieldExtractionResult(
                value: "TEST",
                confidence: 1.5,  // Invalid > 1.0
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        let observations: [NormalizedTextObservation] = []
        
        // When: Calculating confidence
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        // Then: Should clamp values to valid range
        if let test1 = enhancedFields["test1"] {
            XCTAssertGreaterThanOrEqual(test1.confidence, 0.0)
            XCTAssertLessThanOrEqual(test1.confidence, 1.0)
        }
        if let test2 = enhancedFields["test2"] {
            XCTAssertGreaterThanOrEqual(test2.confidence, 0.0)
            XCTAssertLessThanOrEqual(test2.confidence, 1.0)
        }
    }
    
    // MARK: - Helper Methods
    
    private func createObservationsFromFields(_ fields: [String: FieldExtractionResult]) -> [NormalizedTextObservation] {
        return fields.map { (_, field) in
            NormalizedTextObservation(
                text: field.value,
                confidence: field.confidence,
                boundingBox: field.boundingBox
            )
        }
    }
}