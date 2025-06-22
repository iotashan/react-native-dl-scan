import XCTest
@testable import DlScan

class StateRuleEngineTests: XCTestCase {
    
    var stateRuleEngine: StateRuleEngine!
    
    override func setUp() {
        super.setUp()
        stateRuleEngine = StateRuleEngine()
    }
    
    override func tearDown() {
        stateRuleEngine = nil
        super.tearDown()
    }
    
    // MARK: - State Detection Tests
    
    func testDetectCaliforniaFromExplicitIdentifier() {
        let observations = [
            NormalizedTextObservation(
                text: "CALIFORNIA DRIVER LICENSE",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.8, width: 1, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "CA", "Should detect California from explicit identifier")
    }
    
    func testDetectTexasFromExplicitIdentifier() {
        let observations = [
            NormalizedTextObservation(
                text: "STATE OF TEXAS",
                confidence: 0.85,
                boundingBox: CGRect(x: 0, y: 0.8, width: 1, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "TX", "Should detect Texas from explicit identifier")
    }
    
    func testDetectCaliforniaFromLicensePattern() {
        let observations = [
            NormalizedTextObservation(
                text: "DL D1234567",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 0.5, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "CA", "Should detect California from license number pattern")
    }
    
    func testDetectTexasFromLicensePattern() {
        let observations = [
            NormalizedTextObservation(
                text: "12345678",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 0.5, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "TX", "Should detect Texas from 8-digit license pattern")
    }
    
    func testDetectFloridaFromLicensePattern() {
        let observations = [
            NormalizedTextObservation(
                text: "D123456789012",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 0.5, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "FL", "Should detect Florida from license number pattern")
    }
    
    func testDetectNewYorkFromLicensePattern() {
        let observations = [
            NormalizedTextObservation(
                text: "123456789",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 0.5, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "NY", "Should detect New York from 9-digit license pattern")
    }
    
    func testDetectIllinoisFromLicensePattern() {
        let observations = [
            NormalizedTextObservation(
                text: "A12345678901",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 0.5, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "IL", "Should detect Illinois from license number pattern")
    }
    
    func testDetectCaliforniaFromNameFormat() {
        let observations = [
            NormalizedTextObservation(
                text: "SMITH, JOHN MICHAEL",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.7, width: 1, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "CA", "Should detect California from comma-separated name format")
    }
    
    func testNoStateDetected() {
        let observations = [
            NormalizedTextObservation(
                text: "UNKNOWN LICENSE FORMAT",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 1, height: 0.1)
            )
        ]
        
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertNil(detectedState, "Should return nil when no state can be detected")
    }
    
    // MARK: - State-Specific Rule Application Tests
    
    func testApplyCaliforniaLicenseCorrections() {
        let basicFields: [String: FieldExtractionResult] = [
            "licenseNumber": FieldExtractionResult(
                value: "01234567", // OCR error: 0 instead of D
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "01234567",
                confidence: 0.8,
                boundingBox: CGRect.zero
            )
        ]
        
        let enhancedFields = stateRuleEngine.applyStateSpecificRules(
            for: "CA",
            to: basicFields,
            from: observations
        )
        
        XCTAssertEqual(
            enhancedFields["licenseNumber"]?.value,
            "D1234567",
            "Should correct OCR error 0→D for California license number"
        )
    }
    
    func testApplyTexasLicenseCorrections() {
        let basicFields: [String: FieldExtractionResult] = [
            "licenseNumber": FieldExtractionResult(
                value: "1234567O", // OCR error: O instead of 0
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "1234567O",
                confidence: 0.8,
                boundingBox: CGRect.zero
            )
        ]
        
        let enhancedFields = stateRuleEngine.applyStateSpecificRules(
            for: "TX",
            to: basicFields,
            from: observations
        )
        
        XCTAssertEqual(
            enhancedFields["licenseNumber"]?.value,
            "12345670",
            "Should correct OCR error O→0 for Texas license number"
        )
    }
    
    func testApplyUnsupportedStateRules() {
        let basicFields: [String: FieldExtractionResult] = [
            "licenseNumber": FieldExtractionResult(
                value: "12345678",
                confidence: 0.8,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        let observations = [
            NormalizedTextObservation(
                text: "12345678",
                confidence: 0.8,
                boundingBox: CGRect.zero
            )
        ]
        
        let enhancedFields = stateRuleEngine.applyStateSpecificRules(
            for: "WY", // Unsupported state
            to: basicFields,
            from: observations
        )
        
        XCTAssertEqual(
            enhancedFields["licenseNumber"]?.value,
            "12345678",
            "Should return unchanged fields for unsupported state"
        )
    }
    
    // MARK: - Confidence Weight Tests
    
    func testCaliforniaConfidenceWeights() {
        let weights = stateRuleEngine.getStateConfidenceWeights(for: "CA")
        
        XCTAssertEqual(weights["licenseNumber"], 0.35, "California should have high weight for distinctive license format")
        XCTAssertEqual(weights["firstName"], 0.15, "California should have standard weight for firstName")
        XCTAssertEqual(weights["lastName"], 0.15, "California should have standard weight for lastName")
    }
    
    func testFloridaConfidenceWeights() {
        let weights = stateRuleEngine.getStateConfidenceWeights(for: "FL")
        
        XCTAssertEqual(weights["licenseNumber"], 0.40, "Florida should have very high weight for distinctive license format")
    }
    
    func testGenericConfidenceWeights() {
        let weights = stateRuleEngine.getStateConfidenceWeights(for: "UNKNOWN")
        
        XCTAssertEqual(weights["firstName"], 0.15, "Generic weights should be returned for unknown state")
        XCTAssertEqual(weights["licenseNumber"], 0.30, "Generic weights should be returned for unknown state")
    }
    
    // MARK: - Integration Tests
    
    func testCompleteCaliforniaParsingWorkflow() {
        let observations = [
            NormalizedTextObservation(
                text: "CALIFORNIA DRIVER LICENSE",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.9, width: 1, height: 0.1)
            ),
            NormalizedTextObservation(
                text: "SMITH, JOHN MICHAEL",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.7, width: 1, height: 0.1)
            ),
            NormalizedTextObservation(
                text: "DL D1234567",
                confidence: 0.9,
                boundingBox: CGRect(x: 0, y: 0.5, width: 0.5, height: 0.1)
            )
        ]
        
        // Test state detection
        let detectedState = stateRuleEngine.detectState(from: observations)
        XCTAssertEqual(detectedState, "CA", "Should detect California state")
        
        // Test basic field extraction (mock)
        let basicFields: [String: FieldExtractionResult] = [
            "licenseNumber": FieldExtractionResult(
                value: "D1234567",
                confidence: 0.9,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            ),
            "firstName": FieldExtractionResult(
                value: "JOHN",
                confidence: 0.9,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            ),
            "lastName": FieldExtractionResult(
                value: "SMITH",
                confidence: 0.9,
                extractionMethod: .patternMatching,
                boundingBox: CGRect.zero
            )
        ]
        
        // Test state-specific rule application
        let enhancedFields = stateRuleEngine.applyStateSpecificRules(
            for: "CA",
            to: basicFields,
            from: observations
        )
        
        XCTAssertNotNil(enhancedFields["licenseNumber"], "License number should be preserved")
        XCTAssertNotNil(enhancedFields["firstName"], "First name should be preserved")
        XCTAssertNotNil(enhancedFields["lastName"], "Last name should be preserved")
    }
}