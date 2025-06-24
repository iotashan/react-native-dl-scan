import XCTest
@testable import DlScan

class FieldParsingTests: XCTestCase {
    
    var fieldParser: OCRFieldParser!
    
    override func setUp() {
        super.setUp()
        fieldParser = OCRFieldParser()
    }
    
    override func tearDown() {
        fieldParser = nil
        super.tearDown()
    }
    
    // MARK: - Basic Field Extraction
    
    func testNameFieldExtraction() {
        // Given
        let ocrText = TestDataProvider.sampleOCRText()
        
        // When
        let fields = fieldParser.parseFields(from: ocrText)
        
        // Then
        XCTAssertEqual(fields["firstName"], "MICHAEL")
        XCTAssertEqual(fields["middleName"], "JAMES")
        XCTAssertEqual(fields["lastName"], "SAMPLE")
        XCTAssertEqual(fields["suffix"], "JR")
    }
    
    func testDocumentNumberExtraction() {
        // Given
        let ocrText = TestDataProvider.sampleOCRText()
        
        // When
        let fields = fieldParser.parseFields(from: ocrText)
        
        // Then
        XCTAssertEqual(fields["documentNumber"], "D123456789")
    }
    
    func testDateFieldExtraction() {
        // Given
        let ocrText = TestDataProvider.sampleOCRText()
        
        // When
        let fields = fieldParser.parseFields(from: ocrText)
        
        // Then
        XCTAssertEqual(fields["dateOfBirth"], "06/06/1986")
        XCTAssertEqual(fields["dateOfExpiry"], "12/10/2024")
    }
    
    func testAddressExtraction() {
        // Given
        let ocrText = TestDataProvider.sampleOCRText()
        
        // When
        let fields = fieldParser.parseFields(from: ocrText)
        
        // Then
        XCTAssertEqual(fields["address"], "2300 WEST BROAD STREET")
        XCTAssertEqual(fields["city"], "RICHMOND")
        XCTAssertEqual(fields["state"], "VA")
        XCTAssertEqual(fields["postalCode"], "23269")
    }
    
    // MARK: - Error Correction Tests
    
    func testOCRErrorCorrection() {
        // Given
        let ocrTextWithErrors = TestDataProvider.ocrTextWithErrors()
        
        // When
        let fields = fieldParser.parseFields(from: ocrTextWithErrors)
        
        // Then - Common OCR errors should be corrected
        XCTAssertEqual(fields["firstName"], "MICHAEL") // Corrected from M1CHAEL
        XCTAssertEqual(fields["lastName"], "SAMPLE") // Corrected from 5AMPLE
        XCTAssertNotNil(fields["documentNumber"]) // Should handle D12E456789
    }
    
    func testDateFormatNormalization() {
        // Given various date formats
        let testCases = [
            "DOB 01-01-1990": "01/01/1990",
            "DOB 01.01.1990": "01/01/1990",
            "DOB 01/01/90": "01/01/1990",
            "DOB Jan 1, 1990": "01/01/1990"
        ]
        
        for (input, expected) in testCases {
            // When
            let fields = fieldParser.parseFields(from: input)
            
            // Then
            XCTAssertEqual(fields["dateOfBirth"], expected, "Failed for input: \(input)")
        }
    }
    
    // MARK: - State-Specific Rules
    
    func testVirginiaSpecificParsing() {
        // Given
        let virginiaText = TestDataProvider.sampleOCRText()
        
        // When
        let fields = fieldParser.parseFields(from: virginiaText, state: "VA")
        
        // Then
        XCTAssertNotNil(fields["class"])
        XCTAssertNotNil(fields["restrictions"])
        XCTAssertNotNil(fields["endorsements"])
    }
    
    // MARK: - Confidence Scoring
    
    func testFieldConfidenceScoring() {
        // Given
        let ocrText = TestDataProvider.sampleOCRText()
        
        // When
        let result = fieldParser.parseFieldsWithConfidence(from: ocrText)
        
        // Then
        XCTAssertGreaterThan(result.overallConfidence, 0.8)
        XCTAssertGreaterThan(result.fieldConfidence["firstName"] ?? 0, 0.9)
        XCTAssertGreaterThan(result.fieldConfidence["documentNumber"] ?? 0, 0.85)
    }
    
    // MARK: - Edge Cases
    
    func testEmptyTextHandling() {
        // Given
        let emptyText = ""
        
        // When
        let fields = fieldParser.parseFields(from: emptyText)
        
        // Then
        XCTAssertTrue(fields.isEmpty)
    }
    
    func testMalformedTextHandling() {
        // Given
        let malformedText = "!@#$%^&*()"
        
        // When
        let fields = fieldParser.parseFields(from: malformedText)
        
        // Then
        XCTAssertTrue(fields.isEmpty || fields.values.allSatisfy { $0.isEmpty })
    }
    
    // MARK: - Performance Tests
    
    func testParsingPerformance() {
        let ocrText = TestDataProvider.sampleOCRText()
        
        measure {
            _ = fieldParser.parseFields(from: ocrText)
        }
    }
}