import Foundation
import Vision
import CoreVideo
import UIKit

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
        guard width >= 640 && height >= 480 else { return false }
        
        // Additional quality checks could be added here:
        // - Blur detection using Laplacian variance
        // - Brightness/contrast analysis
        // - Motion blur detection
        
        return true
    }
    
    /**
     * Calculate blur level using Laplacian variance (for future enhancement)
     */
    private func calculateBlurLevel(_ pixelBuffer: CVPixelBuffer) -> Double {
        // This is a placeholder for blur detection
        // In a full implementation, we'd convert to grayscale
        // and calculate Laplacian variance
        return 1.0
    }
}