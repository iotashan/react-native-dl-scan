import Foundation
import Vision
import CoreVideo
import UIKit
import os.log
import CoreImage

@objc public class PDF417Detector: NSObject {
    
    // Cache the barcode request for performance
    private lazy var barcodeRequest: VNDetectBarcodesRequest = {
        let request = VNDetectBarcodesRequest { [weak self] request, error in
            if let error = error {
                self?.lastError = error
            }
        }
        // Only detect PDF417 barcodes
        request.symbologies = [.PDF417]
        return request
    }()
    
    // Store last error for retrieval
    private var lastError: Error?
    
    // Processing queue for Vision requests
    private let processingQueue = DispatchQueue(label: "com.dlscan.pdf417-processing", qos: .userInitiated)
    
    // Track if we're currently processing to avoid overlapping requests
    private var isProcessing = false
    
    @objc public override init() {
        super.init()
    }
    
    /**
     * Process a CVPixelBuffer frame and detect PDF417 barcodes
     * Returns the barcode data string if found, nil otherwise
     */
    @objc public func detectPDF417(in pixelBuffer: CVPixelBuffer) -> String? {
        // Skip if already processing
        guard !isProcessing else { return nil }
        
        // Check frame quality before processing
        guard isFrameQualityAcceptable(pixelBuffer) else { return nil }
        
        isProcessing = true
        defer { isProcessing = false }
        
        // Clear previous error
        lastError = nil
        
        // Create Vision handler
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        
        do {
            // Perform barcode detection
            try handler.perform([barcodeRequest])
            
            // Process results
            guard let results = barcodeRequest.results,
                  !results.isEmpty,
                  let firstBarcode = results.first,
                  let payloadString = firstBarcode.payloadStringValue else {
                return nil
            }
            
            // Verify it's a valid PDF417 barcode
            guard firstBarcode.symbology == .PDF417 else {
                return nil
            }
            
            // Check confidence threshold
            guard firstBarcode.confidence > 0.7 else {
                return nil
            }
            
            return payloadString
            
        } catch {
            lastError = error
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
     * Check if the frame quality is acceptable for processing
     */
    private func isFrameQualityAcceptable(_ pixelBuffer: CVPixelBuffer) -> Bool {
        // Get frame dimensions
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        
        // Skip frames that are too small
        guard width >= 640 && height >= 480 else { 
            os_log(.debug, log: .default, "Frame too small: %dx%d", width, height)
            return false 
        }
        
        // Check blur level
        let blurLevel = calculateBlurLevel(pixelBuffer)
        guard blurLevel > 50 else { // Threshold for blur detection
            os_log(.debug, log: .default, "Frame too blurry: blur level %.2f", blurLevel)
            return false
        }
        
        // Check brightness
        let brightness = calculateAverageBrightness(pixelBuffer)
        guard brightness > 50 && brightness < 200 else { // Avoid too dark or overexposed
            os_log(.debug, log: .default, "Frame brightness out of range: %.2f", brightness)
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
        
        // Calculate variance (simplified - in production would sample more areas)
        let extent = outputImage.extent
        let sampleRect = CGRect(x: extent.midX - 50, y: extent.midY - 50, width: 100, height: 100)
        
        // Create context for pixel analysis
        let context = CIContext()
        guard let cgImage = context.createCGImage(outputImage, from: sampleRect) else { return 0 }
        
        // Simple variance calculation
        // Higher variance = sharper image
        return 100.0 // Placeholder - would calculate actual variance
    }
    
    /**
     * Calculate average brightness of the frame
     */
    private func calculateAverageBrightness(_ pixelBuffer: CVPixelBuffer) -> Double {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        
        // Use CIAreaAverage filter to get average pixel values
        guard let filter = CIFilter(name: "CIAreaAverage") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Sample from center area
        let extent = ciImage.extent
        let sampleRect = CGRect(x: extent.midX - 100, y: extent.midY - 100, width: 200, height: 200)
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
}