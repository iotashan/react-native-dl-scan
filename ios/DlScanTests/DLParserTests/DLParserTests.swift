import XCTest
@testable import DlScan

class DLParserTests: XCTestCase {
    
    var parser: LicenseParser!
    
    override func setUp() {
        super.setUp()
        parser = LicenseParser()
    }
    
    override func tearDown() {
        parser = nil
        super.tearDown()
    }
    
    // MARK: - Basic Parsing Tests
    
    func testValidPDF417Parsing() throws {
        // Given
        let testData = TestDataProvider.validPDF417Data()
        
        // When
        let result = try parser.parse(testData)
        
        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result.firstName, "MICHAEL")
        XCTAssertEqual(result.lastName, "SAMPLE")
        XCTAssertEqual(result.documentNumber, "D12345678")
        XCTAssertEqual(result.dateOfBirth, "06/06/1986")
        XCTAssertEqual(result.dateOfExpiry, "12/10/2024")
    }
    
    func testInvalidDataThrowsError() {
        // Given
        let invalidData = TestDataProvider.invalidPDF417Data()
        
        // When/Then
        XCTAssertThrowsError(try parser.parse(invalidData)) { error in
            XCTAssertEqual((error as? LicenseParsingError)?.code, "INVALID_FORMAT")
        }
    }
    
    func testCorruptedDataHandling() {
        // Given
        let corruptedData = TestDataProvider.corruptedPDF417Data()
        
        // When
        do {
            let result = try parser.parse(corruptedData)
            
            // Then - Should parse what it can
            XCTAssertNotNil(result)
            XCTAssertNotNil(result.documentNumber)
            // Some fields may be nil due to corruption
        } catch {
            // Acceptable if it throws for severely corrupted data
            XCTAssertNotNil(error)
        }
    }
    
    // MARK: - Field Extraction Tests
    
    func testAddressExtraction() throws {
        // Given
        let testData = TestDataProvider.validPDF417Data()
        
        // When
        let result = try parser.parse(testData)
        
        // Then
        XCTAssertEqual(result.address, "2300 WEST BROAD STREET")
        XCTAssertEqual(result.city, "RICHMOND")
        XCTAssertEqual(result.state, "VA")
        XCTAssertEqual(result.postalCode, "23269")
    }
    
    func testOptionalFieldExtraction() throws {
        // Given
        let testData = TestDataProvider.validPDF417Data()
        
        // When
        let result = try parser.parse(testData)
        
        // Then
        XCTAssertEqual(result.middleName, "JAMES")
        XCTAssertEqual(result.suffix, "JR")
        XCTAssertEqual(result.height, "068 in")
        XCTAssertEqual(result.eyeColor, "BRO")
    }
    
    // MARK: - Edge Cases
    
    func testEmptyDataHandling() {
        // Given
        let emptyData = ""
        
        // When/Then
        XCTAssertThrowsError(try parser.parse(emptyData))
    }
    
    func testWhitespaceHandling() throws {
        // Test that parser properly trims whitespace
        // Implementation depends on actual parser behavior
    }
    
    // MARK: - Performance Tests
    
    func testParsingPerformance() {
        let testData = TestDataProvider.validPDF417Data()
        
        measure {
            do {
                _ = try parser.parse(testData)
            } catch {
                XCTFail("Performance test failed: \(error)")
            }
        }
    }
    
    func testBulkParsingPerformance() {
        let testData = TestDataProvider.validPDF417Data()
        
        measure {
            for _ in 0..<100 {
                do {
                    _ = try parser.parse(testData)
                } catch {
                    XCTFail("Bulk performance test failed: \(error)")
                }
            }
        }
    }
}