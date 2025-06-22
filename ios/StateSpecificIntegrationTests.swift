import XCTest
@testable import DlScan

class StateSpecificIntegrationTests: XCTestCase {
    
    var ocrFieldParser: OCRFieldParser!
    
    override func setUp() {
        super.setUp()
        ocrFieldParser = OCRFieldParser()
    }
    
    override func tearDown() {
        ocrFieldParser = nil
        super.tearDown()
    }
    
    // MARK: - California Integration Tests
    
    func testCaliforniaLicenseParsingIntegration() {
        // Mock OCR observations for a California license
        let textObservations: [[String: Any]] = [
            [
                "text": "CALIFORNIA DRIVER LICENSE",
                "confidence": 0.95,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.9,
                    "width": 1.0,
                    "height": 0.1
                ]
            ],
            [
                "text": "SMITH, JOHN MICHAEL",
                "confidence": 0.92,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.7,
                    "width": 0.8,
                    "height": 0.08
                ]
            ],
            [
                "text": "DL D1234567",
                "confidence": 0.88,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.5,
                    "width": 0.4,
                    "height": 0.06
                ]
            ],
            [
                "text": "DOB 01/15/1990",
                "confidence": 0.90,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.4,
                    "width": 0.4,
                    "height": 0.06
                ]
            ]
        ]
        
        var error: NSError?
        let result = ocrFieldParser.parseOCRFields(from: textObservations, error: &error)
        
        XCTAssertNil(error, "Parsing should not return an error")
        XCTAssertNotNil(result, "Result should not be nil")
        
        if let result = result {
            XCTAssertEqual(result["detectedState"] as? String, "CA", "Should detect California state")
            XCTAssertEqual(result["stateSpecificRulesApplied"] as? Bool, true, "State-specific rules should be applied")
            XCTAssertEqual(result["licenseNumber"] as? String, "D1234567", "Should extract license number")
            XCTAssertEqual(result["firstName"] as? String, "JOHN", "Should extract first name")
            XCTAssertEqual(result["lastName"] as? String, "SMITH", "Should extract last name")
            XCTAssertEqual(result["extractionMethod"] as? String, "OCR", "Should use OCR extraction method")
            XCTAssertNotNil(result["ocrConfidence"], "Should include OCR confidence")
        }
    }
    
    func testTexasLicenseParsingIntegration() {
        // Mock OCR observations for a Texas license
        let textObservations: [[String: Any]] = [
            [
                "text": "STATE OF TEXAS",
                "confidence": 0.93,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.9,
                    "width": 1.0,
                    "height": 0.1
                ]
            ],
            [
                "text": "JANE MARIE DOE",
                "confidence": 0.89,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.7,
                    "width": 0.8,
                    "height": 0.08
                ]
            ],
            [
                "text": "87654321",
                "confidence": 0.91,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.5,
                    "width": 0.3,
                    "height": 0.06
                ]
            ]
        ]
        
        var error: NSError?
        let result = ocrFieldParser.parseOCRFields(from: textObservations, error: &error)
        
        XCTAssertNil(error, "Parsing should not return an error")
        XCTAssertNotNil(result, "Result should not be nil")
        
        if let result = result {
            XCTAssertEqual(result["detectedState"] as? String, "TX", "Should detect Texas state")
            XCTAssertEqual(result["stateSpecificRulesApplied"] as? Bool, true, "State-specific rules should be applied")
            XCTAssertEqual(result["licenseNumber"] as? String, "87654321", "Should extract 8-digit license number")
            XCTAssertEqual(result["firstName"] as? String, "JANE", "Should extract first name")
            XCTAssertEqual(result["lastName"] as? String, "DOE", "Should extract last name")
        }
    }
    
    func testFloridaLicenseParsingIntegration() {
        // Mock OCR observations for a Florida license
        let textObservations: [[String: Any]] = [
            [
                "text": "FLORIDA DRIVER LICENSE",
                "confidence": 0.94,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.9,
                    "width": 1.0,
                    "height": 0.1
                ]
            ],
            [
                "text": "A123456789012",
                "confidence": 0.87,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.5,
                    "width": 0.4,
                    "height": 0.06
                ]
            ]
        ]
        
        var error: NSError?
        let result = ocrFieldParser.parseOCRFields(from: textObservations, error: &error)
        
        XCTAssertNil(error, "Parsing should not return an error")
        XCTAssertNotNil(result, "Result should not be nil")
        
        if let result = result {
            XCTAssertEqual(result["detectedState"] as? String, "FL", "Should detect Florida state")
            XCTAssertEqual(result["licenseNumber"] as? String, "A123456789012", "Should extract 13-character license number")
        }
    }
    
    func testOCRErrorCorrectionIntegration() {
        // Test OCR error correction for California license with common errors
        let textObservations: [[String: Any]] = [
            [
                "text": "CALIFORNIA DRIVER LICENSE",
                "confidence": 0.95,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.9,
                    "width": 1.0,
                    "height": 0.1
                ]
            ],
            [
                "text": "01234567", // OCR error: 0 instead of D
                "confidence": 0.75, // Lower confidence due to OCR error
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.5,
                    "width": 0.3,
                    "height": 0.06
                ]
            ]
        ]
        
        var error: NSError?
        let result = ocrFieldParser.parseOCRFields(from: textObservations, error: &error)
        
        XCTAssertNil(error, "Parsing should not return an error")
        XCTAssertNotNil(result, "Result should not be nil")
        
        if let result = result {
            XCTAssertEqual(result["detectedState"] as? String, "CA", "Should detect California state")
            // The StateRuleEngine should correct 0→D for California license format
            XCTAssertEqual(result["licenseNumber"] as? String, "D1234567", "Should correct OCR error 0→D")
        }
    }
    
    func testGenericParsingFallback() {
        // Test fallback to generic parsing for unsupported state
        let textObservations: [[String: Any]] = [
            [
                "text": "WYOMING DRIVER LICENSE",
                "confidence": 0.92,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.9,
                    "width": 1.0,
                    "height": 0.1
                ]
            ],
            [
                "text": "WY123456",
                "confidence": 0.88,
                "boundingBox": [
                    "x": 0.0,
                    "y": 0.5,
                    "width": 0.3,
                    "height": 0.06
                ]
            ]
        ]
        
        var error: NSError?
        let result = ocrFieldParser.parseOCRFields(from: textObservations, error: &error)
        
        XCTAssertNil(error, "Parsing should not return an error")
        XCTAssertNotNil(result, "Result should not be nil")
        
        if let result = result {
            // Should not detect a supported state, falling back to generic parsing
            XCTAssertNil(result["detectedState"], "Should not detect unsupported state")
            XCTAssertEqual(result["stateSpecificRulesApplied"] as? Bool, false, "State-specific rules should not be applied")
            XCTAssertEqual(result["extractionMethod"] as? String, "OCR", "Should still use OCR extraction method")
        }
    }
    
    func testPerformanceRequirement() {
        // Test that parsing completes within performance requirements (<500ms)
        let textObservations: [[String: Any]] = [
            [
                "text": "CALIFORNIA DRIVER LICENSE",
                "confidence": 0.95,
                "boundingBox": ["x": 0.0, "y": 0.9, "width": 1.0, "height": 0.1]
            ],
            [
                "text": "SMITH, JOHN MICHAEL",
                "confidence": 0.92,
                "boundingBox": ["x": 0.0, "y": 0.7, "width": 0.8, "height": 0.08]
            ],
            [
                "text": "DL D1234567",
                "confidence": 0.88,
                "boundingBox": ["x": 0.0, "y": 0.5, "width": 0.4, "height": 0.06]
            ]
        ]
        
        measure {
            var error: NSError?
            _ = ocrFieldParser.parseOCRFields(from: textObservations, error: &error)
        }
        
        // Get the last processing time
        let processingTime = ocrFieldParser.getLastProcessingTime()
        
        XCTAssertLessThan(processingTime, 0.5, "Parsing should complete within 500ms performance requirement")
    }
}