import Foundation
import Vision
import CoreVideo
import UIKit
import os.log
import CoreImage

@objc public class DocumentDetector: NSObject {
    
    // Cache the document detection request for performance
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
    private let processingQueue = DispatchQueue(label: "com.dlscan.document-processing", qos: .userInitiated)
    
    // Track if we're currently processing to avoid overlapping requests
    private var isProcessing = false
    
    // Performance metrics tracking
    private var lastProcessingTime: TimeInterval = 0
    
    // Core Image context for perspective correction
    private let ciContext = CIContext(options: [
        .cacheIntermediates: false,
        .highQualityDownsample: false
    ])
    
    // CVPixelBuffer pool for memory optimization
    private var pixelBufferPool: CVPixelBufferPool?
    private let pixelBufferPoolLock = NSLock()
    
    @objc public override init() {
        super.init()
    }
    
    /**
     * Process a CVPixelBuffer frame and detect document boundaries
     * Returns a dictionary containing detected boundaries and confidence if found
     */
    @objc public func detectDocument(in pixelBuffer: CVPixelBuffer) -> [String: Any]? {
        // Skip if already processing
        guard !isProcessing else { return nil }
        
        // Check frame quality before processing
        guard isFrameQualityAcceptableForDetection(pixelBuffer) else { return nil }
        
        isProcessing = true
        defer { isProcessing = false }
        
        // Track processing time
        let startTime = CFAbsoluteTimeGetCurrent()
        defer {
            lastProcessingTime = CFAbsoluteTimeGetCurrent() - startTime
            os_log(.debug, log: .default, "Document detection took %.3f seconds", lastProcessingTime)
        }
        
        // Clear previous error
        lastError = nil
        
        // Use autoreleasepool for memory management
        return autoreleasepool { () -> [String: Any]? in
            // Create Vision handler
            let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
            
            // Use dispatch semaphore for synchronous wait while processing on background queue
            let semaphore = DispatchSemaphore(value: 0)
            var result: [String: Any]?
            
            processingQueue.async { [weak self] in
                guard let self = self else {
                    semaphore.signal()
                    return
                }
                
                do {
                    // Perform document detection on background queue
                    try handler.perform([self.documentDetectionRequest])
                    
                    // Process results
                    guard let results = self.documentDetectionRequest.results,
                          !results.isEmpty,
                          let firstResult = results.first else {
                        semaphore.signal()
                        return
                    }
                    
                    // Validate detection quality
                    guard firstResult.confidence > 0.7 else {
                        os_log(.debug, log: .default, "Document detection confidence too low: %.2f", firstResult.confidence)
                        semaphore.signal()
                        return
                    }
                    
                    // Validate boundary polygon
                    guard self.isValidDocumentBoundary(firstResult) else {
                        os_log(.debug, log: .default, "Invalid document boundary detected")
                        semaphore.signal()
                        return
                    }
                    
                    // Create boundary dictionary
                    let boundaryDict: [String: Any] = [
                        "topLeft": ["x": firstResult.topLeft.x, "y": firstResult.topLeft.y],
                        "topRight": ["x": firstResult.topRight.x, "y": firstResult.topRight.y],
                        "bottomLeft": ["x": firstResult.bottomLeft.x, "y": firstResult.bottomLeft.y],
                        "bottomRight": ["x": firstResult.bottomRight.x, "y": firstResult.bottomRight.y],
                        "confidence": firstResult.confidence
                    ]
                    
                    // Calculate additional metrics
                    let area = self.calculatePolygonArea(firstResult)
                    let aspectRatio = self.calculateAspectRatio(firstResult)
                    
                    result = [
                        "success": true,
                        "boundaries": boundaryDict,
                        "metadata": [
                            "area": area,
                            "aspectRatio": aspectRatio,
                            "processingTime": self.lastProcessingTime,
                            "frameSize": [
                                "width": CVPixelBufferGetWidth(pixelBuffer),
                                "height": CVPixelBufferGetHeight(pixelBuffer)
                            ]
                        ]
                    ]
                    
                } catch {
                    self.lastError = error
                    os_log(.error, log: .default, "Document detection failed: %@", error.localizedDescription)
                }
                
                semaphore.signal()
            }
            
            // Wait for background processing to complete (with timeout)
            let timeout = DispatchTime.now() + .milliseconds(500) // 500ms timeout for real-time performance
            _ = semaphore.wait(timeout: timeout)
            
            return result
        }
    }
    
    /**
     * Apply perspective correction to a detected document region
     * Returns the corrected image data or nil if correction fails
     */
    @objc public func correctPerspective(in pixelBuffer: CVPixelBuffer, 
                                        boundaries: [String: Any]) -> CVPixelBuffer? {
        // Extract boundary points
        guard let boundariesDict = boundaries["boundaries"] as? [String: Any],
              let topLeft = boundariesDict["topLeft"] as? [String: Double],
              let topRight = boundariesDict["topRight"] as? [String: Double],
              let bottomLeft = boundariesDict["bottomLeft"] as? [String: Double],
              let bottomRight = boundariesDict["bottomRight"] as? [String: Double] else {
            os_log(.error, log: .default, "Invalid boundary format for perspective correction")
            return nil
        }
        
        return autoreleasepool { () -> CVPixelBuffer? in
            // Convert CVPixelBuffer to CIImage
            let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
            let imageSize = ciImage.extent.size
            
            // Convert normalized coordinates to image coordinates
            let topLeftPoint = CGPoint(
                x: topLeft["x"]! * imageSize.width,
                y: (1.0 - topLeft["y"]!) * imageSize.height  // Vision uses flipped Y
            )
            let topRightPoint = CGPoint(
                x: topRight["x"]! * imageSize.width,
                y: (1.0 - topRight["y"]!) * imageSize.height
            )
            let bottomLeftPoint = CGPoint(
                x: bottomLeft["x"]! * imageSize.width,
                y: (1.0 - bottomLeft["y"]!) * imageSize.height
            )
            let bottomRightPoint = CGPoint(
                x: bottomRight["x"]! * imageSize.width,
                y: (1.0 - bottomRight["y"]!) * imageSize.height
            )
            
            // Calculate target dimensions based on detected boundaries
            let width = max(
                distance(topLeftPoint, topRightPoint),
                distance(bottomLeftPoint, bottomRightPoint)
            )
            let height = max(
                distance(topLeftPoint, bottomLeftPoint),
                distance(topRightPoint, bottomRightPoint)
            )
            
            // Create target rectangle (standard driver's license aspect ratio: 1.586)
            let targetWidth = max(width, height * 1.586)
            let targetHeight = targetWidth / 1.586
            
            let targetRect = CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight)
            
            // Apply perspective correction
            guard let correctedImage = applyPerspectiveCorrection(
                image: ciImage,
                sourcePoints: [topLeftPoint, topRightPoint, bottomRightPoint, bottomLeftPoint],
                targetRect: targetRect
            ) else {
                os_log(.error, log: .default, "Perspective correction failed")
                return nil
            }
            
            // Convert back to CVPixelBuffer
            return createPixelBuffer(from: correctedImage)
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
     * Get last processing time for performance monitoring
     */
    @objc public func getLastProcessingTime() -> TimeInterval {
        return lastProcessingTime
    }
    
    // MARK: - Private Helper Methods
    
    /**
     * Check if the frame quality is acceptable for document detection
     */
    private func isFrameQualityAcceptableForDetection(_ pixelBuffer: CVPixelBuffer) -> Bool {
        // Get frame dimensions
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        
        // Document detection needs reasonable resolution
        guard width >= 720 && height >= 480 else {
            os_log(.debug, log: .default, "Frame resolution too low for document detection: %dx%d", width, height)
            return false
        }
        
        // Check blur level
        let blurLevel = calculateBlurLevel(pixelBuffer)
        guard blurLevel > 60 else { // Moderate threshold for document detection
            os_log(.debug, log: .default, "Frame too blurry for document detection: blur level %.2f", blurLevel)
            return false
        }
        
        // Check brightness
        let brightness = calculateAverageBrightness(pixelBuffer)
        guard brightness > 40 && brightness < 220 else { // Wide range acceptable
            os_log(.debug, log: .default, "Frame brightness out of optimal range: %.2f", brightness)
            return false
        }
        
        return true
    }
    
    /**
     * Validate that detected boundaries form a reasonable document shape
     */
    private func isValidDocumentBoundary(_ result: VNDocumentObservation) -> Bool {
        // Check if points form a quadrilateral
        let points = [result.topLeft, result.topRight, result.bottomRight, result.bottomLeft]
        
        // Calculate area to ensure it's not too small
        let area = calculatePolygonArea(result)
        guard area > 0.01 else { // At least 1% of the frame
            return false
        }
        
        // Check aspect ratio is reasonable for a driver's license (between 1.3 and 2.0)
        let aspectRatio = calculateAspectRatio(result)
        guard aspectRatio > 1.3 && aspectRatio < 2.0 else {
            return false
        }
        
        // Ensure points are in the correct order and form a convex quadrilateral
        return isConvexQuadrilateral(points)
    }
    
    /**
     * Calculate area of the detected polygon
     */
    private func calculatePolygonArea(_ result: VNDocumentObservation) -> Double {
        let points = [result.topLeft, result.topRight, result.bottomRight, result.bottomLeft]
        
        // Use Shoelace formula
        var area: Double = 0
        for i in 0..<points.count {
            let j = (i + 1) % points.count
            area += Double(points[i].x * points[j].y)
            area -= Double(points[j].x * points[i].y)
        }
        return abs(area) / 2.0
    }
    
    /**
     * Calculate aspect ratio of the detected document
     */
    private func calculateAspectRatio(_ result: VNDocumentObservation) -> Double {
        let topWidth = distance(
            CGPoint(x: CGFloat(result.topLeft.x), y: CGFloat(result.topLeft.y)),
            CGPoint(x: CGFloat(result.topRight.x), y: CGFloat(result.topRight.y))
        )
        let bottomWidth = distance(
            CGPoint(x: CGFloat(result.bottomLeft.x), y: CGFloat(result.bottomLeft.y)),
            CGPoint(x: CGFloat(result.bottomRight.x), y: CGFloat(result.bottomRight.y))
        )
        let leftHeight = distance(
            CGPoint(x: CGFloat(result.topLeft.x), y: CGFloat(result.topLeft.y)),
            CGPoint(x: CGFloat(result.bottomLeft.x), y: CGFloat(result.bottomLeft.y))
        )
        let rightHeight = distance(
            CGPoint(x: CGFloat(result.topRight.x), y: CGFloat(result.topRight.y)),
            CGPoint(x: CGFloat(result.bottomRight.x), y: CGFloat(result.bottomRight.y))
        )
        
        let avgWidth = (topWidth + bottomWidth) / 2.0
        let avgHeight = (leftHeight + rightHeight) / 2.0
        
        return avgWidth / avgHeight
    }
    
    /**
     * Check if points form a convex quadrilateral
     */
    private func isConvexQuadrilateral(_ points: [CGPoint]) -> Bool {
        guard points.count == 4 else { return false }
        
        // Calculate cross products to check convexity
        var crossProducts: [Double] = []
        for i in 0..<4 {
            let p1 = points[i]
            let p2 = points[(i + 1) % 4]
            let p3 = points[(i + 2) % 4]
            
            let v1 = CGPoint(x: p2.x - p1.x, y: p2.y - p1.y)
            let v2 = CGPoint(x: p3.x - p2.x, y: p3.y - p2.y)
            
            let cross = Double(v1.x * v2.y - v1.y * v2.x)
            crossProducts.append(cross)
        }
        
        // All cross products should have the same sign for convexity
        let allPositive = crossProducts.allSatisfy { $0 > 0 }
        let allNegative = crossProducts.allSatisfy { $0 < 0 }
        
        return allPositive || allNegative
    }
    
    /**
     * Calculate distance between two points
     */
    private func distance(_ p1: CGPoint, _ p2: CGPoint) -> Double {
        let dx = p2.x - p1.x
        let dy = p2.y - p1.y
        return sqrt(Double(dx * dx + dy * dy))
    }
    
    /**
     * Apply perspective correction using Core Image
     */
    private func applyPerspectiveCorrection(image: CIImage, 
                                          sourcePoints: [CGPoint], 
                                          targetRect: CGRect) -> CIImage? {
        guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
            return nil
        }
        
        // Set input image
        filter.setValue(image, forKey: kCIInputImageKey)
        
        // Set corner points (CIPerspectiveCorrection expects specific order)
        filter.setValue(CIVector(cgPoint: sourcePoints[0]), forKey: "inputTopLeft")
        filter.setValue(CIVector(cgPoint: sourcePoints[1]), forKey: "inputTopRight")
        filter.setValue(CIVector(cgPoint: sourcePoints[2]), forKey: "inputBottomRight")
        filter.setValue(CIVector(cgPoint: sourcePoints[3]), forKey: "inputBottomLeft")
        
        guard let outputImage = filter.outputImage else {
            return nil
        }
        
        // Crop to target rectangle
        let croppedImage = outputImage.cropped(to: targetRect)
        
        return croppedImage
    }
    
    /**
     * Create CVPixelBuffer from CIImage using buffer pool for memory optimization
     */
    private func createPixelBuffer(from ciImage: CIImage) -> CVPixelBuffer? {
        let width = Int(ciImage.extent.width)
        let height = Int(ciImage.extent.height)
        
        pixelBufferPoolLock.lock()
        defer { pixelBufferPoolLock.unlock() }
        
        // Create or recreate buffer pool if needed
        if pixelBufferPool == nil || !isPoolCompatible(width: width, height: height) {
            pixelBufferPool = createPixelBufferPool(width: width, height: height)
        }
        
        guard let pool = pixelBufferPool else {
            // Fallback to direct creation if pool creation fails
            return createPixelBufferDirect(width: width, height: height, ciImage: ciImage)
        }
        
        var pixelBuffer: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)
        
        guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
            // Fallback to direct creation if pool allocation fails
            return createPixelBufferDirect(width: width, height: height, ciImage: ciImage)
        }
        
        // Render CIImage to CVPixelBuffer
        ciContext.render(ciImage, to: buffer)
        
        return buffer
    }
    
    /**
     * Create CVPixelBuffer pool for memory optimization
     */
    private func createPixelBufferPool(width: Int, height: Int) -> CVPixelBufferPool? {
        let attrs = [
            kCVPixelBufferCGImageCompatibilityKey: kCFBooleanTrue!,
            kCVPixelBufferCGBitmapContextCompatibilityKey: kCFBooleanTrue!,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height
        ] as CFDictionary
        
        let poolAttrs = [
            kCVPixelBufferPoolMinimumBufferCountKey: 3,
            kCVPixelBufferPoolMaximumBufferAgeKey: 0
        ] as CFDictionary
        
        var pool: CVPixelBufferPool?
        let status = CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            poolAttrs,
            attrs,
            &pool
        )
        
        return status == kCVReturnSuccess ? pool : nil
    }
    
    /**
     * Check if current pool is compatible with required dimensions
     */
    private func isPoolCompatible(width: Int, height: Int) -> Bool {
        guard let pool = pixelBufferPool else { return false }
        
        // Get pool attributes
        guard let poolAttrs = CVPixelBufferPoolGetPixelBufferAttributes(pool) as? [String: Any],
              let poolWidth = poolAttrs[kCVPixelBufferWidthKey as String] as? Int,
              let poolHeight = poolAttrs[kCVPixelBufferHeightKey as String] as? Int else {
            return false
        }
        
        return poolWidth == width && poolHeight == height
    }
    
    /**
     * Direct CVPixelBuffer creation fallback
     */
    private func createPixelBufferDirect(width: Int, height: Int, ciImage: CIImage) -> CVPixelBuffer? {
        let attrs = [
            kCVPixelBufferCGImageCompatibilityKey: kCFBooleanTrue!,
            kCVPixelBufferCGBitmapContextCompatibilityKey: kCFBooleanTrue!,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA
        ] as CFDictionary
        
        var pixelBuffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attrs,
            &pixelBuffer
        )
        
        guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
            return nil
        }
        
        // Render CIImage to CVPixelBuffer
        ciContext.render(ciImage, to: buffer)
        
        return buffer
    }
    
    /**
     * Calculate blur level using full Laplacian variance implementation
     */
    private func calculateBlurLevel(_ pixelBuffer: CVPixelBuffer) -> Double {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        
        guard let filter = CIFilter(name: "CILaplacian") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        guard let outputImage = filter.outputImage else { return 0 }
        
        // Calculate variance in multiple regions for better accuracy
        let extent = outputImage.extent
        let regions = [
            CGRect(x: extent.midX - 100, y: extent.midY - 100, width: 200, height: 200),
            CGRect(x: extent.minX + 50, y: extent.minY + 50, width: 150, height: 150),
            CGRect(x: extent.maxX - 200, y: extent.maxY - 200, width: 150, height: 150),
            CGRect(x: extent.midX - 75, y: extent.minY + 100, width: 150, height: 150),
            CGRect(x: extent.midX - 75, y: extent.maxY - 250, width: 150, height: 150)
        ]
        
        var totalVariance = 0.0
        var validRegions = 0
        
        for region in regions {
            // Ensure region is within bounds
            let clampedRegion = region.intersection(extent)
            guard !clampedRegion.isEmpty,
                  let cgImage = ciContext.createCGImage(outputImage, from: clampedRegion) else {
                continue
            }
            
            let variance = calculateFullLaplacianVariance(cgImage)
            if variance > 0 {
                totalVariance += variance
                validRegions += 1
            }
        }
        
        guard validRegions > 0 else { return 0 }
        
        // Return average variance across regions
        return totalVariance / Double(validRegions)
    }
    
    /**
     * Calculate average brightness (similar to PDF417Detector)
     */
    private func calculateAverageBrightness(_ pixelBuffer: CVPixelBuffer) -> Double {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        
        guard let filter = CIFilter(name: "CIAreaAverage") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        let extent = ciImage.extent
        let sampleRect = CGRect(x: extent.midX - 150, y: extent.midY - 100, width: 300, height: 200)
        filter.setValue(CIVector(cgRect: sampleRect), forKey: "inputExtent")
        
        guard let outputImage = filter.outputImage else { return 0 }
        
        var bitmap = [UInt8](repeating: 0, count: 4)
        ciContext.render(outputImage, toBitmap: &bitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        
        let brightness = (Double(bitmap[0]) * 0.299 + Double(bitmap[1]) * 0.587 + Double(bitmap[2]) * 0.114)
        return brightness
    }
    
    /**
     * Calculate full Laplacian variance for blur detection (improved implementation)
     */
    private func calculateFullLaplacianVariance(_ cgImage: CGImage) -> Double {
        guard let dataProvider = cgImage.dataProvider,
              let data = dataProvider.data else { return 0.0 }
        
        let ptr = CFDataGetBytePtr(data)
        let length = CFDataGetLength(data)
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let width = cgImage.width
        let height = cgImage.height
        let bytesPerRow = cgImage.bytesPerRow
        
        guard width > 2 && height > 2 else { return 0.0 }
        
        var laplacianValues: [Double] = []
        laplacianValues.reserveCapacity((width - 2) * (height - 2))
        
        // Apply Laplacian kernel (3x3) manually for precise variance calculation
        // Kernel: [0 -1 0; -1 4 -1; 0 -1 0]
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let centerOffset = y * bytesPerRow + x * bytesPerPixel
                let topOffset = (y - 1) * bytesPerRow + x * bytesPerPixel
                let bottomOffset = (y + 1) * bytesPerRow + x * bytesPerPixel
                let leftOffset = y * bytesPerRow + (x - 1) * bytesPerPixel
                let rightOffset = y * bytesPerRow + (x + 1) * bytesPerPixel
                
                // Get grayscale values for Laplacian calculation
                let center = getGrayscaleValue(ptr: ptr, offset: centerOffset)
                let top = getGrayscaleValue(ptr: ptr, offset: topOffset)
                let bottom = getGrayscaleValue(ptr: ptr, offset: bottomOffset)
                let left = getGrayscaleValue(ptr: ptr, offset: leftOffset)
                let right = getGrayscaleValue(ptr: ptr, offset: rightOffset)
                
                // Apply Laplacian kernel
                let laplacianValue = 4.0 * center - top - bottom - left - right
                laplacianValues.append(laplacianValue)
            }
        }
        
        guard !laplacianValues.isEmpty else { return 0.0 }
        
        // Calculate variance of Laplacian values
        let mean = laplacianValues.reduce(0.0, +) / Double(laplacianValues.count)
        let variance = laplacianValues.reduce(0.0) { result, value in
            let diff = value - mean
            return result + (diff * diff)
        } / Double(laplacianValues.count)
        
        return variance
    }
    
    /**
     * Get grayscale value from pixel data
     */
    private func getGrayscaleValue(ptr: UnsafePointer<UInt8>, offset: Int) -> Double {
        let r = Double(ptr[offset])
        let g = Double(ptr[offset + 1])
        let b = Double(ptr[offset + 2])
        return 0.299 * r + 0.587 * g + 0.114 * b
    }
    
    /**
     * Calculate image variance for blur detection (legacy method for compatibility)
     */
    private func calculateImageVariance(_ cgImage: CGImage) -> Double {
        return calculateFullLaplacianVariance(cgImage)
    }
}