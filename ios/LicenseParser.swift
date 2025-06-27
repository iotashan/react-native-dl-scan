import DLParser
import Foundation

@objc class LicenseParser: NSObject {
    
    // OCR field parser for text-based extraction
    private static let ocrFieldParser = OCRFieldParser()
    @objc static func parse(_ barcodeData: String, error: NSErrorPointer) -> [String: Any]? {
        do {
            // First, try AAMVA-compliant parsing for comprehensive state support
            if AAMVAParser.isAAMVACompliant(barcodeData) {
                return try AAMVAParser.parse(barcodeData)
            }
            
            // Fallback to DLParser for non-AAMVA formats
            let licenseData = try DLParser.parse(barcodeData)
            return formatForReactNative(licenseData)
        } catch let swiftError {
            if let errorPointer = error {
                errorPointer.pointee = swiftError as NSError
            }
            return nil
        }
    }
    
    private static func formatForReactNative(_ data: LicenseData) -> [String: Any] {
        var result: [String: Any] = [:]
        
        // Personal Information
        if let firstName = data.firstName {
            result["firstName"] = firstName
        }
        if let lastName = data.lastName {
            result["lastName"] = lastName
        }
        if let middleName = data.middleName {
            result["middleName"] = middleName
        }
        
        // Dates (convert to ISO strings)
        if let dob = data.dateOfBirth {
            result["dateOfBirth"] = ISO8601DateFormatter().string(from: dob)
        }
        if let expDate = data.expirationDate {
            result["expirationDate"] = ISO8601DateFormatter().string(from: expDate)
        }
        if let issueDate = data.issueDate {
            result["issueDate"] = ISO8601DateFormatter().string(from: issueDate)
        }
        
        // Address
        var address: [String: Any] = [:]
        if let street = data.streetAddress {
            address["street"] = street
        }
        if let city = data.city {
            address["city"] = city
        }
        if let state = data.state {
            address["state"] = state
        }
        if let postalCode = data.postalCode {
            address["postalCode"] = postalCode
        }
        if !address.isEmpty {
            result["address"] = address
        }
        
        // License Information
        if let licenseNumber = data.licenseNumber {
            result["licenseNumber"] = licenseNumber
        }
        if let licenseClass = data.licenseClass {
            result["licenseClass"] = licenseClass
        }
        
        // Physical Characteristics
        if let height = data.height {
            result["height"] = height
        }
        if let weight = data.weight {
            result["weight"] = weight
        }
        if let eyeColor = data.eyeColor {
            result["eyeColor"] = eyeColor
        }
        if let hairColor = data.hairColor {
            result["hairColor"] = hairColor
        }
        
        // Gender
        if let gender = data.gender {
            result["gender"] = gender
        }
        
        // Additional fields
        if let isOrganDonor = data.isOrganDonor {
            result["isOrganDonor"] = isOrganDonor
        }
        if let isVeteran = data.isVeteran {
            result["isVeteran"] = isVeteran
        }
        
        // Restrictions and Endorsements
        if let restrictions = data.restrictions, !restrictions.isEmpty {
            result["restrictions"] = restrictions
        }
        if let endorsements = data.endorsements, !endorsements.isEmpty {
            result["endorsements"] = endorsements
        }
        
        // Jurisdictional Information
        if let issuingCountry = data.issuingCountry {
            result["issuingCountry"] = issuingCountry
        }
        if let issuingState = data.issuingState {
            result["issuingState"] = issuingState
        }
        
        // Raw Data for debugging
        result["rawData"] = data.rawData ?? ""
        
        return result
    }
    
    /**
     * Parse OCR text observations into structured license data
     * New method for OCR-based parsing following existing pattern
     */
    @objc static func parseOCR(_ textObservations: [[String: Any]], error: NSErrorPointer) -> [String: Any]? {
        return ocrFieldParser.parseOCRFields(from: textObservations, error: error)
    }
    
    /**
     * Get OCR parsing performance metrics
     */
    @objc static func getOCRParsingTime() -> TimeInterval {
        return ocrFieldParser.getLastProcessingTime()
    }
}