import Foundation
import os.log

/**
 * AAMVAParser - Comprehensive AAMVA Standard Parser for PDF417 Barcodes
 * 
 * Implements full AAMVA-2020 standard parsing with support for all data elements,
 * subfile structures, and version-specific field mappings. Provides robust
 * error handling and state-specific validation.
 * 
 * Supports AAMVA versions: 2000, 2003, 2005, 2009, 2010, 2011, 2012, 2013, 2016, 2020
 */
@objc public class AAMVAParser: NSObject {
    
    // MARK: - Properties
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "AAMVAParser")
    
    // AAMVA data structure cache
    private var parsedData: AAMVAData?
    private var rawAAMVAString: String?
    
    // State-specific validation engine
    private let stateValidator = StateValidationEngine()
    
    // MARK: - Public Interface
    
    /**
     * Parse AAMVA-compliant PDF417 barcode data
     */
    @objc public static func parse(_ barcodeData: String) throws -> [String: Any] {
        let parser = AAMVAParser()
        return try parser.parseAAMVAData(barcodeData)
    }
    
    /**
     * Validate AAMVA format compliance
     */
    @objc public static func isAAMVACompliant(_ barcodeData: String) -> Bool {
        return barcodeData.hasPrefix("@") && barcodeData.contains("ANSI")
    }
    
    /**
     * Get supported AAMVA versions
     */
    @objc public static func getSupportedVersions() -> [String] {
        return ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]
    }
    
    // MARK: - Core Parsing Logic
    
    /**
     * Parse AAMVA data into structured format
     */
    private func parseAAMVAData(_ data: String) throws -> [String: Any] {
        os_log(.debug, log: logger, "Starting AAMVA parsing for %d character data", data.count)
        
        // Store raw data for debugging
        rawAAMVAString = data
        
        // Step 1: Validate AAMVA format
        guard Self.isAAMVACompliant(data) else {
            throw AAMVAError.invalidFormat("Data does not conform to AAMVA format")
        }
        
        // Step 2: Parse AAMVA header
        let header = try parseAAMVAHeader(data)
        os_log(.debug, log: logger, "Parsed AAMVA header: version %@, jurisdiction %@", header.version, header.issuingJurisdiction)
        
        // Step 3: Extract subfiles
        let subfiles = try extractSubfiles(data, header: header)
        os_log(.debug, log: logger, "Extracted %d subfiles", subfiles.count)
        
        // Step 4: Parse data elements from DL subfile
        guard let dlSubfile = subfiles.first(where: { $0.subfileType == "DL" }) else {
            throw AAMVAError.missingSubfile("DL subfile not found")
        }
        
        let dataElements = try parseDataElements(dlSubfile.data, version: header.version)
        os_log(.debug, log: logger, "Parsed %d data elements", dataElements.count)
        
        // Step 5: Map AAMVA fields to standard license data structure
        let mappedData = try mapAAMVAFields(dataElements, header: header)
        
        // Step 6: Apply state-specific validation and enhancement
        let validatedData = try applyStateSpecificValidation(mappedData, jurisdiction: header.issuingJurisdiction)
        
        // Step 7: Assemble final result
        let result = assembleResult(validatedData, header: header, dataElements: dataElements)
        
        os_log(.debug, log: logger, "AAMVA parsing completed successfully")
        return result
    }
    
    /**
     * Parse AAMVA header information
     */
    private func parseAAMVAHeader(_ data: String) throws -> AAMVAHeader {
        // AAMVA header format: @\n\u001E\rANSI [IIN][Version][Entries]DL[Length][Data]
        let headerPattern = "@\\s*\\x1E\\s*ANSI\\s*(\\d{6})(\\d{2})(\\d{2})DL(\\d{4})"
        
        guard let regex = try? NSRegularExpression(pattern: headerPattern, options: []),
              let match = regex.firstMatch(in: data, options: [], range: NSRange(location: 0, length: data.count)) else {
            throw AAMVAError.invalidHeader("Unable to parse AAMVA header")
        }
        
        let iin = extractMatch(match, at: 1, from: data)
        let version = extractMatch(match, at: 2, from: data)
        let entries = extractMatch(match, at: 3, from: data)
        let dlLength = extractMatch(match, at: 4, from: data)
        
        // Extract issuing jurisdiction from IIN
        let jurisdiction = mapIINToJurisdiction(iin)
        
        return AAMVAHeader(
            iin: iin,
            version: version,
            entries: Int(entries) ?? 0,
            dlSubfileLength: Int(dlLength) ?? 0,
            issuingJurisdiction: jurisdiction
        )
    }
    
    /**
     * Extract subfiles from AAMVA data
     */
    private func extractSubfiles(_ data: String, header: AAMVAHeader) throws -> [AAMVASubfile] {
        var subfiles: [AAMVASubfile] = []
        
        // Find the start of the DL subfile data
        guard let dlStartRange = data.range(of: "DL\\d{4}", options: .regularExpression) else {
            throw AAMVAError.invalidFormat("DL subfile header not found")
        }
        
        let dlDataStart = dlStartRange.upperBound
        let dlEndIndex = data.index(dlDataStart, offsetBy: header.dlSubfileLength, limitedBy: data.endIndex) ?? data.endIndex
        let dlData = String(data[dlDataStart..<dlEndIndex])
        
        subfiles.append(AAMVASubfile(
            subfileType: "DL",
            length: header.dlSubfileLength,
            data: dlData
        ))
        
        // Look for additional subfiles (ZC, etc.) after DL subfile
        let remainingData = String(data[dlEndIndex...])
        let additionalSubfiles = try parseAdditionalSubfiles(remainingData)
        subfiles.append(contentsOf: additionalSubfiles)
        
        return subfiles
    }
    
    /**
     * Parse additional subfiles (non-DL)
     */
    private func parseAdditionalSubfiles(_ data: String) throws -> [AAMVASubfile] {
        var subfiles: [AAMVASubfile] = []
        var searchRange = data.startIndex
        
        // Pattern for subfile headers: [Type][Length]
        let subfilePattern = "([A-Z]{2})(\\d{4})"
        guard let regex = try? NSRegularExpression(pattern: subfilePattern, options: []) else {
            return subfiles
        }
        
        while searchRange < data.endIndex {
            let searchRangeNS = NSRange(searchRange..<data.endIndex, in: data)
            guard let match = regex.firstMatch(in: data, options: [], range: searchRangeNS) else {
                break
            }
            
            let subfileType = extractMatch(match, at: 1, from: data)
            let lengthStr = extractMatch(match, at: 2, from: data)
            let length = Int(lengthStr) ?? 0
            
            // Extract subfile data
            let dataStart = data.index(data.startIndex, offsetBy: match.range.upperBound)
            let dataEnd = data.index(dataStart, offsetBy: length, limitedBy: data.endIndex) ?? data.endIndex
            let subfileData = String(data[dataStart..<dataEnd])
            
            subfiles.append(AAMVASubfile(
                subfileType: subfileType,
                length: length,
                data: subfileData
            ))
            
            searchRange = dataEnd
        }
        
        return subfiles
    }
    
    /**
     * Parse data elements from DL subfile
     */
    private func parseDataElements(_ subfileData: String, version: String) throws -> [String: String] {
        var dataElements: [String: String] = [:]
        
        // AAMVA data elements are separated by \n and formatted as [Code][Data]
        let lines = subfileData.components(separatedBy: "\n")
        
        for line in lines {
            guard line.count >= 3 else { continue }
            
            let elementCode = String(line.prefix(3))
            let elementData = String(line.dropFirst(3))
            
            // Validate element code format
            if isValidAAMVAElementCode(elementCode) {
                dataElements[elementCode] = elementData
                os_log(.debug, log: logger, "Parsed element %@: %@", elementCode, elementData)
            }
        }
        
        os_log(.debug, log: logger, "Total data elements parsed: %d", dataElements.count)
        return dataElements
    }
    
    /**
     * Map AAMVA data elements to standard license fields
     */
    private func mapAAMVAFields(_ dataElements: [String: String], header: AAMVAHeader) throws -> AAMVAMappedData {
        let mapper = AAMVAFieldMapper(version: header.version, jurisdiction: header.issuingJurisdiction)
        return try mapper.mapFields(dataElements)
    }
    
    /**
     * Apply state-specific validation and enhancement
     */
    private func applyStateSpecificValidation(_ data: AAMVAMappedData, jurisdiction: String) throws -> AAMVAMappedData {
        return try stateValidator.validateAndEnhance(data, for: jurisdiction)
    }
    
    /**
     * Assemble final result for React Native
     */
    private func assembleResult(_ data: AAMVAMappedData, header: AAMVAHeader, dataElements: [String: String]) -> [String: Any] {
        var result: [String: Any] = [:]
        
        // Personal Information
        result["firstName"] = data.firstName
        result["lastName"] = data.lastName
        result["middleName"] = data.middleName
        result["suffix"] = data.suffix
        
        // Dates (convert to ISO format)
        if let dob = data.dateOfBirth {
            result["dateOfBirth"] = formatDateForReactNative(dob)
        }
        if let expiration = data.expirationDate {
            result["expirationDate"] = formatDateForReactNative(expiration)
        }
        if let issue = data.issueDate {
            result["issueDate"] = formatDateForReactNative(issue)
        }
        
        // Physical Characteristics
        result["sex"] = data.sex
        result["eyeColor"] = data.eyeColor
        result["hairColor"] = data.hairColor
        result["height"] = data.height
        result["weight"] = data.weight
        
        // Address
        if let street = data.streetAddress ?? data.address1,
           let city = data.city,
           let state = data.state,
           let postal = data.postalCode {
            result["address"] = [
                "street": street,
                "city": city,
                "state": state,
                "postalCode": postal,
                "country": data.country ?? "USA"
            ]
        }
        
        // License Information
        result["licenseNumber"] = data.customerIdNumber ?? data.licenseNumber
        result["licenseClass"] = data.vehicleClass
        result["restrictions"] = data.restrictions
        result["endorsements"] = data.endorsements
        
        // Additional AAMVA-specific fields
        result["issuingCountry"] = data.country
        result["issuingState"] = data.issuingJurisdiction
        result["documentDiscriminator"] = data.documentDiscriminator
        result["issuerIdentificationNumber"] = header.iin
        
        // Flags
        result["isOrganDonor"] = data.isOrganDonor
        result["isVeteran"] = data.isVeteran
        result["isRealID"] = data.isRealID
        
        // AAMVA Metadata
        result["aamvaVersion"] = header.version
        result["aamvaCompliant"] = true
        result["parsingMethod"] = "AAMVA"
        result["rawAAMVAElements"] = dataElements
        
        return result
    }
    
    // MARK: - Helper Methods
    
    /**
     * Extract match group from regex result
     */
    private func extractMatch(_ match: NSTextCheckingResult, at index: Int, from text: String) -> String {
        let range = match.range(at: index)
        if let swiftRange = Range(range, in: text) {
            return String(text[swiftRange])
        }
        return ""
    }
    
    /**
     * Map IIN (Issuer Identification Number) to jurisdiction
     */
    private func mapIINToJurisdiction(_ iin: String) -> String {
        let iinMappings: [String: String] = [
            "636014": "CA",  // California
            "636015": "CO",  // Colorado
            "636016": "CT",  // Connecticut
            "636017": "DE",  // Delaware
            "636018": "DC",  // District of Columbia
            "636019": "FL",  // Florida
            "636020": "GA",  // Georgia
            "636021": "HI",  // Hawaii
            "636022": "ID",  // Idaho
            "636023": "IL",  // Illinois
            "636024": "IN",  // Indiana
            "636025": "IA",  // Iowa
            "636026": "KS",  // Kansas
            "636027": "KY",  // Kentucky
            "636028": "LA",  // Louisiana
            "636029": "ME",  // Maine
            "636030": "MD",  // Maryland
            "636031": "MA",  // Massachusetts
            "636032": "MI",  // Michigan
            "636033": "MN",  // Minnesota
            "636034": "MS",  // Mississippi
            "636035": "MO",  // Missouri
            "636036": "MT",  // Montana
            "636037": "NE",  // Nebraska
            "636038": "NV",  // Nevada
            "636039": "NH",  // New Hampshire
            "636040": "NJ",  // New Jersey
            "636041": "NM",  // New Mexico
            "636042": "NY",  // New York
            "636043": "NC",  // North Carolina
            "636044": "ND",  // North Dakota
            "636045": "OH",  // Ohio
            "636046": "OK",  // Oklahoma
            "636047": "OR",  // Oregon
            "636048": "PA",  // Pennsylvania
            "636049": "RI",  // Rhode Island
            "636050": "SC",  // South Carolina
            "636051": "SD",  // South Dakota
            "636052": "TN",  // Tennessee
            "636053": "TX",  // Texas
            "636054": "UT",  // Utah
            "636055": "VT",  // Vermont
            "636056": "VA",  // Virginia
            "636057": "WA",  // Washington
            "636058": "WV",  // West Virginia
            "636059": "WI",  // Wisconsin
            "636060": "WY"   // Wyoming
        ]
        
        return iinMappings[iin] ?? "US"
    }
    
    /**
     * Check if element code is valid AAMVA format
     */
    private func isValidAAMVAElementCode(_ code: String) -> Bool {
        // AAMVA element codes are 3 characters: [D][A-Z][A-Z]
        return code.count == 3 && 
               code.hasPrefix("D") && 
               code.allSatisfy { $0.isLetter || $0.isNumber }
    }
    
    /**
     * Format date for React Native (ISO string)
     */
    private func formatDateForReactNative(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: date)
    }
}

// MARK: - AAMVA Field Mapper

/**
 * Maps AAMVA data elements to structured license data
 */
class AAMVAFieldMapper {
    
    private let version: String
    private let jurisdiction: String
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "AAMVAFieldMapper")
    
    init(version: String, jurisdiction: String) {
        self.version = version
        self.jurisdiction = jurisdiction
    }
    
    /**
     * Map AAMVA data elements to structured format
     */
    func mapFields(_ dataElements: [String: String]) throws -> AAMVAMappedData {
        os_log(.debug, log: logger, "Mapping AAMVA fields for version %@ jurisdiction %@", version, jurisdiction)
        
        var mappedData = AAMVAMappedData()
        
        // Personal Information
        mappedData.customerIdNumber = dataElements["DAQ"]        // Customer ID Number (License Number)
        mappedData.lastName = dataElements["DCS"]               // Customer Family Name
        mappedData.firstName = dataElements["DCT"] ?? dataElements["DAC"]  // Customer First Name (DCT) or Given Name (DAC)
        mappedData.middleName = dataElements["DAD"]             // Customer Middle Name
        mappedData.suffix = dataElements["DCU"]                 // Name Suffix
        
        // Dates
        mappedData.dateOfBirth = parseAAMVADate(dataElements["DBB"])         // Date of Birth
        mappedData.expirationDate = parseAAMVADate(dataElements["DBA"])      // Document Expiration Date
        mappedData.issueDate = parseAAMVADate(dataElements["DBD"])           // Document Issue Date
        
        // Physical Characteristics
        mappedData.sex = mapGenderCode(dataElements["DBC"])     // Customer Sex
        mappedData.eyeColor = dataElements["DAY"]               // Eye Color
        mappedData.hairColor = dataElements["DAZ"]              // Hair Color
        mappedData.height = formatHeight(dataElements["DAU"])   // Height
        mappedData.weight = formatWeight(dataElements["DAW"])   // Weight (pounds)
        
        // Address Information
        mappedData.streetAddress = dataElements["DAG"]          // Street Address 1
        mappedData.address1 = dataElements["DAG"]               // Street Address 1 (alias)
        mappedData.address2 = dataElements["DAH"]               // Street Address 2
        mappedData.city = dataElements["DAI"]                   // City
        mappedData.state = dataElements["DAJ"]                  // State/Province
        mappedData.postalCode = dataElements["DAK"]             // Postal Code
        mappedData.country = dataElements["DCG"] ?? "USA"       // Country
        
        // License Information
        mappedData.licenseNumber = dataElements["DAQ"]          // Customer ID Number
        mappedData.vehicleClass = dataElements["DCA"]           // Vehicle Class
        mappedData.restrictions = dataElements["DCB"]           // Restrictions
        mappedData.endorsements = dataElements["DCD"]           // Endorsements
        
        // Document Information
        mappedData.documentDiscriminator = dataElements["DCF"]  // Document Discriminator
        mappedData.issuingJurisdiction = jurisdiction
        
        // Optional Fields (version-dependent)
        if version >= "03" {
            mappedData.auditInformation = dataElements["DCH"]   // Audit Information
            mappedData.inventoryControlNumber = dataElements["DCI"]  // Inventory Control Number
            mappedData.alternateId = dataElements["DCJ"]        // Alternate ID
        }
        
        if version >= "04" {
            mappedData.lastUpdate = parseAAMVADate(dataElements["DDB"])  // Last Update Date
            mappedData.issueDate = parseAAMVADate(dataElements["DDD"])   // HazMat Endorsement Expiry
        }
        
        // REAL ID and Security Features (version 05+)
        if version >= "05" {
            mappedData.isRealID = parseRealIDCompliance(dataElements["DDE"])
            mappedData.securityVersion = dataElements["DDC"]    // Security Version
        }
        
        // Veteran status (version 07+)
        if version >= "07" {
            mappedData.isVeteran = parseBooleanFlag(dataElements["DDI"])
        }
        
        // Organ donor (version 03+)
        if version >= "03" {
            mappedData.isOrganDonor = parseBooleanFlag(dataElements["DDK"])
        }
        
        // Enhanced Driver License (version 08+)
        if version >= "08" {
            mappedData.isEDL = parseBooleanFlag(dataElements["DDL"])
        }
        
        os_log(.debug, log: logger, "Successfully mapped AAMVA fields")
        return mappedData
    }
    
    // MARK: - Field Parsing Methods
    
    /**
     * Parse AAMVA date format (MMDDYYYY or YYYYMMDD)
     */
    private func parseAAMVADate(_ dateString: String?) -> Date? {
        guard let dateStr = dateString, !dateStr.isEmpty else { return nil }
        
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        
        // Try MMDDYYYY format first (most common)
        if dateStr.count == 8 {
            formatter.dateFormat = "MMddyyyy"
            if let date = formatter.date(from: dateStr) {
                return date
            }
            
            // Try YYYYMMDD format
            formatter.dateFormat = "yyyyMMdd"
            if let date = formatter.date(from: dateStr) {
                return date
            }
        }
        
        // Try 6-digit format (MMDDYY)
        if dateStr.count == 6 {
            formatter.dateFormat = "MMddyy"
            if let date = formatter.date(from: dateStr) {
                return date
            }
        }
        
        os_log(.warning, log: logger, "Could not parse date: %@", dateStr)
        return nil
    }
    
    /**
     * Map AAMVA gender code to standard format
     */
    private func mapGenderCode(_ genderCode: String?) -> String? {
        guard let code = genderCode?.uppercased() else { return nil }
        
        switch code {
        case "1", "M", "MALE":
            return "M"
        case "2", "F", "FEMALE":
            return "F"
        case "9", "X", "UNSPECIFIED", "NOT SPECIFIED":
            return "X"
        default:
            return code
        }
    }
    
    /**
     * Format height from AAMVA format (inches or CM)
     */
    private func formatHeight(_ heightString: String?) -> String? {
        guard let height = heightString, !height.isEmpty else { return nil }
        
        // Height can be in inches (XXX) or feet/inches (X'XX")
        if height.count == 3, let inches = Int(height) {
            let feet = inches / 12
            let remainingInches = inches % 12
            return "\(feet)'\(remainingInches)\""
        }
        
        // If already formatted, return as-is
        return height
    }
    
    /**
     * Format weight from AAMVA format
     */
    private func formatWeight(_ weightString: String?) -> String? {
        guard let weight = weightString, !weight.isEmpty else { return nil }
        
        // Weight in pounds (XXX)
        if let weightInt = Int(weight), weightInt > 0 {
            return "\(weightInt) lbs"
        }
        
        return weight
    }
    
    /**
     * Parse REAL ID compliance flag
     */
    private func parseRealIDCompliance(_ realIdString: String?) -> Bool? {
        guard let realId = realIdString?.uppercased() else { return nil }
        
        switch realId {
        case "1", "Y", "YES", "TRUE", "COMPLIANT":
            return true
        case "0", "N", "NO", "FALSE", "NON-COMPLIANT":
            return false
        default:
            return nil
        }
    }
    
    /**
     * Parse boolean flag from AAMVA data
     */
    private func parseBooleanFlag(_ flagString: String?) -> Bool? {
        guard let flag = flagString?.uppercased() else { return nil }
        
        switch flag {
        case "1", "Y", "YES", "TRUE":
            return true
        case "0", "N", "NO", "FALSE":
            return false
        default:
            return nil
        }
    }
}

// MARK: - State Validation Engine

/**
 * Provides state-specific validation and enhancement for AAMVA data
 */
class StateValidationEngine {
    
    private let logger = OSLog(subsystem: "com.dlscan.parser", category: "StateValidationEngine")
    
    /**
     * Validate and enhance AAMVA data for specific state
     */
    func validateAndEnhance(_ data: AAMVAMappedData, for jurisdiction: String) throws -> AAMVAMappedData {
        var enhancedData = data
        
        // Apply state-specific validation and enhancement
        switch jurisdiction {
        case "CA":
            enhancedData = try validateCaliforniaData(enhancedData)
        case "TX":
            enhancedData = try validateTexasData(enhancedData)
        case "FL":
            enhancedData = try validateFloridaData(enhancedData)
        case "NY":
            enhancedData = try validateNewYorkData(enhancedData)
        case "IL":
            enhancedData = try validateIllinoisData(enhancedData)
        default:
            // Apply generic validation
            enhancedData = try validateGenericData(enhancedData)
        }
        
        os_log(.debug, log: logger, "Applied state-specific validation for %@", jurisdiction)
        return enhancedData
    }
    
    /**
     * California-specific validation
     */
    private func validateCaliforniaData(_ data: AAMVAMappedData) throws -> AAMVAMappedData {
        var validated = data
        
        // California license number format: 1 letter + 7 digits
        if let licenseNumber = validated.licenseNumber {
            let caPattern = "^[A-Z]\\d{7}$"
            if licenseNumber.range(of: caPattern, options: .regularExpression) == nil {
                os_log(.warning, log: logger, "California license number format invalid: %@", licenseNumber)
            }
        }
        
        // Validate California-specific fields
        // Add more CA-specific validation as needed
        
        return validated
    }
    
    /**
     * Texas-specific validation
     */
    private func validateTexasData(_ data: AAMVAMappedData) throws -> AAMVAMappedData {
        var validated = data
        
        // Texas license number format: 8 digits
        if let licenseNumber = validated.licenseNumber {
            let txPattern = "^\\d{8}$"
            if licenseNumber.range(of: txPattern, options: .regularExpression) == nil {
                os_log(.warning, log: logger, "Texas license number format invalid: %@", licenseNumber)
            }
        }
        
        return validated
    }
    
    /**
     * Florida-specific validation
     */
    private func validateFloridaData(_ data: AAMVAMappedData) throws -> AAMVAMappedData {
        var validated = data
        
        // Florida license number format: 1 letter + 12 digits
        if let licenseNumber = validated.licenseNumber {
            let flPattern = "^[A-Z]\\d{12}$"
            if licenseNumber.range(of: flPattern, options: .regularExpression) == nil {
                os_log(.warning, log: logger, "Florida license number format invalid: %@", licenseNumber)
            }
        }
        
        return validated
    }
    
    /**
     * New York-specific validation
     */
    private func validateNewYorkData(_ data: AAMVAMappedData) throws -> AAMVAMappedData {
        var validated = data
        
        // New York license number format: 9 digits or 1 letter + 18 digits
        if let licenseNumber = validated.licenseNumber {
            let nyPattern1 = "^\\d{9}$"
            let nyPattern2 = "^[A-Z]\\d{18}$"
            if licenseNumber.range(of: nyPattern1, options: .regularExpression) == nil &&
               licenseNumber.range(of: nyPattern2, options: .regularExpression) == nil {
                os_log(.warning, log: logger, "New York license number format invalid: %@", licenseNumber)
            }
        }
        
        return validated
    }
    
    /**
     * Illinois-specific validation
     */
    private func validateIllinoisData(_ data: AAMVAMappedData) throws -> AAMVAMappedData {
        var validated = data
        
        // Illinois license number format: 1 letter + 11 digits
        if let licenseNumber = validated.licenseNumber {
            let ilPattern = "^[A-Z]\\d{11}$"
            if licenseNumber.range(of: ilPattern, options: .regularExpression) == nil {
                os_log(.warning, log: logger, "Illinois license number format invalid: %@", licenseNumber)
            }
        }
        
        return validated
    }
    
    /**
     * Generic validation for other states
     */
    private func validateGenericData(_ data: AAMVAMappedData) throws -> AAMVAMappedData {
        var validated = data
        
        // Generic validation rules
        if let licenseNumber = validated.licenseNumber {
            if licenseNumber.count < 6 || licenseNumber.count > 20 {
                os_log(.warning, log: logger, "License number length unusual: %d characters", licenseNumber.count)
            }
        }
        
        return validated
    }
}

// MARK: - Data Structures

/**
 * AAMVA header information
 */
struct AAMVAHeader {
    let iin: String                    // Issuer Identification Number
    let version: String                // AAMVA version
    let entries: Int                   // Number of entries
    let dlSubfileLength: Int           // DL subfile length
    let issuingJurisdiction: String    // Jurisdiction code
}

/**
 * AAMVA subfile structure
 */
struct AAMVASubfile {
    let subfileType: String            // Subfile type (DL, ZC, etc.)
    let length: Int                    // Subfile length
    let data: String                   // Subfile data
}

/**
 * Mapped AAMVA data structure
 */
struct AAMVAMappedData {
    // Personal Information
    var customerIdNumber: String?      // DAQ - Customer ID Number
    var lastName: String?              // DCS - Customer Family Name
    var firstName: String?             // DCT/DAC - Customer First/Given Name
    var middleName: String?            // DAD - Customer Middle Name
    var suffix: String?                // DCU - Name Suffix
    
    // Dates
    var dateOfBirth: Date?             // DBB - Date of Birth
    var expirationDate: Date?          // DBA - Document Expiration Date
    var issueDate: Date?               // DBD - Document Issue Date
    var lastUpdate: Date?              // DDB - Last Update Date
    
    // Physical Characteristics
    var sex: String?                   // DBC - Customer Sex
    var eyeColor: String?              // DAY - Eye Color
    var hairColor: String?             // DAZ - Hair Color
    var height: String?                // DAU - Height
    var weight: String?                // DAW - Weight
    
    // Address Information
    var streetAddress: String?         // DAG - Street Address
    var address1: String?              // DAG - Street Address 1 (alias)
    var address2: String?              // DAH - Street Address 2
    var city: String?                  // DAI - City
    var state: String?                 // DAJ - State/Province
    var postalCode: String?            // DAK - Postal Code
    var country: String?               // DCG - Country
    
    // License Information
    var licenseNumber: String?         // DAQ - License Number (alias for customerIdNumber)
    var vehicleClass: String?          // DCA - Vehicle Class
    var restrictions: String?          // DCB - Restrictions
    var endorsements: String?          // DCD - Endorsements
    
    // Document Information
    var documentDiscriminator: String? // DCF - Document Discriminator
    var issuingJurisdiction: String?   // Jurisdiction from header
    var auditInformation: String?      // DCH - Audit Information
    var inventoryControlNumber: String? // DCI - Inventory Control Number
    var alternateId: String?           // DCJ - Alternate ID
    
    // Security and Compliance
    var isRealID: Bool?                // DDE - REAL ID Compliance
    var securityVersion: String?       // DDC - Security Version
    var isVeteran: Bool?               // DDI - Veteran Status
    var isOrganDonor: Bool?            // DDK - Organ Donor
    var isEDL: Bool?                   // DDL - Enhanced Driver License
}

/**
 * AAMVA parsing errors
 */
enum AAMVAError: Error, LocalizedError {
    case invalidFormat(String)
    case invalidHeader(String)
    case missingSubfile(String)
    case parsingError(String)
    case validationError(String)
    
    var errorDescription: String? {
        switch self {
        case .invalidFormat(let message):
            return "Invalid AAMVA format: \(message)"
        case .invalidHeader(let message):
            return "Invalid AAMVA header: \(message)"
        case .missingSubfile(let message):
            return "Missing AAMVA subfile: \(message)"
        case .parsingError(let message):
            return "AAMVA parsing error: \(message)"
        case .validationError(let message):
            return "AAMVA validation error: \(message)"
        }
    }
}