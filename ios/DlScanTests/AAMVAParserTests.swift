import XCTest
@testable import DlScan

/**
 * Comprehensive test suite for AAMVA parser
 * Tests all supported states, formats, and edge cases
 */
class AAMVAParserTests: XCTestCase {
    
    // MARK: - Basic AAMVA Compliance Tests
    
    func testAAMVAComplianceDetection() {
        XCTAssertTrue(AAMVAParser.isAAMVACompliant(TestDataProvider.validPDF417Data()))
        XCTAssertTrue(AAMVAParser.isAAMVACompliant(TestDataProvider.californiaAAMVAData()))
        XCTAssertTrue(AAMVAParser.isAAMVACompliant(TestDataProvider.texasAAMVAData()))
        XCTAssertTrue(AAMVAParser.isAAMVACompliant(TestDataProvider.floridaAAMVAData()))
        XCTAssertTrue(AAMVAParser.isAAMVACompliant(TestDataProvider.newYorkAAMVAData()))
        XCTAssertTrue(AAMVAParser.isAAMVACompliant(TestDataProvider.illinoisAAMVAData()))
        
        XCTAssertFalse(AAMVAParser.isAAMVACompliant("INVALID_DATA"))
        XCTAssertFalse(AAMVAParser.isAAMVACompliant(""))
        XCTAssertFalse(AAMVAParser.isAAMVACompliant("PDF417_WITHOUT_AAMVA_HEADER"))
    }
    
    func testSupportedVersions() {
        let versions = AAMVAParser.getSupportedVersions()
        XCTAssertTrue(versions.contains("01"))
        XCTAssertTrue(versions.contains("10"))
        XCTAssertEqual(versions.count, 10)
    }
    
    // MARK: - California AAMVA Parsing Tests
    
    func testCaliforniaAAMVAParsing() throws {
        let result = try AAMVAParser.parse(TestDataProvider.californiaAAMVAData())
        
        // Verify basic parsing
        XCTAssertNotNil(result)
        XCTAssertEqual(result["aamvaCompliant"] as? Bool, true)
        XCTAssertEqual(result["parsingMethod"] as? String, "AAMVA")
        
        // Verify personal information
        XCTAssertEqual(result["firstName"] as? String, "JOHN")
        XCTAssertEqual(result["lastName"] as? String, "DOE")
        XCTAssertEqual(result["middleName"] as? String, "ALBERT")
        XCTAssertEqual(result["suffix"] as? String, "SR")
        
        // Verify license information
        XCTAssertEqual(result["licenseNumber"] as? String, "D1234567")
        XCTAssertEqual(result["licenseClass"] as? String, "C")
        
        // Verify address
        if let address = result["address"] as? [String: String] {
            XCTAssertEqual(address["street"], "123 MAIN ST")
            XCTAssertEqual(address["city"], "SACRAMENTO")
            XCTAssertEqual(address["state"], "CA")
            XCTAssertEqual(address["postalCode"], "958012345")
        } else {
            XCTFail("Address not parsed correctly")
        }
        
        // Verify California-specific validation
        XCTAssertEqual(result["issuingState"] as? String, "CA")
        XCTAssertEqual(result["issuerIdentificationNumber"] as? String, "636014")
        
        // Verify flags
        XCTAssertEqual(result["isRealID"] as? Bool, false)
        XCTAssertEqual(result["isVeteran"] as? Bool, false)
        XCTAssertEqual(result["isOrganDonor"] as? Bool, true)
    }
    
    func testCaliforniaLicenseNumberValidation() throws {
        let result = try AAMVAParser.parse(TestDataProvider.californiaAAMVAData())
        
        if let licenseNumber = result["licenseNumber"] as? String {
            // California format: 1 letter + 7 digits
            let caPattern = "^[A-Z]\\d{7}$"
            XCTAssertTrue(licenseNumber.range(of: caPattern, options: .regularExpression) != nil,
                         "California license number should match format: \(licenseNumber)")
        } else {
            XCTFail("License number not found")
        }
    }
    
    // MARK: - Texas AAMVA Parsing Tests
    
    func testTexasAAMVAParsing() throws {
        let result = try AAMVAParser.parse(TestDataProvider.texasAAMVAData())
        
        // Verify basic parsing
        XCTAssertNotNil(result)
        XCTAssertEqual(result["aamvaCompliant"] as? Bool, true)
        
        // Verify personal information
        XCTAssertEqual(result["firstName"] as? String, "MARY")
        XCTAssertEqual(result["lastName"] as? String, "JONES")
        XCTAssertEqual(result["middleName"] as? String, "SUE")
        
        // Verify license information
        XCTAssertEqual(result["licenseNumber"] as? String, "TX12345678")
        XCTAssertEqual(result["licenseClass"] as? String, "C")
        
        // Verify address
        if let address = result["address"] as? [String: String] {
            XCTAssertEqual(address["street"], "456 ELM ST")
            XCTAssertEqual(address["city"], "DALLAS")
            XCTAssertEqual(address["state"], "TX")
            XCTAssertEqual(address["postalCode"], "752010000")
        } else {
            XCTFail("Address not parsed correctly")
        }
        
        // Verify Texas-specific validation
        XCTAssertEqual(result["issuingState"] as? String, "TX")
        XCTAssertEqual(result["issuerIdentificationNumber"] as? String, "636053")
    }
    
    func testTexasLicenseNumberValidation() throws {
        let result = try AAMVAParser.parse(TestDataProvider.texasAAMVAData())
        
        if let licenseNumber = result["licenseNumber"] as? String {
            // Texas format: 8 digits
            let txPattern = "^[A-Z]*\\d{8}$"
            XCTAssertTrue(licenseNumber.range(of: txPattern, options: .regularExpression) != nil,
                         "Texas license number should match format: \(licenseNumber)")
        } else {
            XCTFail("License number not found")
        }
    }
    
    // MARK: - Florida AAMVA Parsing Tests
    
    func testFloridaAAMVAParsing() throws {
        let result = try AAMVAParser.parse(TestDataProvider.floridaAAMVAData())
        
        // Verify basic parsing
        XCTAssertNotNil(result)
        XCTAssertEqual(result["aamvaCompliant"] as? Bool, true)
        
        // Verify personal information
        XCTAssertEqual(result["firstName"] as? String, "ROBERT")
        XCTAssertEqual(result["lastName"] as? String, "SMITH")
        XCTAssertEqual(result["middleName"] as? String, "WILLIAM")
        XCTAssertEqual(result["suffix"] as? String, "III")
        
        // Verify license information
        XCTAssertEqual(result["licenseNumber"] as? String, "F123456789012")
        XCTAssertEqual(result["licenseClass"] as? String, "E")
        XCTAssertEqual(result["restrictions"] as? String, "CORRECTIVE LENSES")
        XCTAssertEqual(result["endorsements"] as? String, "MOTORCYCLE")
        
        // Verify address
        if let address = result["address"] as? [String: String] {
            XCTAssertEqual(address["street"], "789 BEACH BLVD")
            XCTAssertEqual(address["city"], "MIAMI")
            XCTAssertEqual(address["state"], "FL")
            XCTAssertEqual(address["postalCode"], "331234567")
        } else {
            XCTFail("Address not parsed correctly")
        }
        
        // Verify Florida-specific validation
        XCTAssertEqual(result["issuingState"] as? String, "FL")
        XCTAssertEqual(result["issuerIdentificationNumber"] as? String, "636019")
    }
    
    func testFloridaLicenseNumberValidation() throws {
        let result = try AAMVAParser.parse(TestDataProvider.floridaAAMVAData())
        
        if let licenseNumber = result["licenseNumber"] as? String {
            // Florida format: 1 letter + 12 digits
            let flPattern = "^[A-Z]\\d{12}$"
            XCTAssertTrue(licenseNumber.range(of: flPattern, options: .regularExpression) != nil,
                         "Florida license number should match format: \(licenseNumber)")
        } else {
            XCTFail("License number not found")
        }
    }
    
    // MARK: - New York AAMVA Parsing Tests
    
    func testNewYorkAAMVAParsing() throws {
        let result = try AAMVAParser.parse(TestDataProvider.newYorkAAMVAData())
        
        // Verify basic parsing
        XCTAssertNotNil(result)
        XCTAssertEqual(result["aamvaCompliant"] as? Bool, true)
        
        // Verify personal information
        XCTAssertEqual(result["firstName"] as? String, "LINDA")
        XCTAssertEqual(result["lastName"] as? String, "WILSON")
        XCTAssertEqual(result["middleName"] as? String, "MARIE")
        
        // Verify license information
        XCTAssertEqual(result["licenseNumber"] as? String, "NY123456789")
        XCTAssertEqual(result["licenseClass"] as? String, "D")
        
        // Verify address
        if let address = result["address"] as? [String: String] {
            XCTAssertEqual(address["street"], "321 PARK AVE")
            XCTAssertEqual(address["city"], "NEW YORK")
            XCTAssertEqual(address["state"], "NY")
            XCTAssertEqual(address["postalCode"], "100012345")
        } else {
            XCTFail("Address not parsed correctly")
        }
        
        // Verify New York-specific validation
        XCTAssertEqual(result["issuingState"] as? String, "NY")
        XCTAssertEqual(result["issuerIdentificationNumber"] as? String, "636042")
    }
    
    func testNewYorkLicenseNumberValidation() throws {
        let result = try AAMVAParser.parse(TestDataProvider.newYorkAAMVAData())
        
        if let licenseNumber = result["licenseNumber"] as? String {
            // New York format: 9 digits or 1 letter + 18 digits
            let nyPattern1 = "^\\d{9}$"
            let nyPattern2 = "^[A-Z]\\d{18}$"
            let nyPattern3 = "^[A-Z]*\\d{9}$"
            
            let isValid = licenseNumber.range(of: nyPattern1, options: .regularExpression) != nil ||
                         licenseNumber.range(of: nyPattern2, options: .regularExpression) != nil ||
                         licenseNumber.range(of: nyPattern3, options: .regularExpression) != nil
            
            XCTAssertTrue(isValid, "New York license number should match format: \(licenseNumber)")
        } else {
            XCTFail("License number not found")
        }
    }
    
    // MARK: - Illinois AAMVA Parsing Tests
    
    func testIllinoisAAMVAParsing() throws {
        let result = try AAMVAParser.parse(TestDataProvider.illinoisAAMVAData())
        
        // Verify basic parsing
        XCTAssertNotNil(result)
        XCTAssertEqual(result["aamvaCompliant"] as? Bool, true)
        
        // Verify personal information
        XCTAssertEqual(result["firstName"] as? String, "CHARLES")
        XCTAssertEqual(result["lastName"] as? String, "BROWN")
        XCTAssertEqual(result["middleName"] as? String, "ANTHONY")
        XCTAssertEqual(result["suffix"] as? String, "JR")
        
        // Verify license information
        XCTAssertEqual(result["licenseNumber"] as? String, "IL12345678901")
        XCTAssertEqual(result["licenseClass"] as? String, "D")
        XCTAssertEqual(result["endorsements"] as? String, "CDL-A")
        
        // Verify address
        if let address = result["address"] as? [String: String] {
            XCTAssertEqual(address["street"], "654 LAKE ST")
            XCTAssertEqual(address["city"], "CHICAGO")
            XCTAssertEqual(address["state"], "IL")
            XCTAssertEqual(address["postalCode"], "606012345")
        } else {
            XCTFail("Address not parsed correctly")
        }
        
        // Verify Illinois-specific validation
        XCTAssertEqual(result["issuingState"] as? String, "IL")
        XCTAssertEqual(result["issuerIdentificationNumber"] as? String, "636023")
    }
    
    func testIllinoisLicenseNumberValidation() throws {
        let result = try AAMVAParser.parse(TestDataProvider.illinoisAAMVAData())
        
        if let licenseNumber = result["licenseNumber"] as? String {
            // Illinois format: 1 letter + 11 digits
            let ilPattern = "^[A-Z]*\\d{11}$"
            XCTAssertTrue(licenseNumber.range(of: ilPattern, options: .regularExpression) != nil,
                         "Illinois license number should match format: \(licenseNumber)")
        } else {
            XCTFail("License number not found")
        }
    }
    
    // MARK: - Date Parsing Tests
    
    func testDateParsing() throws {
        let result = try AAMVAParser.parse(TestDataProvider.californiaAAMVAData())
        
        // Verify dates are in ISO format
        XCTAssertNotNil(result["dateOfBirth"])
        XCTAssertNotNil(result["expirationDate"])
        XCTAssertNotNil(result["issueDate"])
        
        // Verify date format (ISO 8601)
        if let dobString = result["dateOfBirth"] as? String {
            XCTAssertTrue(dobString.contains("1990-01-01"), "Date should be in ISO format")
        }
        
        if let expString = result["expirationDate"] as? String {
            XCTAssertTrue(expString.contains("2030-01-01"), "Date should be in ISO format")
        }
    }
    
    // MARK: - Physical Characteristics Tests
    
    func testPhysicalCharacteristics() throws {
        let result = try AAMVAParser.parse(TestDataProvider.californiaAAMVAData())
        
        // Verify sex/gender mapping
        XCTAssertEqual(result["sex"] as? String, "M")
        
        // Verify height formatting
        if let height = result["height"] as? String {
            XCTAssertTrue(height.contains("'") || height.contains("in"),
                         "Height should be formatted: \(height)")
        }
        
        // Verify weight formatting
        if let weight = result["weight"] as? String {
            XCTAssertTrue(weight.contains("lbs") || weight.allSatisfy { $0.isNumber },
                         "Weight should be formatted: \(weight)")
        }
        
        // Verify eye and hair color
        XCTAssertEqual(result["eyeColor"] as? String, "BRO")
        XCTAssertEqual(result["hairColor"] as? String, "BLK")
    }
    
    // MARK: - Error Handling Tests
    
    func testInvalidAAMVAData() {
        XCTAssertThrowsError(try AAMVAParser.parse("INVALID_AAMVA_DATA")) { error in
            XCTAssertTrue(error is AAMVAError)
        }
    }
    
    func testEmptyAAMVAData() {
        XCTAssertThrowsError(try AAMVAParser.parse("")) { error in
            XCTAssertTrue(error is AAMVAError)
        }
    }
    
    func testMalformedAAMVAHeader() {
        let malformedData = "@\n\u001e\rINVALID_HEADER"
        XCTAssertThrowsError(try AAMVAParser.parse(malformedData)) { error in
            XCTAssertTrue(error is AAMVAError)
            if case AAMVAError.invalidHeader(let message) = error {
                XCTAssertFalse(message.isEmpty)
            }
        }
    }
    
    func testMissingDLSubfile() {
        let noDLData = "@\n\u001e\rANSI 636014100002ZC00010008ZCTEST"
        XCTAssertThrowsError(try AAMVAParser.parse(noDLData)) { error in
            XCTAssertTrue(error is AAMVAError)
        }
    }
    
    // MARK: - Metadata Tests
    
    func testAAMVAMetadata() throws {
        let result = try AAMVAParser.parse(TestDataProvider.californiaAAMVAData())
        
        // Verify AAMVA metadata
        XCTAssertEqual(result["aamvaCompliant"] as? Bool, true)
        XCTAssertEqual(result["parsingMethod"] as? String, "AAMVA")
        XCTAssertEqual(result["aamvaVersion"] as? String, "10")
        XCTAssertNotNil(result["rawAAMVAElements"])
        
        // Verify raw AAMVA elements
        if let rawElements = result["rawAAMVAElements"] as? [String: String] {
            XCTAssertFalse(rawElements.isEmpty)
            XCTAssertNotNil(rawElements["DCS"]) // Last name
            XCTAssertNotNil(rawElements["DCT"]) // First name
            XCTAssertNotNil(rawElements["DAQ"]) // License number
        } else {
            XCTFail("Raw AAMVA elements not found")
        }
    }
    
    // MARK: - Integration with Existing Parser Tests
    
    func testAAMVAParserIntegration() throws {
        // Test that the integrated LicenseParser correctly routes to AAMVA parser
        var error: NSError?
        let result = LicenseParser.parse(TestDataProvider.californiaAAMVAData(), error: &error)
        
        XCTAssertNil(error)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?["aamvaCompliant"] as? Bool, true)
        XCTAssertEqual(result?["parsingMethod"] as? String, "AAMVA")
    }
    
    func testFallbackToLegacyParser() {
        // Test that non-AAMVA data falls back to original DLParser
        var error: NSError?
        let result = LicenseParser.parse("NON_AAMVA_BARCODE_DATA", error: &error)
        
        // Should fail gracefully without crashing
        XCTAssertNotNil(error)
        XCTAssertNil(result)
    }
    
    // MARK: - Performance Tests
    
    func testAAMVAParsingPerformance() {
        let testData = TestDataProvider.californiaAAMVAData()
        
        measure {
            for _ in 0..<100 {
                do {
                    _ = try AAMVAParser.parse(testData)
                } catch {
                    XCTFail("Performance test failed: \(error)")
                }
            }
        }
    }
    
    // MARK: - Comprehensive State Coverage Tests
    
    func testAllSupportedStates() {
        let stateTestData = [
            ("CA", TestDataProvider.californiaAAMVAData()),
            ("TX", TestDataProvider.texasAAMVAData()),
            ("FL", TestDataProvider.floridaAAMVAData()),
            ("NY", TestDataProvider.newYorkAAMVAData()),
            ("IL", TestDataProvider.illinoisAAMVAData())
        ]
        
        for (state, testData) in stateTestData {
            do {
                let result = try AAMVAParser.parse(testData)
                XCTAssertNotNil(result, "Failed to parse \(state) data")
                XCTAssertEqual(result["aamvaCompliant"] as? Bool, true, "\(state) should be AAMVA compliant")
                XCTAssertEqual(result["issuingState"] as? String, state, "\(state) issuing state mismatch")
                XCTAssertNotNil(result["licenseNumber"], "\(state) license number missing")
                XCTAssertNotNil(result["firstName"], "\(state) first name missing")
                XCTAssertNotNil(result["lastName"], "\(state) last name missing")
            } catch {
                XCTFail("Failed to parse \(state) AAMVA data: \(error)")
            }
        }
    }
}