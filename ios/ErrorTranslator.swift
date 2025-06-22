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
    // OCR-specific error codes
    case ocrFailed = "OCR_FAILED"
    case ocrNoTextDetected = "OCR_NO_TEXT_DETECTED"
    case ocrLowConfidence = "OCR_LOW_CONFIDENCE"
    case ocrDocumentNotFound = "OCR_DOCUMENT_NOT_FOUND"
    case ocrProcessingTimeout = "OCR_PROCESSING_TIMEOUT"
    case ocrInsufficientQuality = "OCR_INSUFFICIENT_QUALITY"
    case ocrPartialExtraction = "OCR_PARTIAL_EXTRACTION"
    // Document detection specific error codes
    case documentDetectionFailed = "DOCUMENT_DETECTION_FAILED"
    case documentBoundariesInvalid = "DOCUMENT_BOUNDARIES_INVALID"
    case documentTooSmall = "DOCUMENT_TOO_SMALL"
    case documentAspectRatioInvalid = "DOCUMENT_ASPECT_RATIO_INVALID"
    case perspectiveCorrectionFailed = "PERSPECTIVE_CORRECTION_FAILED"
    case documentLowConfidence = "DOCUMENT_LOW_CONFIDENCE"
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
    
    // MARK: - OCR-specific error methods
    
    @objc static func createOCRError(reason: String) -> [String: Any] {
        let errorCode: ScanErrorCode
        let userMessage: String
        
        switch reason {
        case "no_text":
            errorCode = .ocrNoTextDetected
            userMessage = "No text detected. Please ensure the license is clearly visible and well-lit."
            
        case "low_confidence":
            errorCode = .ocrLowConfidence
            userMessage = "Text recognition confidence is low. Please hold the device steady and ensure good lighting."
            
        case "document_not_found":
            errorCode = .ocrDocumentNotFound
            userMessage = "Unable to detect license boundaries. Please ensure the entire license is visible in the frame."
            
        case "insufficient_quality":
            errorCode = .ocrInsufficientQuality
            userMessage = "Image quality is insufficient for text recognition. Please improve lighting and hold steady."
            
        case "partial_extraction":
            errorCode = .ocrPartialExtraction
            userMessage = "Only partial information could be extracted. Please try scanning the barcode on the back instead."
            
        case "timeout":
            errorCode = .ocrProcessingTimeout
            userMessage = "Text recognition timed out. Please try again with better lighting conditions."
            
        default:
            errorCode = .ocrFailed
            userMessage = "Text recognition failed. Please try scanning the barcode on the back of the license."
        }
        
        return [
            "code": errorCode.rawValue,
            "message": "OCR processing error: \(reason)",
            "userMessage": userMessage,
            "recoverable": true
        ]
    }
    
    @objc static func createOCRQualityError(qualityIssues: [String: Any]) -> [String: Any] {
        var message = "Image quality issues detected:"
        var suggestions: [String] = []
        
        if let blur = qualityIssues["blur"] as? Bool, blur {
            message += " blur"
            suggestions.append("Hold the device steady")
        }
        
        if let lighting = qualityIssues["lighting"] as? String {
            if lighting == "dark" {
                message += " insufficient lighting"
                suggestions.append("Move to a well-lit area")
            } else if lighting == "bright" {
                message += " overexposure"
                suggestions.append("Avoid direct light reflection")
            }
        }
        
        if let contrast = qualityIssues["lowContrast"] as? Bool, contrast {
            message += " low contrast"
            suggestions.append("Adjust angle to reduce glare")
        }
        
        let userMessage = suggestions.joined(separator: ". ") + "."
        
        return [
            "code": ScanErrorCode.ocrInsufficientQuality.rawValue,
            "message": message,
            "userMessage": userMessage,
            "recoverable": true,
            "qualityIssues": qualityIssues
        ]
    }
    
    // MARK: - Document Detection error methods
    
    @objc static func createDocumentDetectionError(reason: String) -> [String: Any] {
        let errorCode: ScanErrorCode
        let userMessage: String
        
        switch reason {
        case "detection_failed":
            errorCode = .documentDetectionFailed
            userMessage = "Unable to detect document boundaries. Please ensure the entire license is visible and well-lit."
            
        case "boundaries_invalid":
            errorCode = .documentBoundariesInvalid
            userMessage = "Document boundaries are unclear. Please position the license flat and ensure all corners are visible."
            
        case "too_small":
            errorCode = .documentTooSmall
            userMessage = "Document appears too small in the frame. Please move closer to the license."
            
        case "aspect_ratio_invalid":
            errorCode = .documentAspectRatioInvalid
            userMessage = "Document shape doesn't match a driver's license. Please ensure the entire license is visible."
            
        case "low_confidence":
            errorCode = .documentLowConfidence
            userMessage = "Document detection confidence is low. Please improve lighting and ensure the license is flat."
            
        case "perspective_correction_failed":
            errorCode = .perspectiveCorrectionFailed
            userMessage = "Unable to correct document perspective. Please try scanning at a different angle."
            
        default:
            errorCode = .documentDetectionFailed
            userMessage = "Document detection failed. Please ensure the license is clearly visible and try again."
        }
        
        return [
            "code": errorCode.rawValue,
            "message": "Document detection error: \(reason)",
            "userMessage": userMessage,
            "recoverable": true
        ]
    }
    
    @objc static func createDocumentQualityError(qualityIssues: [String: Any]) -> [String: Any] {
        var message = "Document detection quality issues:"
        var suggestions: [String] = []
        
        if let tooSmall = qualityIssues["tooSmall"] as? Bool, tooSmall {
            message += " document too small"
            suggestions.append("Move closer to the license")
        }
        
        if let wrongAspectRatio = qualityIssues["wrongAspectRatio"] as? Bool, wrongAspectRatio {
            message += " incorrect dimensions"
            suggestions.append("Ensure entire license is visible")
        }
        
        if let boundaries = qualityIssues["invalidBoundaries"] as? Bool, boundaries {
            message += " unclear boundaries"
            suggestions.append("Position license flat with all corners visible")
        }
        
        if let lighting = qualityIssues["lighting"] as? String {
            if lighting == "dark" {
                message += " insufficient lighting"
                suggestions.append("Improve lighting conditions")
            } else if lighting == "bright" {
                message += " excessive glare"
                suggestions.append("Avoid direct light reflection")
            }
        }
        
        let userMessage = suggestions.isEmpty ? "Please try again with better conditions." : 
                         suggestions.joined(separator: ". ") + "."
        
        return [
            "code": ScanErrorCode.documentDetectionFailed.rawValue,
            "message": message,
            "userMessage": userMessage,
            "recoverable": true,
            "qualityIssues": qualityIssues
        ]
    }
}