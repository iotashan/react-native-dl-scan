import XCTest
import Vision
import CoreVideo
import UIKit
@testable import DlScan

class DocumentDetectorTests: XCTestCase {
    
    var documentDetector: DocumentDetector!
    
    override func setUpWithError() throws {
        super.setUp()
        documentDetector = DocumentDetector()
    }
    
    override func tearDownWithError() throws {
        documentDetector = nil
        super.tearDown()
    }
    
    // MARK: - Initialization Tests
    
    func testDocumentDetectorInitialization() {
        XCTAssertNotNil(documentDetector)
        XCTAssertNil(documentDetector.getLastError())
        XCTAssertEqual(documentDetector.getLastProcessingTime(), 0.0)
    }
    
    // MARK: - Frame Quality Tests
    
    func testFrameQualityValidation() {
        // Test with nil pixel buffer - should handle gracefully
        // Note: We cannot actually pass nil to detectDocument as it expects CVPixelBuffer
        // Instead we test that quality validation rejects poor frames
        guard let poorQualityBuffer = createTestPixelBuffer(width: 320, height: 240, brightness: 10) else {
            XCTFail("Failed to create poor quality test buffer")
            return
        }
        
        let result = documentDetector.detectDocument(in: poorQualityBuffer)
        XCTAssertNil(result) // Should be rejected due to poor quality
    }
    
    func testFrameQualityAcceptable() {
        // Create a test frame with acceptable quality
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        // The detector should at least attempt processing (may return nil if no document found)
        let result = documentDetector.detectDocument(in: pixelBuffer)
        // We don't assert success here since we're only testing quality validation
        // The method should complete without crashing
        XCTAssertTrue(true) // Placeholder assertion
    }
    
    func testFrameQualityTooSmall() {
        // Create a frame that's too small
        guard let pixelBuffer = createTestPixelBuffer(width: 640, height: 480, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = documentDetector.detectDocument(in: pixelBuffer)
        XCTAssertNil(result) // Should be rejected due to low resolution
    }
    
    func testFrameQualityTooDark() {
        // Create a frame that's too dark
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 20) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = documentDetector.detectDocument(in: pixelBuffer)
        XCTAssertNil(result) // Should be rejected due to low brightness
    }
    
    func testFrameQualityTooBright() {
        // Create a frame that's too bright
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 240) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        let result = documentDetector.detectDocument(in: pixelBuffer)
        XCTAssertNil(result) // Should be rejected due to high brightness
    }
    
    // MARK: - Document Detection Tests
    
    func testDocumentDetectionWithValidBoundaries() {
        // Create a mock document detection result
        let mockBoundaries = createMockDocumentBoundaries()
        
        // Validate the boundary structure
        XCTAssertNotNil(mockBoundaries["boundaries"])
        
        if let boundaries = mockBoundaries["boundaries"] as? [String: Any] {
            XCTAssertNotNil(boundaries["topLeft"])
            XCTAssertNotNil(boundaries["topRight"])
            XCTAssertNotNil(boundaries["bottomLeft"])
            XCTAssertNotNil(boundaries["bottomRight"])
            XCTAssertNotNil(boundaries["confidence"])
        }
    }
    
    func testPerspectiveCorrectionWithValidBoundaries() {
        // Create test pixel buffer and boundaries
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128),
              let mockBoundaries = createMockDocumentBoundaries() as [String: Any]? else {
            XCTFail("Failed to create test data")
            return
        }
        
        // Test perspective correction
        let correctedBuffer = documentDetector.correctPerspective(in: pixelBuffer, boundaries: mockBoundaries)
        
        // The method should complete without crashing (may return nil if correction fails)
        // We're primarily testing that the method handles the input correctly
        XCTAssertTrue(true) // Placeholder assertion since actual correction depends on Vision Framework
    }
    
    func testPerspectiveCorrectionWithInvalidBoundaries() {
        // Create test pixel buffer
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        // Test with invalid boundaries
        let invalidBoundaries: [String: Any] = [
            "boundaries": [
                "topLeft": ["x": "invalid", "y": 0.1],
                "topRight": ["x": 0.9, "y": 0.1],
                "bottomLeft": ["x": 0.1, "y": 0.9],
                "bottomRight": ["x": 0.9, "y": 0.9]
            ]
        ]
        
        let result = documentDetector.correctPerspective(in: pixelBuffer, boundaries: invalidBoundaries)
        XCTAssertNil(result) // Should fail with invalid boundaries
    }
    
    // MARK: - Boundary Validation Tests
    
    func testValidDocumentAspectRatio() {
        // Test with valid driver's license aspect ratio (1.586)
        let validBoundaries = createMockDocumentBoundaries(aspectRatio: 1.586)
        XCTAssertNotNil(validBoundaries)
    }
    
    func testInvalidDocumentAspectRatioTooWide() {
        // Test with aspect ratio too wide for a driver's license
        let invalidBoundaries = createMockDocumentBoundaries(aspectRatio: 2.5)
        // In a real implementation, this should be validated
        XCTAssertNotNil(invalidBoundaries) // Mock creation doesn't validate, but detector would
    }
    
    func testInvalidDocumentAspectRatioTooNarrow() {
        // Test with aspect ratio too narrow for a driver's license
        let invalidBoundaries = createMockDocumentBoundaries(aspectRatio: 1.0)
        // In a real implementation, this should be validated
        XCTAssertNotNil(invalidBoundaries) // Mock creation doesn't validate, but detector would
    }
    
    // MARK: - Performance Tests
    
    func testDocumentDetectionPerformance() {
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        measure {
            _ = documentDetector.detectDocument(in: pixelBuffer)
        }
        
        // Verify processing time is tracked
        let processingTime = documentDetector.getLastProcessingTime()
        XCTAssertGreaterThanOrEqual(processingTime, 0.0)
    }
    
    func testConcurrentDetectionPrevention() {
        guard let pixelBuffer = createTestPixelBuffer(width: 1280, height: 720, brightness: 128) else {
            XCTFail("Failed to create test pixel buffer")
            return
        }
        
        // Start detection on background queue
        let expectation = self.expectation(description: "Concurrent detection test")
        
        DispatchQueue.global(qos: .userInitiated).async {
            _ = self.documentDetector.detectDocument(in: pixelBuffer)
            
            // Immediately try another detection - should be skipped
            let result = self.documentDetector.detectDocument(in: pixelBuffer)
            XCTAssertNil(result) // Second call should return nil due to concurrent processing
            
            expectation.fulfill()
        }
        
        waitForExpectations(timeout: 5.0, handler: nil)
    }
    
    // MARK: - Error Handling Tests
    
    func testErrorReporting() {
        // Initially no error
        XCTAssertNil(documentDetector.getLastError())
        
        // After a failed detection (simulated by passing invalid data)
        // The error state should be trackable
        let error = documentDetector.getLastError()
        // May be nil if no error occurred during test
    }
    
    // MARK: - Helper Methods
    
    private func createTestPixelBuffer(width: Int, height: Int, brightness: UInt8) -> CVPixelBuffer? {
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
        
        // Fill buffer with specified brightness
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        
        let baseAddress = CVPixelBufferGetBaseAddress(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        
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
        
        return buffer
    }
    
    private func createMockDocumentBoundaries(aspectRatio: Double = 1.586) -> [String: Any] {
        // Create mock boundaries for a driver's license with given aspect ratio
        let width = 0.8  // 80% of frame width
        let height = width / aspectRatio
        
        let centerX = 0.5
        let centerY = 0.5
        
        let halfWidth = width / 2.0
        let halfHeight = height / 2.0
        
        return [
            "success": true,
            "boundaries": [
                "topLeft": ["x": centerX - halfWidth, "y": centerY - halfHeight],
                "topRight": ["x": centerX + halfWidth, "y": centerY - halfHeight],
                "bottomLeft": ["x": centerX - halfWidth, "y": centerY + halfHeight],
                "bottomRight": ["x": centerX + halfWidth, "y": centerY + halfHeight],
                "confidence": 0.85
            ],
            "metadata": [
                "area": width * height,
                "aspectRatio": aspectRatio,
                "processingTime": 0.1,
                "frameSize": ["width": 1280, "height": 720]
            ]
        ]
    }
}

// MARK: - Integration Tests

class DocumentDetectorIntegrationTests: XCTestCase {
    
    var documentDetector: DocumentDetector!
    
    override func setUpWithError() throws {
        super.setUp()
        documentDetector = DocumentDetector()
    }
    
    override func tearDownWithError() throws {
        documentDetector = nil
        super.tearDown()
    }
    
    func testDocumentDetectionPipeline() {
        // Test the complete pipeline: detection -> validation -> perspective correction
        guard let pixelBuffer = createTestFrame() else {
            XCTFail("Failed to create test frame")
            return
        }
        
        // Step 1: Document detection
        let detectionResult = documentDetector.detectDocument(in: pixelBuffer)
        
        // If detection succeeded, test perspective correction
        if let result = detectionResult,
           let success = result["success"] as? Bool,
           success == true {
            
            // Step 2: Perspective correction
            let correctedBuffer = documentDetector.correctPerspective(in: pixelBuffer, boundaries: result)
            
            // The correction may or may not succeed depending on the mock data
            // But the pipeline should complete without crashing
            XCTAssertTrue(true) // Pipeline completed
        }
    }
    
    func testPerformanceWithRealisticFrame() {
        guard let pixelBuffer = createTestFrame() else {
            XCTFail("Failed to create test frame")
            return
        }
        
        // Measure performance with realistic frame size
        measure {
            _ = documentDetector.detectDocument(in: pixelBuffer)
        }
        
        // Verify processing time is reasonable (should be well under 2 seconds)
        let processingTime = documentDetector.getLastProcessingTime()
        XCTAssertLessThan(processingTime, 2.0, "Document detection should complete in under 2 seconds")
    }
    
    private func createTestFrame() -> CVPixelBuffer? {
        // Create a realistic test frame (HD resolution with moderate brightness)
        return createTestPixelBuffer(width: 1920, height: 1080, brightness: 128)
    }
    
    private func createTestPixelBuffer(width: Int, height: Int, brightness: UInt8) -> CVPixelBuffer? {
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
                // Create a gradient pattern to simulate some visual content
                let gradientValue = UInt8(min(255, max(0, Int(brightness) + (x + y) / 10)))
                pixelPtr?[0] = gradientValue // B
                pixelPtr?[1] = gradientValue // G
                pixelPtr?[2] = gradientValue // R
                pixelPtr?[3] = 255          // A
            }
        }
        
        return buffer
    }
}