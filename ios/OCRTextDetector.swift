import Foundation
import Vision
import CoreVideo
import UIKit
import os.log
import CoreImage

@objc public class OCRTextDetector: NSObject {
    
    // Cache the text recognition request for performance
    private lazy var textRecognitionRequest: VNRecognizeTextRequest = {
        let request = VNRecognizeTextRequest { [weak self] request, error in
            if let error = error {
                self?.lastError = error
            }
        }
        // Configure for accuracy over speed (driver's license text is critical)
        request.recognitionLevel = .accurate
        // Disable language correction to preserve license numbers and codes
        request.usesLanguageCorrection = false
        // Set recognition languages
        request.recognitionLanguages = ["en-US"]
        // Set minimum text height to filter out noise
        request.minimumTextHeight = 0.03
        
        // Configure custom words common in driver's licenses
        if #available(iOS 16.0, *) {
            request.customWords = getDriverLicenseVocabulary()
        }
        
        return request
    }()
    
    // Cache document detection request for boundary detection
    private lazy var documentDetectionRequest: VNDetectDocumentSegmentationRequest = {
        let request = VNDetectDocumentSegmentationRequest { [weak self] request, error in
            if let error = error {
                self?.lastError = error
            }
        }
        return request
    }()
    
    // Store last error for retrieval
    private var lastError: Error?
    
    // Processing queue for Vision requests
    private let processingQueue = DispatchQueue(label: "com.dlscan.ocr-processing", qos: .userInitiated)
    
    // Track if we're currently processing to avoid overlapping requests
    private var isProcessing = false
    
    @objc public override init() {
        super.init()
    }
    
    /**
     * Get custom vocabulary for driver's license text recognition
     */
    private func getDriverLicenseVocabulary() -> [String] {
        return [
            // Common headers and labels
            "DRIVER", "LICENSE", "IDENTIFICATION", "CARD",
            "NAME", "ADDRESS", "DOB", "DOB:", "EXP", "EXP:", "ISS", "ISS:",
            "CLASS", "ENDORSEMENTS", "RESTRICTIONS", "ISSUED", "EXPIRES",
            
            // Physical descriptors
            "HEIGHT", "HGT", "WEIGHT", "WGT", "EYES", "HAIR", "SEX",
            "BRN", "BLK", "BLU", "GRN", "GRY", "HAZ", // Eye colors
            "BRO", "BLN", "RED", "WHI", // Hair colors
            
            // Common US state names
            "CALIFORNIA", "TEXAS", "FLORIDA", "NEW", "YORK", "PENNSYLVANIA",
            "ILLINOIS", "OHIO", "GEORGIA", "NORTH", "CAROLINA", "MICHIGAN",
            
            // State abbreviations
            "CA", "TX", "FL", "NY", "PA", "IL", "OH", "GA", "NC", "MI",
            "NJ", "VA", "WA", "AZ", "MA", "TN", "IN", "MO", "MD", "WI",
            
            // License classes
            "REGULAR", "COMMERCIAL", "MOTORCYCLE", "CDL",
            
            // Common restrictions and endorsements
            "CORRECTIVE", "LENSES", "DAYLIGHT", "ONLY", "AUTOMATIC",
            "TRANSMISSION", "NO", "FREEWAY", "DRIVING"
        ]
    }
    
    /**
     * Process a CVPixelBuffer frame and detect text using OCR
     * Returns a dictionary containing detected text observations and document bounds if found
     */
    @objc public func detectText(in pixelBuffer: CVPixelBuffer) -> [String: Any]? {
        // Skip if already processing
        guard !isProcessing else { return nil }
        
        // Check frame quality before processing
        guard isFrameQualityAcceptableForOCR(pixelBuffer) else { return nil }
        
        isProcessing = true
        defer { isProcessing = false }
        
        // Clear previous error
        lastError = nil
        
        // Use autoreleasepool for memory management
        return autoreleasepool { () -> [String: Any]? in
            // First, detect document boundaries
            let documentBounds = detectDocumentBounds(in: pixelBuffer)
            
            // Create Vision handler
            let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
            
            do {
                // Perform text recognition
                try handler.perform([textRecognitionRequest])
                
                // Process results
                guard let results = textRecognitionRequest.results,
                      !results.isEmpty else {
                    return nil
                }
                
                // Convert text observations to a serializable format
                let textObservations = results.compactMap { observation -> [String: Any]? in
                    guard let topCandidate = observation.topCandidates(1).first else { return nil }
                    
                    return [
                        "text": topCandidate.string,
                        "confidence": topCandidate.confidence,
                        "boundingBox": [
                            "x": observation.boundingBox.origin.x,
                            "y": observation.boundingBox.origin.y,
                            "width": observation.boundingBox.width,
                            "height": observation.boundingBox.height
                        ]
                    ]
                }
                
                // Filter out low confidence results
                let highConfidenceResults = textObservations.filter { observation in
                    (observation["confidence"] as? Float ?? 0) > 0.5
                }
                
                guard !highConfidenceResults.isEmpty else {
                    return nil
                }
                
                var result: [String: Any] = [
                    "textObservations": highConfidenceResults,
                    "totalTextBlocks": highConfidenceResults.count
                ]
                
                // Add document bounds if detected
                if let bounds = documentBounds {
                    result["documentBounds"] = bounds
                }
                
                return result
                
            } catch {
                lastError = error
                return nil
            }
        }
    }
    
    /**
     * Detect document boundaries in the frame
     */
    private func detectDocumentBounds(in pixelBuffer: CVPixelBuffer) -> [String: Any]? {
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        
        do {
            try handler.perform([documentDetectionRequest])
            
            guard let results = documentDetectionRequest.results,
                  let firstResult = results.first else {
                return nil
            }
            
            // Get the document quad
            let quad = firstResult.topLeft
            
            return [
                "topLeft": ["x": firstResult.topLeft.x, "y": firstResult.topLeft.y],
                "topRight": ["x": firstResult.topRight.x, "y": firstResult.topRight.y],
                "bottomLeft": ["x": firstResult.bottomLeft.x, "y": firstResult.bottomLeft.y],
                "bottomRight": ["x": firstResult.bottomRight.x, "y": firstResult.bottomRight.y],
                "confidence": firstResult.confidence
            ]
            
        } catch {
            // Log but don't fail - document detection is optional
            os_log(.debug, log: .default, "Document detection failed: %@", error.localizedDescription)
            return nil
        }
    }
    
    /**
     * Get the last error that occurred during detection
     */
    @objc public func getLastError() -> NSError? {
        guard let error = lastError else { return nil }
        return error as NSError
    }
    
    /**
     * Check if the frame quality is acceptable for OCR processing
     * OCR has stricter requirements than barcode scanning
     */
    private func isFrameQualityAcceptableForOCR(_ pixelBuffer: CVPixelBuffer) -> Bool {
        // Get frame dimensions
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        
        // OCR needs higher resolution than barcode scanning
        guard width >= 1280 && height >= 720 else {
            os_log(.debug, log: .default, "Frame resolution too low for OCR: %dx%d", width, height)
            return false
        }
        
        // Check blur level - OCR is more sensitive to blur
        let blurLevel = calculateBlurLevel(pixelBuffer)
        guard blurLevel > 75 else { // Higher threshold for OCR
            os_log(.debug, log: .default, "Frame too blurry for OCR: blur level %.2f", blurLevel)
            return false
        }
        
        // Check brightness
        let brightness = calculateAverageBrightness(pixelBuffer)
        guard brightness > 60 && brightness < 190 else { // Tighter range for OCR
            os_log(.debug, log: .default, "Frame brightness not optimal for OCR: %.2f", brightness)
            return false
        }
        
        // Check contrast for text readability
        let contrast = calculateContrast(pixelBuffer)
        guard contrast > 40 else { // Minimum contrast for text
            os_log(.debug, log: .default, "Frame contrast too low for OCR: %.2f", contrast)
            return false
        }
        
        return true
    }
    
    /**
     * Calculate blur level using Laplacian variance
     */
    private func calculateBlurLevel(_ pixelBuffer: CVPixelBuffer) -> Double {
        // Convert to CIImage for processing
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        
        // Apply Laplacian filter
        guard let filter = CIFilter(name: "CILaplacian") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        guard let outputImage = filter.outputImage else { return 0 }
        
        // Calculate variance in multiple regions for better accuracy
        let extent = outputImage.extent
        let regions = [
            CGRect(x: extent.midX - 100, y: extent.midY - 100, width: 200, height: 200),
            CGRect(x: extent.minX + 50, y: extent.minY + 50, width: 200, height: 200),
            CGRect(x: extent.maxX - 250, y: extent.maxY - 250, width: 200, height: 200)
        ]
        
        var totalVariance = 0.0
        let context = CIContext()
        
        for region in regions {
            guard let cgImage = context.createCGImage(outputImage, from: region) else { continue }
            
            // Calculate variance for this region
            let variance = calculateVarianceForRegion(cgImage)
            totalVariance += variance
        }
        
        // Return average variance across regions
        return totalVariance / Double(regions.count)
    }
    
    /**
     * Calculate variance for a region
     */
    private func calculateVarianceForRegion(_ cgImage: CGImage) -> Double {
        guard let dataProvider = cgImage.dataProvider,
              let data = dataProvider.data else { return 0.0 }
        
        let ptr = CFDataGetBytePtr(data)
        let length = CFDataGetLength(data)
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let totalPixels = length / bytesPerPixel
        
        // Calculate mean
        var sum = 0.0
        for i in stride(from: 0, to: length, by: bytesPerPixel) {
            // Convert to grayscale using luminance formula
            let r = Double(ptr![i])
            let g = Double(ptr![i + 1])
            let b = Double(ptr![i + 2])
            let gray = 0.299 * r + 0.587 * g + 0.114 * b
            sum += gray
        }
        let mean = sum / Double(totalPixels)
        
        // Calculate variance
        var variance = 0.0
        for i in stride(from: 0, to: length, by: bytesPerPixel) {
            let r = Double(ptr![i])
            let g = Double(ptr![i + 1])
            let b = Double(ptr![i + 2])
            let gray = 0.299 * r + 0.587 * g + 0.114 * b
            let diff = gray - mean
            variance += diff * diff
        }
        
        return variance / Double(totalPixels)
    }
    
    /**
     * Calculate average brightness of the frame
     */
    private func calculateAverageBrightness(_ pixelBuffer: CVPixelBuffer) -> Double {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        
        // Use CIAreaAverage filter to get average pixel values
        guard let filter = CIFilter(name: "CIAreaAverage") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Sample from center area where license is likely to be
        let extent = ciImage.extent
        let sampleRect = CGRect(x: extent.midX - 200, y: extent.midY - 150, width: 400, height: 300)
        filter.setValue(CIVector(cgRect: sampleRect), forKey: "inputExtent")
        
        guard let outputImage = filter.outputImage else { return 0 }
        
        // Get the average color
        let context = CIContext()
        var bitmap = [UInt8](repeating: 0, count: 4)
        context.render(outputImage, toBitmap: &bitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        
        // Calculate brightness from RGB values
        let brightness = (Double(bitmap[0]) * 0.299 + Double(bitmap[1]) * 0.587 + Double(bitmap[2]) * 0.114)
        return brightness
    }
    
    /**
     * Calculate contrast of the frame
     */
    private func calculateContrast(_ pixelBuffer: CVPixelBuffer) -> Double {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        
        // Sample from center area
        let extent = ciImage.extent
        let sampleRect = CGRect(x: extent.midX - 200, y: extent.midY - 150, width: 400, height: 300)
        
        // Use area maximum and minimum filters to calculate contrast
        guard let maxFilter = CIFilter(name: "CIAreaMaximum"),
              let minFilter = CIFilter(name: "CIAreaMinimum") else { return 0 }
        
        // Configure filters
        maxFilter.setValue(ciImage, forKey: kCIInputImageKey)
        maxFilter.setValue(CIVector(cgRect: sampleRect), forKey: "inputExtent")
        
        minFilter.setValue(ciImage, forKey: kCIInputImageKey)
        minFilter.setValue(CIVector(cgRect: sampleRect), forKey: "inputExtent")
        
        guard let maxOutput = maxFilter.outputImage,
              let minOutput = minFilter.outputImage else { return 0 }
        
        // Get max and min values
        let context = CIContext()
        var maxBitmap = [UInt8](repeating: 0, count: 4)
        var minBitmap = [UInt8](repeating: 0, count: 4)
        
        context.render(maxOutput, toBitmap: &maxBitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        context.render(minOutput, toBitmap: &minBitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        
        // Calculate luminance for max and min
        let maxLuminance = Double(maxBitmap[0]) * 0.299 + Double(maxBitmap[1]) * 0.587 + Double(maxBitmap[2]) * 0.114
        let minLuminance = Double(minBitmap[0]) * 0.299 + Double(minBitmap[1]) * 0.587 + Double(minBitmap[2]) * 0.114
        
        // Calculate Michelson contrast: (Lmax - Lmin) / (Lmax + Lmin)
        let denominator = maxLuminance + minLuminance
        guard denominator > 0 else { return 0 }
        
        let contrast = ((maxLuminance - minLuminance) / denominator) * 100
        return contrast
    }
}