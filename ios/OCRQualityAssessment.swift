import Foundation
import Vision
import CoreVideo
import UIKit
import os.log
import CoreImage

@objc public class OCRQualityAssessment: NSObject {
    
    // MARK: - Configuration
    
    // Quality thresholds optimized for OCR text recognition
    public struct QualityThresholds {
        static let minBlurSharpness: Double = 80.0      // Enhanced threshold for text clarity
        static let minContrastRatio: Double = 1.8       // Text/background separation
        static let minGradientMagnitude: Double = 40.0   // Character edge sharpness
        static let minBrightness: Double = 50.0         // Readable lighting conditions
        static let maxBrightness: Double = 200.0        // Avoid overexposure
        static let minResolutionWidth: Int = 720        // Minimum for readable text
        static let minResolutionHeight: Int = 480       // Minimum for readable text
    }
    
    // Core Image context for processing (reuse existing pattern)
    private let ciContext = CIContext(options: [
        .cacheIntermediates: false,
        .highQualityDownsample: false
    ])
    
    // Performance tracking
    private var lastProcessingTime: TimeInterval = 0
    private var lastError: Error?
    
    @objc public override init() {
        super.init()
    }
    
    // MARK: - Quality Assessment API
    
    /**
     * Comprehensive quality assessment for OCR processing
     * Returns quality metrics and overall suitability for text recognition
     */
    @objc public func assessImageQuality(in pixelBuffer: CVPixelBuffer) -> [String: Any] {
        let startTime = CFAbsoluteTimeGetCurrent()
        defer {
            lastProcessingTime = CFAbsoluteTimeGetCurrent() - startTime
            os_log(.debug, log: .default, "OCR quality assessment took %.3f seconds", lastProcessingTime)
        }
        
        // Clear previous error
        lastError = nil
        
        return autoreleasepool { () -> [String: Any] in
            // Basic dimension checks
            let width = CVPixelBufferGetWidth(pixelBuffer)
            let height = CVPixelBufferGetHeight(pixelBuffer)
            
            guard width >= QualityThresholds.minResolutionWidth && 
                  height >= QualityThresholds.minResolutionHeight else {
                return createQualityResult(
                    suitable: false,
                    reason: "resolution",
                    metrics: ["width": width, "height": height],
                    issues: ["lowResolution": true]
                )
            }
            
            // Convert to CIImage for processing
            let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
            
            // Calculate OCR-specific quality metrics
            let blurSharpness = calculateTextSharpness(ciImage)
            let contrastRatio = calculateTextContrast(ciImage)
            let gradientMagnitude = calculateGradientMagnitude(ciImage)
            let brightness = calculateAverageBrightness(ciImage)
            
            // Determine overall suitability
            let issues = identifyQualityIssues(
                blur: blurSharpness,
                contrast: contrastRatio,
                gradient: gradientMagnitude,
                brightness: brightness
            )
            
            let suitable = issues.isEmpty
            
            return createQualityResult(
                suitable: suitable,
                reason: suitable ? "acceptable" : "quality_issues",
                metrics: [
                    "blurSharpness": blurSharpness,
                    "contrastRatio": contrastRatio,
                    "gradientMagnitude": gradientMagnitude,
                    "brightness": brightness,
                    "width": width,
                    "height": height
                ],
                issues: issues
            )
        }
    }
    
    /**
     * Enhanced image preprocessing pipeline for OCR optimization
     * Applies adaptive enhancement based on quality assessment
     */
    @objc public func preprocessForOCR(pixelBuffer: CVPixelBuffer, qualityMetrics: [String: Any]) -> CVPixelBuffer? {
        let startTime = CFAbsoluteTimeGetCurrent()
        defer {
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            os_log(.debug, log: .default, "OCR preprocessing took %.3f seconds", processingTime)
        }
        
        return autoreleasepool { () -> CVPixelBuffer? in
            let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
            
            // Step 1: Adaptive Histogram Equalization for contrast enhancement
            guard let contrastEnhanced = applyAdaptiveHistogramEqualization(ciImage, metrics: qualityMetrics) else {
                return nil
            }
            
            // Step 2: Noise reduction to clean up the image
            guard let noiseReduced = applyNoiseReduction(contrastEnhanced, metrics: qualityMetrics) else {
                return nil
            }
            
            // Step 3: Sharpening for text edge enhancement
            guard let sharpened = applyTextSharpening(noiseReduced, metrics: qualityMetrics) else {
                return nil
            }
            
            // Convert back to CVPixelBuffer
            return createPixelBuffer(from: sharpened)
        }
    }
    
    // MARK: - Quality Metrics Implementation
    
    /**
     * Calculate text-optimized sharpness using enhanced Laplacian variance
     * Similar to DocumentDetector's calculateFullLaplacianVariance but optimized for text
     */
    private func calculateTextSharpness(_ ciImage: CIImage) -> Double {
        guard let filter = CIFilter(name: "CILaplacian") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        guard let outputImage = filter.outputImage else { return 0 }
        
        // Sample multiple text-likely regions for better accuracy
        let extent = outputImage.extent
        let regions = [
            CGRect(x: extent.midX - 100, y: extent.midY - 50, width: 200, height: 100),  // Center horizontal
            CGRect(x: extent.minX + 50, y: extent.midY - 25, width: 150, height: 50),    // Left region
            CGRect(x: extent.maxX - 200, y: extent.midY - 25, width: 150, height: 50),   // Right region
            CGRect(x: extent.midX - 75, y: extent.minY + 100, width: 150, height: 50),   // Upper region
            CGRect(x: extent.midX - 75, y: extent.maxY - 150, width: 150, height: 50)    // Lower region
        ]
        
        var totalVariance = 0.0
        var validRegions = 0
        
        for region in regions {
            let clampedRegion = region.intersection(extent)
            guard !clampedRegion.isEmpty,
                  let cgImage = ciContext.createCGImage(outputImage, from: clampedRegion) else {
                continue
            }
            
            let variance = calculateLaplacianVariance(cgImage)
            if variance > 0 {
                totalVariance += variance
                validRegions += 1
            }
        }
        
        guard validRegions > 0 else { return 0 }
        return totalVariance / Double(validRegions)
    }
    
    /**
     * Calculate contrast ratio using histogram analysis for text/background separation
     */
    private func calculateTextContrast(_ ciImage: CIImage) -> Double {
        // Apply histogram analysis to determine contrast
        guard let histogramFilter = CIFilter(name: "CIAreaHistogram") else { return 0 }
        histogramFilter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Sample center region where text is likely to be
        let extent = ciImage.extent
        let textRegion = CGRect(
            x: extent.midX - extent.width * 0.3,
            y: extent.midY - extent.height * 0.2,
            width: extent.width * 0.6,
            height: extent.height * 0.4
        )
        histogramFilter.setValue(CIVector(cgRect: textRegion), forKey: "inputExtent")
        histogramFilter.setValue(256, forKey: "inputCount")
        
        guard let histogramImage = histogramFilter.outputImage else { return 0 }
        
        // Extract histogram data
        var histogramData = [UInt8](repeating: 0, count: 256 * 4)
        ciContext.render(histogramImage, toBitmap: &histogramData, rowBytes: 256 * 4, 
                        bounds: CGRect(x: 0, y: 0, width: 256, height: 1), 
                        format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        
        // Calculate contrast based on luminance distribution
        var darkPixels = 0
        var brightPixels = 0
        let threshold = 128
        
        for i in stride(from: 0, to: 256 * 4, by: 4) {
            let luminance = Int(Double(histogramData[i]) * 0.299 + 
                              Double(histogramData[i + 1]) * 0.587 + 
                              Double(histogramData[i + 2]) * 0.114)
            if luminance < threshold {
                darkPixels += Int(histogramData[i + 3]) // Use alpha as count
            } else {
                brightPixels += Int(histogramData[i + 3])
            }
        }
        
        // Calculate contrast ratio (bright/dark)
        guard darkPixels > 0 else { return 0 }
        return Double(brightPixels) / Double(darkPixels)
    }
    
    /**
     * Calculate gradient magnitude for character edge detection
     */
    private func calculateGradientMagnitude(_ ciImage: CIImage) -> Double {
        // Apply Sobel edge detection for gradient calculation
        guard let sobelFilter = CIFilter(name: "CIConvolution3X3") else { return 0 }
        sobelFilter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Sobel X kernel for horizontal gradients
        let sobelX = CIVector(values: [-1, 0, 1, -2, 0, 2, -1, 0, 1], count: 9)
        sobelFilter.setValue(sobelX, forKey: "inputWeights")
        
        guard let sobelXImage = sobelFilter.outputImage else { return 0 }
        
        // Calculate average gradient magnitude in text regions
        let extent = sobelXImage.extent
        let textRegion = CGRect(
            x: extent.midX - 100,
            y: extent.midY - 50,
            width: 200,
            height: 100
        )
        
        guard let cgImage = ciContext.createCGImage(sobelXImage, from: textRegion) else { return 0 }
        
        return calculateAveragePixelMagnitude(cgImage)
    }
    
    /**
     * Calculate average brightness with enhanced accuracy (adapted from existing pattern)
     */
    private func calculateAverageBrightness(_ ciImage: CIImage) -> Double {
        guard let filter = CIFilter(name: "CIAreaAverage") else { return 0 }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Sample center area where text is likely
        let extent = ciImage.extent
        let sampleRect = CGRect(x: extent.midX - 150, y: extent.midY - 100, width: 300, height: 200)
        filter.setValue(CIVector(cgRect: sampleRect), forKey: "inputExtent")
        
        guard let outputImage = filter.outputImage else { return 0 }
        
        var bitmap = [UInt8](repeating: 0, count: 4)
        ciContext.render(outputImage, toBitmap: &bitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        
        return (Double(bitmap[0]) * 0.299 + Double(bitmap[1]) * 0.587 + Double(bitmap[2]) * 0.114)
    }
    
    // MARK: - Preprocessing Implementation
    
    /**
     * Apply adaptive histogram equalization for contrast enhancement
     */
    private func applyAdaptiveHistogramEqualization(_ ciImage: CIImage, metrics: [String: Any]) -> CIImage? {
        // Check if contrast enhancement is needed
        guard let contrastRatio = metrics["contrastRatio"] as? Double,
              contrastRatio < 2.5 else {
            return ciImage // Skip if contrast is already good
        }
        
        // Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
        guard let filter = CIFilter(name: "CIColorControls") else { return ciImage }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Adaptive contrast adjustment based on current contrast ratio
        let contrastAdjustment = max(1.0, min(2.0, 2.5 / contrastRatio))
        filter.setValue(contrastAdjustment, forKey: kCIInputContrastKey)
        
        return filter.outputImage ?? ciImage
    }
    
    /**
     * Apply noise reduction while preserving text edges
     */
    private func applyNoiseReduction(_ ciImage: CIImage, metrics: [String: Any]) -> CIImage? {
        // Check if noise reduction is needed
        guard let sharpness = metrics["blurSharpness"] as? Double,
              sharpness < 100 else {
            return ciImage // Skip if image is already sharp
        }
        
        // Apply light noise reduction that preserves text edges
        guard let filter = CIFilter(name: "CINoiseReduction") else { return ciImage }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        filter.setValue(0.02, forKey: "inputNoiseLevel") // Light noise reduction
        filter.setValue(0.4, forKey: "inputSharpness")   // Preserve sharpness
        
        return filter.outputImage ?? ciImage
    }
    
    /**
     * Apply text-optimized sharpening
     */
    private func applyTextSharpening(_ ciImage: CIImage, metrics: [String: Any]) -> CIImage? {
        // Check if sharpening is needed
        guard let sharpness = metrics["blurSharpness"] as? Double,
              sharpness < 120 else {
            return ciImage // Skip if already sharp enough
        }
        
        // Apply unsharp mask for text enhancement
        guard let filter = CIFilter(name: "CIUnsharpMask") else { return ciImage }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        
        // Adaptive sharpening based on current sharpness
        let intensity = max(0.3, min(1.0, (120 - sharpness) / 80))
        filter.setValue(intensity, forKey: kCIInputIntensityKey)
        filter.setValue(1.0, forKey: kCIInputRadiusKey)      // Small radius for text
        
        return filter.outputImage ?? ciImage
    }
    
    // MARK: - Helper Methods
    
    /**
     * Create standardized quality assessment result
     */
    private func createQualityResult(suitable: Bool, reason: String, metrics: [String: Any], issues: [String: Bool]) -> [String: Any] {
        return [
            "suitable": suitable,
            "reason": reason,
            "metrics": metrics,
            "issues": issues,
            "processingTime": lastProcessingTime
        ]
    }
    
    /**
     * Identify specific quality issues for user feedback
     */
    private func identifyQualityIssues(blur: Double, contrast: Double, gradient: Double, brightness: Double) -> [String: Bool] {
        var issues: [String: Bool] = [:]
        
        if blur < QualityThresholds.minBlurSharpness {
            issues["blur"] = true
        }
        if contrast < QualityThresholds.minContrastRatio {
            issues["lowContrast"] = true
        }
        if gradient < QualityThresholds.minGradientMagnitude {
            issues["lowSharpness"] = true
        }
        if brightness < QualityThresholds.minBrightness {
            issues["dark"] = true
        }
        if brightness > QualityThresholds.maxBrightness {
            issues["bright"] = true
        }
        
        return issues
    }
    
    /**
     * Calculate Laplacian variance for blur detection (adapted from DocumentDetector)
     */
    private func calculateLaplacianVariance(_ cgImage: CGImage) -> Double {
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
        
        // Apply 3x3 Laplacian kernel: [0 -1 0; -1 4 -1; 0 -1 0]
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let centerOffset = y * bytesPerRow + x * bytesPerPixel
                let topOffset = (y - 1) * bytesPerRow + x * bytesPerPixel
                let bottomOffset = (y + 1) * bytesPerRow + x * bytesPerPixel
                let leftOffset = y * bytesPerRow + (x - 1) * bytesPerPixel
                let rightOffset = y * bytesPerRow + (x + 1) * bytesPerPixel
                
                let center = getGrayscaleValue(ptr: ptr, offset: centerOffset, dataLength: length)
                let top = getGrayscaleValue(ptr: ptr, offset: topOffset, dataLength: length)
                let bottom = getGrayscaleValue(ptr: ptr, offset: bottomOffset, dataLength: length)
                let left = getGrayscaleValue(ptr: ptr, offset: leftOffset, dataLength: length)
                let right = getGrayscaleValue(ptr: ptr, offset: rightOffset, dataLength: length)
                
                let laplacianValue = 4.0 * center - top - bottom - left - right
                laplacianValues.append(laplacianValue)
            }
        }
        
        guard !laplacianValues.isEmpty else { return 0.0 }
        
        // Calculate variance
        let mean = laplacianValues.reduce(0.0, +) / Double(laplacianValues.count)
        let variance = laplacianValues.reduce(0.0) { result, value in
            let diff = value - mean
            return result + (diff * diff)
        } / Double(laplacianValues.count)
        
        return variance
    }
    
    /**
     * Calculate average pixel magnitude for gradient strength
     */
    private func calculateAveragePixelMagnitude(_ cgImage: CGImage) -> Double {
        guard let dataProvider = cgImage.dataProvider,
              let data = dataProvider.data else { return 0.0 }
        
        let ptr = CFDataGetBytePtr(data)
        let length = CFDataGetLength(data)
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let width = cgImage.width
        let height = cgImage.height
        let bytesPerRow = cgImage.bytesPerRow
        
        var totalMagnitude = 0.0
        var pixelCount = 0
        
        for y in 0..<height {
            for x in 0..<width {
                let offset = y * bytesPerRow + x * bytesPerPixel
                let magnitude = getGrayscaleValue(ptr: ptr, offset: offset, dataLength: length)
                totalMagnitude += magnitude
                pixelCount += 1
            }
        }
        
        return pixelCount > 0 ? totalMagnitude / Double(pixelCount) : 0.0
    }
    
    /**
     * Get grayscale value from pixel data with bounds checking
     */
    private func getGrayscaleValue(ptr: UnsafePointer<UInt8>, offset: Int, dataLength: Int) -> Double {
        // Bounds check to prevent buffer overflow
        guard offset + 2 < dataLength else { return 0.0 }
        
        let r = Double(ptr[offset])
        let g = Double(ptr[offset + 1])
        let b = Double(ptr[offset + 2])
        return 0.299 * r + 0.587 * g + 0.114 * b
    }
    
    /**
     * Create CVPixelBuffer from CIImage (adapted from DocumentDetector pattern)
     */
    private func createPixelBuffer(from ciImage: CIImage) -> CVPixelBuffer? {
        let width = Int(ciImage.extent.width)
        let height = Int(ciImage.extent.height)
        
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
        
        ciContext.render(ciImage, to: buffer)
        return buffer
    }
    
    // MARK: - Public API
    
    /**
     * Get last processing time for performance monitoring
     */
    @objc public func getLastProcessingTime() -> TimeInterval {
        return lastProcessingTime
    }
    
    /**
     * Get last error that occurred during processing
     */
    @objc public func getLastError() -> NSError? {
        guard let error = lastError else { return nil }
        return error as NSError
    }
}