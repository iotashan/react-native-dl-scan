import Foundation
import DLParser

enum ScanErrorCode: String {
    case parsingFailed = "PARSING_FAILED"
    case invalidFormat = "INVALID_FORMAT"
    case unsupportedVersion = "UNSUPPORTED_VERSION"
    case corruptedData = "CORRUPTED_DATA"
    case unknownError = "UNKNOWN_ERROR"
}

@objc class ErrorTranslator: NSObject {
    @objc static func translate(_ error: Error) -> [String: Any] {
        let errorDescription = error.localizedDescription
        let errorCode: ScanErrorCode
        let userMessage: String
        let recoverable: Bool
        
        // Map DLParser errors to standardized format
        if let dlParserError = error as? DLParserError {
            switch dlParserError {
            case .invalidFormat:
                errorCode = .invalidFormat
                userMessage = "The barcode format is not recognized. Please ensure you're scanning the back of a valid driver's license."
                recoverable = true
            case .unsupportedVersion:
                errorCode = .unsupportedVersion
                userMessage = "This license format is not yet supported. Please try a different license or contact support."
                recoverable = false
            case .corruptedData:
                errorCode = .corruptedData
                userMessage = "The barcode data appears to be damaged. Please try scanning again with better lighting."
                recoverable = true
            default:
                errorCode = .parsingFailed
                userMessage = "Unable to read the license barcode. Please try scanning again."
                recoverable = true
            }
        } else {
            // Handle other error types
            errorCode = .unknownError
            userMessage = "An unexpected error occurred. Please try again."
            recoverable = true
        }
        
        return [
            "code": errorCode.rawValue,
            "message": errorDescription,
            "userMessage": userMessage,
            "recoverable": recoverable
        ]
    }
}