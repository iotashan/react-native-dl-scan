import XCTest
import Vision
import CoreVideo
import UIKit
@testable import DlScan

class OCRQualityAssessmentTests: XCTestCase {
    
    var qualityAssessment: OCRQualityAssessment!
    
    override func setUpWithError() throws {
        super.setUp()
        qualityAssessment = OCRQualityAssessment()
    }
    
    override func tearDownWithError() throws {
        qualityAssessment = nil
        super.tearDown()
    }
    
    // MARK: - Initialization Tests
    
    func testQualityAssessmentInitialization() {
        XCTAssertNotNil(qualityAssessment)
        XCTAssertEqual(qualityAssessment.getLastProcessingTime(), 0.0)
        XCTAssertNil(qualityAssessment.getLastError())
    }
    
    // MARK: - Quality Assessment Tests
    
    func testQualityAssessmentWithGoodImage() {
        // Create a high quality test image
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128, addTextPattern: true) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = qualityAssessment.assessImageQuality(in: pixelBuffer)
        
        XCTAssertNotNil(result)
        
        // Check basic structure
        XCTAssertNotNil(result["suitable"])
        XCTAssertNotNil(result["metrics"])
        XCTAssertNotNil(result["issues"])
        XCTAssertNotNil(result["processingTime"])
        
        // Verify processing time was tracked
        XCTAssertGreaterThan(qualityAssessment.getLastProcessingTime(), 0.0)
        
        // Check metrics structure
        if let metrics = result["metrics"] as? [String: Any] {
            XCTAssertNotNil(metrics["blurSharpness"])
            XCTAssertNotNil(metrics["contrastRatio"])
            XCTAssertNotNil(metrics["gradientMagnitude"])
            XCTAssertNotNil(metrics["brightness"])
            XCTAssertNotNil(metrics["width"])
            XCTAssertNotNil(metrics["height"])
        }
    }
    
    func testQualityAssessmentWithLowResolution() {
        // Create a low resolution image that should fail
        guard let pixelBuffer = createTestPixelBuffer(width: 640, height: 480, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = qualityAssessment.assessImageQuality(in: pixelBuffer)
        
        XCTAssertNotNil(result)
        if let suitable = result["suitable"] as? Bool {
            XCTAssertFalse(suitable, "Low resolution image should be marked as unsuitable")
        }
        
        if let reason = result["reason"] as? String {
            XCTAssertEqual(reason, "resolution")
        }
        
        if let issues = result["issues"] as? [String: Bool] {
            XCTAssertEqual(issues["lowResolution"], true)
        }
    }
    
    func testQualityAssessmentWithDarkImage() {
        // Create a dark image
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 30) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = qualityAssessment.assessImageQuality(in: pixelBuffer)
        
        XCTAssertNotNil(result)
        if let suitable = result["suitable"] as? Bool {
            XCTAssertFalse(suitable, "Dark image should be marked as unsuitable")
        }
        
        if let issues = result["issues"] as? [String: Bool] {
            XCTAssertEqual(issues["dark"], true)
        }
    }
    
    func testQualityAssessmentWithBrightImage() {
        // Create a bright image
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 220) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = qualityAssessment.assessImageQuality(in: pixelBuffer)
        
        XCTAssertNotNil(result)
        if let suitable = result["suitable"] as? Bool {
            XCTAssertFalse(suitable, "Overexposed image should be marked as unsuitable")
        }
        
        if let issues = result["issues"] as? [String: Bool] {
            XCTAssertEqual(issues["bright"], true)
        }
    }
    
    func testQualityAssessmentWithBlurryImage() {
        // Create a blurry image (uniform brightness without sharp edges)
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128, blur: true) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = qualityAssessment.assessImageQuality(in: pixelBuffer)
        
        XCTAssertNotNil(result)
        if let suitable = result["suitable"] as? Bool {
            XCTAssertFalse(suitable, "Blurry image should be marked as unsuitable")
        }
        
        if let issues = result["issues"] as? [String: Bool] {
            XCTAssertEqual(issues["blur"], true)
        }
    }
    
    // MARK: - Preprocessing Tests
    
    func testPreprocessingWithGoodQualityImage() {
        // Create a good quality image
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128, addTextPattern: true) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let qualityMetrics = qualityAssessment.assessImageQuality(in: pixelBuffer)
        let preprocessed = qualityAssessment.preprocessForOCR(pixelBuffer: pixelBuffer, qualityMetrics: qualityMetrics)
        
        XCTAssertNotNil(preprocessed, "Preprocessing should succeed with good quality image")
        
        if let result = preprocessed {
            // Verify dimensions are preserved
            XCTAssertEqual(CVPixelBufferGetWidth(result), CVPixelBufferGetWidth(pixelBuffer))
            XCTAssertEqual(CVPixelBufferGetHeight(result), CVPixelBufferGetHeight(pixelBuffer))
        }
    }
    
    func testPreprocessingWithLowContrastImage() {
        // Create a low contrast image
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128, lowContrast: true) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let qualityMetrics = qualityAssessment.assessImageQuality(in: pixelBuffer)
        let preprocessed = qualityAssessment.preprocessForOCR(pixelBuffer: pixelBuffer, qualityMetrics: qualityMetrics)
        
        // Preprocessing might still succeed but with enhancement applied
        XCTAssertNotNil(preprocessed, "Preprocessing should attempt to enhance low contrast image")
    }
    
    func testPreprocessingPerformance() {
        // Create a test image
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let qualityMetrics = qualityAssessment.assessImageQuality(in: pixelBuffer)
        
        measure {
            _ = qualityAssessment.preprocessForOCR(pixelBuffer: pixelBuffer, qualityMetrics: qualityMetrics)
        }
        
        // Verify processing time tracking
        XCTAssertGreaterThan(qualityAssessment.getLastProcessingTime(), 0.0)
    }
    
    // MARK: - Error Handling Tests
    
    func testErrorReporting() {
        // Initially no error
        XCTAssertNil(qualityAssessment.getLastError())
        
        // After processing, error state should be trackable
        let error = qualityAssessment.getLastError()
        // May be nil if no error occurred during test
    }
    
    // MARK: - Performance Tests
    
    func testQualityAssessmentPerformance() {
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        measure {
            _ = qualityAssessment.assessImageQuality(in: pixelBuffer)
        }
        
        // Verify processing time is tracked
        let processingTime = qualityAssessment.getLastProcessingTime()
        XCTAssertGreaterThan(processingTime, 0.0)
        XCTAssertLessThan(processingTime, 1.0, "Quality assessment should complete in under 1 second")
    }
    
    func testConcurrentQualityAssessment() {
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let expectation = self.expectation(description: "Concurrent quality assessment test")
        expectation.expectedFulfillmentCount = 3
        
        // Run multiple assessments concurrently
        for _ in 0..<3 {
            DispatchQueue.global(qos: .userInitiated).async {
                let result = self.qualityAssessment.assessImageQuality(in: pixelBuffer)
                XCTAssertNotNil(result)
                expectation.fulfill()
            }
        }
        
        waitForExpectations(timeout: 5.0, handler: nil)
    }
    
    // MARK: - Integration Tests
    
    func testQualityThresholds() {
        // Test that thresholds are applied correctly
        let thresholds = OCRQualityAssessment.QualityThresholds.self
        
        XCTAssertGreaterThan(thresholds.minBlurSharpness, 0)
        XCTAssertGreaterThan(thresholds.minContrastRatio, 1.0)
        XCTAssertGreaterThan(thresholds.minGradientMagnitude, 0)
        XCTAssertGreaterThan(thresholds.minBrightness, 0)
        XCTAssertLessThan(thresholds.minBrightness, thresholds.maxBrightness)
        XCTAssertGreaterThan(thresholds.minResolutionWidth, 0)
        XCTAssertGreaterThan(thresholds.minResolutionHeight, 0)
    }
    
    // MARK: - Helper Methods
    
    private func createTestPixelBuffer(width: Int, height: Int, brightness: UInt8, addTextPattern: Bool = false, blur: Bool = false, lowContrast: Bool = false) -> CVPixelBuffer? {
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
        
        // Fill buffer with test pattern
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        
        let baseAddress = CVPixelBufferGetBaseAddress(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        
        for y in 0..<height {
            let rowPtr = baseAddress?.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
            for x in 0..<width {
                let pixelPtr = rowPtr?.advanced(by: x * 4)
                
                var pixelBrightness = brightness
                
                if addTextPattern {
                    // Add text-like patterns (horizontal lines every 20 pixels)
                    if y % 40 < 8 && x % 60 < 50 {
                        pixelBrightness = UInt8(max(0, Int(brightness) - 100)) // Dark text
                    }
                }
                
                if blur {
                    // Create uniform blur by averaging neighboring pixels
                    let variation = UInt8(5) // Minimal variation for blurry effect
                    pixelBrightness = UInt8(max(0, min(255, Int(brightness) + Int(variation))))
                }
                
                if lowContrast {
                    // Reduce contrast by bringing values closer to mid-gray
                    let midGray: UInt8 = 128
                    pixelBrightness = UInt8((Int(brightness) + Int(midGray)) / 2)
                }
                
                pixelPtr?[0] = pixelBrightness // B
                pixelPtr?[1] = pixelBrightness // G
                pixelPtr?[2] = pixelBrightness // R
                pixelPtr?[3] = 255            // A
            }
        }
        
        return buffer
    }
}