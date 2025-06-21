import Foundation
import DLParser
import os.log

enum ScanErrorCode: String {
    case parsingFailed = "PARSING_FAILED"
    case invalidFormat = "INVALID_FORMAT"
    case unsupportedVersion = "UNSUPPORTED_VERSION"
    case corruptedData = "CORRUPTED_DATA"
    case unknownError = "UNKNOWN_ERROR"
    case visionError = "VISION_ERROR"
    case systemError = "SYSTEM_ERROR"
    case poorQualityBlur = "POOR_QUALITY_BLUR"
    case poorQualityDark = "POOR_QUALITY_DARK"
    case poorQualityBright = "POOR_QUALITY_BRIGHT"
    case poorQuality = "POOR_QUALITY"
    case detectionTimeout = "DETECTION_TIMEOUT"
    case cameraPermissionDenied = "CAMERA_PERMISSION_DENIED"
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
        } else if let nsError = error as NSError? {
            // Handle Vision Framework errors
            if nsError.domain == "com.apple.Vision" {
                errorCode = .visionError
                userMessage = "Camera processing error. Please ensure good lighting and try again."
                recoverable = true
            } else if nsError.domain == NSCocoaErrorDomain {
                errorCode = .systemError
                userMessage = "A system error occurred. Please restart the app and try again."
                recoverable = false
            } else {
                errorCode = .unknownError
                userMessage = "An unexpected error occurred. Please try again."
                recoverable = true
            }
            
            // Log error for debugging (without sensitive data)
            os_log(.error, log: .default, "DLScan Error - Domain: %@, Code: %ld", nsError.domain, nsError.code)
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
    
    @objc static func createQualityError(reason: String) -> [String: Any] {
        let errorCode: ScanErrorCode
        let userMessage: String
        
        switch reason {
        case "blur":
            errorCode = .poorQualityBlur
            userMessage = "Please hold the device steady and ensure the barcode is in focus."
            
        case "dark":
            errorCode = .poorQualityDark
            userMessage = "Please move to a well-lit area or enable the flashlight."
            
        case "bright":
            errorCode = .poorQualityBright
            userMessage = "Please reduce lighting or move away from direct light sources."
            
        default:
            errorCode = .poorQuality
            userMessage = "Please ensure good lighting and hold the device steady."
        }
        
        return [
            "code": errorCode.rawValue,
            "message": "Frame quality is insufficient: \(reason)",
            "userMessage": userMessage,
            "recoverable": true
        ]
    }
    
    @objc static func createTimeoutError() -> [String: Any] {
        return [
            "code": ScanErrorCode.detectionTimeout.rawValue,
            "message": "Barcode detection timed out",
            "userMessage": "Unable to detect barcode. Please ensure the entire barcode is visible within the frame.",
            "recoverable": true
        ]
    }
    
    @objc static func createPermissionError() -> [String: Any] {
        return [
            "code": ScanErrorCode.cameraPermissionDenied.rawValue,
            "message": "Camera permission not granted",
            "userMessage": "Camera access is required to scan licenses. Please enable camera permissions in Settings.",
            "recoverable": false
        ]
    }
}