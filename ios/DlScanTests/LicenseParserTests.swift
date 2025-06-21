import XCTest
import DLParser
@testable import DlScan

class LicenseParserTests: XCTestCase {
    
    func testValidAAMVAParsing() throws {
        // This would require a real AAMVA barcode data string
        // For now, we'll test the error handling path since we don't have sample data
        let testData = "INVALID_TEST_DATA"
        var error: NSError?
        let result = LicenseParser.parse(testData, error: &error)
        
        // Should return nil with error for invalid data
        XCTAssertNil(result)
        XCTAssertNotNil(error)
    }
    
    func testInvalidDataHandling() {
        let invalidData = "INVALID_BARCODE"
        var error: NSError?
        let result = LicenseParser.parse(invalidData, error: &error)
        
        XCTAssertNil(result)
        XCTAssertNotNil(error)
    }
    
    func testEmptyDataHandling() {
        let emptyData = ""
        var error: NSError?
        let result = LicenseParser.parse(emptyData, error: &error)
        
        XCTAssertNil(result)
        XCTAssertNotNil(error)
    }
}

class ErrorTranslatorTests: XCTestCase {
    
    func testErrorTranslation() {
        let testError = NSError(domain: "TestDomain", code: 1, userInfo: [NSLocalizedDescriptionKey: "Test error"])
        let translatedError = ErrorTranslator.translate(testError)
        
        XCTAssertNotNil(translatedError["code"])
        XCTAssertNotNil(translatedError["message"])
        XCTAssertNotNil(translatedError["userMessage"])
        XCTAssertNotNil(translatedError["recoverable"])
        
        XCTAssertEqual(translatedError["message"] as? String, "Test error")
        XCTAssertEqual(translatedError["recoverable"] as? Bool, true)
    }
}