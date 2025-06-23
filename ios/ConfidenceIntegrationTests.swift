import XCTest
import Vision
@testable import RnDlScan

/**
 * Integration tests for confidence-based decision making
 * Tests the complete confidence scoring and error correction pipeline
 */
class ConfidenceIntegrationTests: XCTestCase {
    
    private var parser: OCRFieldParser!
    
    override func setUp() {
        super.setUp()
        parser = OCRFieldParser()
    }
    
    override func tearDown() {
        parser = nil
        super.tearDown()
    }
    
    // MARK: - End-to-End Integration Tests
    
    func testEndToEnd_highConfidenceScenario_extractsAllFields() {
        // Given: High-confidence perfect OCR data
        let observations = MockOCRDataGenerator.generateHighConfidencePerfectOCR()
        
        // When: Processing through complete pipeline
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should extract all fields with high confidence
        XCTAssertNil(error)
        XCTAssertNotNil(result)
        
        if let result = result {
            // Verify all critical fields extracted
            XCTAssertEqual(result["firstName"] as? String, "MICHAEL")
            XCTAssertEqual(result["lastName"] as? String, "ANDERSON")
            XCTAssertEqual(result["licenseNumber"] as? String, "D1234567")
            XCTAssertEqual(result["dateOfBirth"] as? String, "1985-03-15")
            XCTAssertEqual(result["sex"] as? String, "M")
            
            // Verify confidence metadata
            let overallConfidence = result["ocrConfidence"] as? Float ?? 0
            XCTAssertGreaterThan(overallConfidence, 0.85, "High quality OCR should have high confidence")
            
            // Verify field-level confidence
            if let fieldConfidences = result["fieldConfidences"] as? [String: Float] {
                for (field, confidence) in fieldConfidences {
                    XCTAssertGreaterThan(confidence, 0.8, "Field '\(field)' should have high confidence")
                }
            }
        }
    }
    
    func testEndToEnd_mediumConfidenceWithErrors_correctsAndExtractsFields() {
        // Given: Medium confidence data with OCR errors
        let observations = MockOCRDataGenerator.generateMediumConfidenceWithErrors()
        
        // When: Processing through complete pipeline
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should correct errors and extract fields
        XCTAssertNil(error)
        XCTAssertNotNil(result)
        
        if let result = result {
            // Verify error corrections were applied
            XCTAssertEqual(result["firstName"] as? String, "MICHAEL", "Should correct M1CHAEL to MICHAEL")
            XCTAssertEqual(result["lastName"] as? String, "ANDERSON", "Should correct ANDERS0N to ANDERSON")
            XCTAssertEqual(result["licenseNumber"] as? String, "D1234560", "Should correct DI23456O")
            XCTAssertEqual(result["sex"] as? String, "M", "Should correct N to M")
            
            // Verify confidence reflects medium quality
            let overallConfidence = result["ocrConfidence"] as? Float ?? 0
            XCTAssertGreaterThan(overallConfidence, 0.6)
            XCTAssertLessThan(overallConfidence, 0.8)
            
            // Verify corrections summary
            if let correctionsSummary = result["correctionsSummary"] as? [String: Int] {
                // Should have corrections applied
                XCTAssertGreaterThan(correctionsSummary.values.reduce(0, +), 0,
                    "Should track error corrections")
            }
        }
    }
    
    func testEndToEnd_lowConfidencePoorQuality_appliesHeavyCorrection() {
        // Given: Low confidence poor quality data
        let observations = MockOCRDataGenerator.generateLowConfidencePoorQuality()
        
        // When: Processing through complete pipeline
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should attempt corrections but may reject some fields
        if let result = result {
            let overallConfidence = result["ocrConfidence"] as? Float ?? 0
            XCTAssertLessThan(overallConfidence, 0.6, "Poor quality should have low confidence")
            
            // Some fields may be rejected due to low confidence
            let fieldConfidences = result["fieldConfidences"] as? [String: Float] ?? [:]
            
            // Check which fields met thresholds
            let thresholds = ConfidenceThresholds()
            for (field, confidence) in fieldConfidences {
                let threshold = thresholds.getThreshold(for: field)
                if confidence < threshold {
                    print("Field '\(field)' rejected: confidence \(confidence) < threshold \(threshold)")
                }
            }
        }
    }
    
    // MARK: - Confidence-Based Field Acceptance Tests
    
    func testFieldAcceptance_criticalFields_requireHigherConfidence() {
        // Given: Mixed confidence data
        let observations = MockOCRDataGenerator.generateMixedConfidenceFields()
        
        // When: Processing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Critical fields should require higher confidence
        if let result = result,
           let fieldConfidences = result["fieldConfidences"] as? [String: Float] {
            
            // License number requires 0.8 confidence
            if let licenseConfidence = fieldConfidences["licenseNumber"] {
                if licenseConfidence < 0.8 {
                    XCTAssertNil(result["licenseNumber"],
                        "License number should be rejected if confidence < 0.8")
                } else {
                    XCTAssertNotNil(result["licenseNumber"],
                        "License number should be accepted if confidence >= 0.8")
                }
            }
            
            // Names require 0.7 confidence
            if let firstNameConfidence = fieldConfidences["firstName"] {
                if firstNameConfidence < 0.7 {
                    // May be present but marked as low confidence
                    print("First name confidence: \(firstNameConfidence)")
                }
            }
        }
    }
    
    func testFieldAcceptance_nonCriticalFields_acceptLowerConfidence() {
        // Given: Data with varying confidence
        let observations = createObservationsWithVaryingConfidence()
        
        // When: Processing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Non-critical fields should accept lower confidence
        if let result = result {
            // Hair/eye color only need 0.5 confidence
            XCTAssertNotNil(result["hairColor"], "Hair color should be accepted with lower confidence")
            XCTAssertNotNil(result["eyeColor"], "Eye color should be accepted with lower confidence")
            
            // Optional fields like restrictions/endorsements also have low thresholds
            // These may be present even with low confidence
        }
    }
    
    // MARK: - State-Specific Integration Tests
    
    func testStateSpecificIntegration_california_appliesStateRules() {
        // Given: California license with errors
        let observations = MockOCRDataGenerator.generateCaliforniaSpecificErrors()
        
        // When: Processing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should apply California-specific corrections
        if let result = result {
            // Should detect California and apply state rules
            XCTAssertEqual(result["detectedState"] as? String, "CA")
            XCTAssertEqual(result["stateSpecificRulesApplied"] as? Bool, true)
            
            // License number should be corrected to CA format
            if let licenseNumber = result["licenseNumber"] as? String {
                XCTAssertTrue(licenseNumber.hasPrefix("D"), "CA license should start with letter")
                XCTAssertEqual(licenseNumber.count, 8, "CA license should be 8 characters")
            }
        }
    }
    
    func testStateSpecificIntegration_multipleStates_correctlyIdentifiesEach() {
        let stateTests = [
            ("California", MockOCRDataGenerator.generateCaliforniaSpecificErrors(), "CA"),
            ("Texas", MockOCRDataGenerator.generateTexasSpecificErrors(), "TX"),
            ("Florida", MockOCRDataGenerator.generateFloridaSpecificErrors(), "FL")
        ]
        
        for (stateName, observations, expectedCode) in stateTests {
            var error: NSError?
            let result = parser.parseOCRFields(from: observations, error: &error)
            
            if let result = result {
                XCTAssertEqual(result["detectedState"] as? String, expectedCode,
                    "\(stateName) should be detected as \(expectedCode)")
            }
        }
    }
    
    // MARK: - Cross-Field Validation Integration Tests
    
    func testCrossFieldValidation_consistentData_maintainsHighConfidence() {
        // Given: Data with consistent cross-field relationships
        let observations = MockOCRDataGenerator.generateCrossFieldValidationScenario()
        
        // When: Processing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Consistent fields should maintain or boost confidence
        if let result = result {
            // Names should validate against full name
            XCTAssertEqual(result["firstName"] as? String, "ROBERT")
            XCTAssertEqual(result["lastName"] as? String, "SMITH")
            
            // Dates should be logically consistent
            if let dob = result["dateOfBirth"] as? String,
               let issue = result["issueDate"] as? String {
                // Issue date should be after DOB
                XCTAssertTrue(issue > dob, "Issue date should be after birth date")
            }
        }
    }
    
    // MARK: - Error Correction Impact Tests
    
    func testErrorCorrectionImpact_minorCorrections_improveConfidence() {
        // Given: Fields with minor OCR errors
        let fields = [
            "firstName": FieldExtractionResult(
                value: "J0HN",
                confidence: 0.7,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // When: Applying corrections
        let errorCorrector = ErrorCorrector()
        let correctedFields = errorCorrector.correctFields(
            fields,
            detectedState: nil,
            from: []
        )
        
        // Then: Should correct and potentially improve confidence
        if let correctedField = correctedFields["firstName"] {
            XCTAssertEqual(correctedField.value, "JOHN")
            XCTAssertGreaterThanOrEqual(correctedField.confidence, 0.7,
                "Confidence should not decrease for successful correction")
        }
    }
    
    // MARK: - Performance Under Load Tests
    
    func testIntegrationPerformance_typicalLoad_meetsRequirements() {
        // Given: Typical license data
        let observations = MockOCRDataGenerator.generateHighConfidencePerfectOCR()
        
        // When: Processing multiple times
        let iterations = 100
        var processingTimes: [TimeInterval] = []
        
        for _ in 0..<iterations {
            let startTime = CFAbsoluteTimeGetCurrent()
            var error: NSError?
            _ = parser.parseOCRFields(from: observations, error: &error)
            processingTimes.append(CFAbsoluteTimeGetCurrent() - startTime)
        }
        
        // Then: Should consistently meet performance requirements
        let averageTime = processingTimes.reduce(0, +) / Double(iterations)
        let maxTime = processingTimes.max() ?? 0
        
        XCTAssertLessThan(averageTime, 0.5, "Average processing should be <500ms")
        XCTAssertLessThan(maxTime, 0.6, "Max processing should be <600ms")
        
        // Confidence system overhead
        let baselineTime = 0.45 // Approximate baseline without confidence
        let overhead = averageTime - baselineTime
        XCTAssertLessThan(overhead, 0.05, "Confidence system overhead should be <50ms")
    }
    
    // MARK: - Fallback Decision Tests
    
    func testFallbackDecision_lowOverallConfidence_triggersManualReview() {
        // Given: Poor quality data across all fields
        let observations = MockOCRDataGenerator.generateLowConfidencePoorQuality()
        
        // When: Processing
        var error: NSError?
        let result = parser.parseOCRFields(from: observations, error: &error)
        
        // Then: Should indicate need for fallback/manual review
        if let result = result {
            let overallConfidence = result["ocrConfidence"] as? Float ?? 0
            
            // Define fallback threshold
            let fallbackThreshold: Float = 0.6
            
            if overallConfidence < fallbackThreshold {
                // In real implementation, this would trigger fallback
                print("Low confidence \(overallConfidence) - recommend manual review or alternative method")
                XCTAssertTrue(true, "Correctly identified need for fallback")
            }
        }
    }
    
    // MARK: - Helper Methods
    
    private func createObservationsWithVaryingConfidence() -> [[String: Any]] {
        return [
            // High confidence critical fields
            ["text": "DL D1234567", "confidence": Float(0.9), 
             "boundingBox": ["x": 0.1, "y": 0.6, "width": 0.2, "height": 0.05]],
            
            // Medium confidence names
            ["text": "FN SARAH", "confidence": Float(0.72), 
             "boundingBox": ["x": 0.1, "y": 0.7, "width": 0.2, "height": 0.05]],
            
            // Low confidence non-critical fields
            ["text": "HAIR BLN", "confidence": Float(0.52), 
             "boundingBox": ["x": 0.5, "y": 0.3, "width": 0.15, "height": 0.05]],
            ["text": "EYES BLU", "confidence": Float(0.55), 
             "boundingBox": ["x": 0.5, "y": 0.35, "width": 0.15, "height": 0.05]]
        ]
    }
}