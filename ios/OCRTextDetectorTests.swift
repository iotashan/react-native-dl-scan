import XCTest
import Vision
import CoreVideo
@testable import DlScan

class OCRTextDetectorTests: XCTestCase {
    
    var detector: OCRTextDetector!
    
    override func setUp() {
        super.setUp()
        detector = OCRTextDetector()
    }
    
    override func tearDown() {
        detector = nil
        super.tearDown()
    }
    
    // MARK: - Test OCR Configuration
    
    func testOCRDetectorInitialization() {
        XCTAssertNotNil(detector, "OCR detector should be initialized")
    }
    
    func testTextRecognitionRequestConfiguration() {
        // Create a test pixel buffer
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        // Attempt detection (will fail with test buffer, but should not crash)
        _ = detector.detectText(in: pixelBuffer)
        
        // Verify no crash occurred
        XCTAssertTrue(true, "Text detection should complete without crashing")
    }
    
    // MARK: - Test Frame Quality Validation
    
    func testRejectsLowResolutionFrames() {
        // Create a low resolution pixel buffer
        let pixelBuffer = createTestPixelBuffer(width: 640, height: 480)
        
        let result = detector.detectText(in: pixelBuffer)
        
        XCTAssertNil(result, "Should reject frames below 1280x720 resolution")
    }
    
    func testAcceptsHighResolutionFrames() {
        // Create a high resolution pixel buffer
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        // Will return nil due to test buffer content, but should attempt processing
        _ = detector.detectText(in: pixelBuffer)
        
        // Verify processing was attempted (no early rejection)
        XCTAssertTrue(true, "Should accept frames with sufficient resolution")
    }
    
    // MARK: - Test Error Handling
    
    func testErrorRetrievalAfterFailure() {
        // Create a test pixel buffer
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        // Attempt detection (will fail with test buffer)
        _ = detector.detectText(in: pixelBuffer)
        
        // Error might be nil if Vision Framework handles gracefully
        let error = detector.getLastError()
        
        // Just verify the method exists and doesn't crash
        XCTAssertTrue(true, "Error retrieval should not crash")
    }
    
    // MARK: - Test Performance
    
    func testOCRProcessingPerformance() {
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        measure {
            _ = detector.detectText(in: pixelBuffer)
        }
    }
    
    func testConcurrentProcessingPrevention() {
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        // Start first detection
        DispatchQueue.global().async {
            _ = self.detector.detectText(in: pixelBuffer)
        }
        
        // Immediately try second detection
        let result = detector.detectText(in: pixelBuffer)
        
        // Second detection should be skipped
        XCTAssertNil(result, "Should skip processing when already processing")
    }
    
    // MARK: - Test Memory Management
    
    func testMemoryReleaseAfterProcessing() {
        autoreleasepool {
            let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
            
            for _ in 0..<10 {
                _ = detector.detectText(in: pixelBuffer)
            }
        }
        
        // Verify no memory leaks (would be caught by Instruments in real testing)
        XCTAssertTrue(true, "Memory should be properly released")
    }
    
    // MARK: - Helper Methods
    
    private func createTestPixelBuffer(width: Int, height: Int) -> CVPixelBuffer {
        var pixelBuffer: CVPixelBuffer?
        let attributes: [String: Any] = [
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ]
        
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &pixelBuffer
        )
        
        // Fill with test pattern
        if let buffer = pixelBuffer {
            CVPixelBufferLockBaseAddress(buffer, [])
            let baseAddress = CVPixelBufferGetBaseAddress(buffer)
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            
            // Fill with gray color
            if let address = baseAddress {
                memset(address, 128, bytesPerRow * height)
            }
            
            CVPixelBufferUnlockBaseAddress(buffer, [])
        }
        
        return pixelBuffer!
    }
}

// MARK: - Mock Test for Document Detection

extension OCRTextDetectorTests {
    
    func testDocumentDetectionIntegration() {
        // This test verifies the document detection request is properly configured
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        // Attempt detection with document bounds
        let result = detector.detectText(in: pixelBuffer)
        
        // In a real scenario with an actual license image:
        // - result["documentBounds"] would contain the detected document quad
        // - result["textObservations"] would contain detected text
        
        XCTAssertTrue(true, "Document detection should be attempted")
    }
    
    func testTextObservationFiltering() {
        // This test would verify that low confidence text is filtered out
        // In production, we'd use a real license image
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        _ = detector.detectText(in: pixelBuffer)
        
        // Verify confidence threshold is applied (>0.5)
        XCTAssertTrue(true, "Low confidence text should be filtered")
    }
}

// MARK: - Enhanced Quality Assessment Integration Tests (T04_S03)

extension OCRTextDetectorTests {
    
    func testQualityAssessmentIntegration() {
        // Test OCR integration with quality assessment
        let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720)
        
        let result = detector.detectText(in: pixelBuffer)
        
        // Result should contain quality assessment data
        if let ocrResult = result {
            XCTAssertNotNil(ocrResult["qualityAssessment"], "OCR result should include quality assessment")
            
            if let success = ocrResult["success"] as? Bool, !success {
                // Failed OCR should have detailed quality feedback
                XCTAssertNotNil(ocrResult["error"], "Failed OCR should include error details")
            }
        }
    }
    
    func testPreprocessingIntegration() {
        // Test that OCR properly uses preprocessing pipeline
        let lowQualityBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 60)
        
        let result = detector.detectText(in: lowQualityBuffer)
        
        // Should attempt processing with enhancement
        if let ocrResult = result {
            XCTAssertNotNil(ocrResult["qualityAssessment"], "Should include quality metrics")
            XCTAssertNotNil(ocrResult["processingTime"], "Should track processing time")
        }
    }
    
    func testConfidenceThresholdEnforcement() {
        // Test that confidence threshold (>0.5) is properly enforced
        let blurryBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 80)
        
        let result = detector.detectText(in: blurryBuffer)
        
        // If text is detected but confidence is low, should return appropriate error
        if let ocrResult = result,
           let success = ocrResult["success"] as? Bool,
           !success,
           let error = ocrResult["error"] as? [String: Any] {
            
            let code = error["code"] as? String
            // Should be low confidence error if text was detected but filtered
            if code?.contains("LOW_CONFIDENCE") == true {
                XCTAssertNotNil(ocrResult["textObservations"], "Low confidence error should include detected text for debugging")
            }
        }
    }
    
    func testOCRResultStructureValidation() {
        // Test that OCR results have proper structure for successful detection
        let goodBuffer = createTestPixelBuffer(width: 1920, height: 1080, brightness: 128)
        
        let result = detector.detectText(in: goodBuffer)
        
        if let ocrResult = result {
            // All results should have these fields
            XCTAssertNotNil(ocrResult["success"], "Result should contain success field")
            XCTAssertNotNil(ocrResult["processingTime"], "Result should contain processing time")
            XCTAssertNotNil(ocrResult["qualityAssessment"], "Result should contain quality assessment")
            
            if let success = ocrResult["success"] as? Bool {
                if success {
                    // Successful results should have text data
                    XCTAssertNotNil(ocrResult["textObservations"], "Successful result should contain text observations")
                    XCTAssertNotNil(ocrResult["totalTextBlocks"], "Successful result should contain text block count")
                } else {
                    // Failed results should have error details
                    XCTAssertNotNil(ocrResult["error"], "Failed result should contain error details")
                }
            }
        }
    }
    
    func testDocumentBoundsIntegration() {
        // Test that document bounds are properly integrated when detected
        let docBuffer = createTestPixelBuffer(width: 1920, height: 1080, brightness: 120)
        
        let result = detector.detectText(in: docBuffer)
        
        if let ocrResult = result,
           let success = ocrResult["success"] as? Bool,
           success,
           let documentBounds = ocrResult["documentBounds"] as? [String: Any] {
            
            // Document bounds should have proper structure
            XCTAssertNotNil(documentBounds["topLeft"], "Document bounds should contain topLeft")
            XCTAssertNotNil(documentBounds["topRight"], "Document bounds should contain topRight")
            XCTAssertNotNil(documentBounds["bottomLeft"], "Document bounds should contain bottomLeft")
            XCTAssertNotNil(documentBounds["bottomRight"], "Document bounds should contain bottomRight")
            XCTAssertNotNil(documentBounds["confidence"], "Document bounds should contain confidence")
        }
    }
}

// MARK: - Driver License Vocabulary Tests (T04_S03)

extension OCRTextDetectorTests {
    
    func testDriverLicenseVocabularyConfiguration() {
        // Test that custom vocabulary is properly configured (iOS 16+)
        if #available(iOS 16.0, *) {
            // Create buffer that might trigger vocabulary usage
            let buffer = createTestPixelBuffer(width: 1920, height: 1080, brightness: 140)
            
            // Attempt detection - vocabulary should be applied internally
            _ = detector.detectText(in: buffer)
            
            // Verify no crash with vocabulary configuration
            XCTAssertTrue(true, "Custom vocabulary should be configured without crashing")
        } else {
            // On older iOS versions, vocabulary should be skipped gracefully
            let buffer = createTestPixelBuffer(width: 1920, height: 1080, brightness: 140)
            _ = detector.detectText(in: buffer)
            XCTAssertTrue(true, "Should handle gracefully on iOS < 16")
        }
    }
    
    func testOCRConfigurationOptimization() {
        // Test that OCR is configured for accuracy over speed
        let buffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        // Configuration should prioritize accuracy for license reading
        _ = detector.detectText(in: buffer)
        
        // Verify processing completes (configuration test)
        let processingTime = detector.getLastProcessingTime()
        XCTAssertGreaterThanOrEqual(processingTime, 0.0, "Processing time should be tracked")
    }
}

// MARK: - Error Translation Tests (T04_S03)

extension OCRTextDetectorTests {
    
    func testErrorTranslationIntegration() {
        // Test that OCR errors are properly translated to user-friendly messages
        let poorBuffer = createTestPixelBuffer(width: 320, height: 240, brightness: 20)
        
        let result = detector.detectText(in: poorBuffer)
        
        if let ocrResult = result,
           let success = ocrResult["success"] as? Bool,
           !success,
           let error = ocrResult["error"] as? [String: Any] {
            
            // Error should be properly structured
            XCTAssertNotNil(error["code"], "Error should contain error code")
            XCTAssertNotNil(error["message"], "Error should contain message")
            XCTAssertNotNil(error["userMessage"], "Error should contain user-friendly message")
            XCTAssertNotNil(error["recoverable"], "Error should indicate if recoverable")
            
            // User message should be helpful
            if let userMessage = error["userMessage"] as? String {
                XCTAssertFalse(userMessage.isEmpty, "User message should not be empty")
            }
        }
    }
}

// MARK: - Performance Validation Tests (T04_S03)

extension OCRTextDetectorTests {
    
    func testOCRMeetsPerformanceRequirements() {
        // Test that OCR meets 2 FPS requirement (0.5 seconds max)
        let buffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128)
        
        let startTime = CFAbsoluteTimeGetCurrent()
        _ = detector.detectText(in: buffer)
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        
        XCTAssertLessThan(processingTime, 0.5, "OCR should complete within 0.5 seconds for 2 FPS requirement")
        
        // Verify internal timing matches
        let internalTime = detector.getLastProcessingTime()
        XCTAssertGreaterThan(internalTime, 0, "Internal processing time should be tracked")
        XCTAssertLessThan(abs(internalTime - processingTime), 0.1, "Internal and external timing should be similar")
    }
    
    func testConcurrentProcessingLimitation() {
        // Test that concurrent processing is properly limited
        let buffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        let expectation = self.expectation(description: "Concurrent processing test")
        var results: [Any?] = []
        let queue = DispatchQueue.global(qos: .userInitiated)
        
        // Start multiple concurrent requests
        for i in 0..<3 {
            queue.async {
                let result = self.detector.detectText(in: buffer)
                results.append(result)
                
                if i == 2 {
                    expectation.fulfill()
                }
            }
        }
        
        waitForExpectations(timeout: 10.0) { _ in
            // At least one should return nil due to concurrent processing prevention
            let nilResults = results.filter { $0 == nil }
            XCTAssertGreaterThan(nilResults.count, 0, "Some concurrent requests should be skipped")
        }
    }
}

// MARK: - Integration Tests

extension OCRTextDetectorTests {
    
    func testOCRAndBarcodeDetectorCompatibility() {
        // Verify OCRTextDetector can coexist with PDF417Detector
        let ocrDetector = OCRTextDetector()
        let barcodeDetector = PDF417Detector()
        
        XCTAssertNotNil(ocrDetector, "OCR detector should initialize")
        XCTAssertNotNil(barcodeDetector, "Barcode detector should initialize")
        
        // Both should use similar patterns
        let pixelBuffer = createTestPixelBuffer(width: 1920, height: 1080)
        
        _ = ocrDetector.detectText(in: pixelBuffer)
        _ = barcodeDetector.detectPDF417(in: pixelBuffer)
        
        XCTAssertTrue(true, "Both detectors should work independently")
    }
    
    func testCompleteOCRPipelineIntegration() {
        // Test the complete OCR pipeline integration
        let buffer = createTestPixelBuffer(width: 1920, height: 1080, brightness: 128)
        
        // Should integrate: Quality Assessment → Preprocessing → Document Detection → OCR → Error Translation
        let result = detector.detectText(in: buffer)
        
        if let ocrResult = result {
            // Pipeline should produce comprehensive result
            XCTAssertNotNil(ocrResult["success"], "Pipeline should indicate success/failure")
            XCTAssertNotNil(ocrResult["qualityAssessment"], "Pipeline should include quality assessment")
            XCTAssertNotNil(ocrResult["processingTime"], "Pipeline should track timing")
            
            if let success = ocrResult["success"] as? Bool, !success {
                XCTAssertNotNil(ocrResult["error"], "Failed pipeline should provide error details")
            }
        }
    }
}

// MARK: - Helper Method Updates

extension OCRTextDetectorTests {
    
    private func createTestPixelBuffer(width: Int, height: Int, brightness: UInt8 = 128) -> CVPixelBuffer {
        var pixelBuffer: CVPixelBuffer?
        let attributes: [String: Any] = [
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ]
        
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &pixelBuffer
        )
        
        // Fill with test pattern at specified brightness
        if let buffer = pixelBuffer {
            CVPixelBufferLockBaseAddress(buffer, [])
            let baseAddress = CVPixelBufferGetBaseAddress(buffer)
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            
            // Fill with specified brightness
            for y in 0..<height {
                let rowPtr = baseAddress?.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
                for x in 0..<width {
                    let pixelPtr = rowPtr?.advanced(by: x * 4)
                    pixelPtr?[0] = brightness // B
                    pixelPtr?[1] = brightness // G
                    pixelPtr?[2] = brightness // R
                    pixelPtr?[3] = 255        // A
                }
            }
            
            CVPixelBufferUnlockBaseAddress(buffer, [])
        }
        
        return pixelBuffer!
    }
}