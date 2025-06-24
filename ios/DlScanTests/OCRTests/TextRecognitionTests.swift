import XCTest
import Vision
@testable import DlScan

class TextRecognitionTests: XCTestCase {
    
    var textDetector: OCRTextDetector!
    
    override func setUp() {
        super.setUp()
        textDetector = OCRTextDetector()
    }
    
    override func tearDown() {
        textDetector = nil
        super.tearDown()
    }
    
    // MARK: - Basic OCR Tests
    
    func testTextRecognitionFromClearImage() {
        // Given
        let expectation = self.expectation(description: "OCR completion")
        guard let testImage = TestDataProvider.sampleLicenseFrontImage() else {
            XCTFail("Failed to create test image")
            return
        }
        
        // When
        textDetector.recognizeText(in: testImage) { result in
            switch result {
            case .success(let text):
                // Then
                XCTAssertTrue(text.contains("DRIVER LICENSE"))
                XCTAssertTrue(text.contains("JOHN DOE"))
                XCTAssertTrue(text.contains("123 MAIN ST"))
            case .failure(let error):
                XCTFail("OCR failed: \(error)")
            }
            expectation.fulfill()
        }
        
        waitForExpectations(timeout: 5.0)
    }
    
    func testTextRecognitionFromBlurryImage() {
        // Given
        let expectation = self.expectation(description: "OCR completion")
        guard let blurryImage = TestDataProvider.blurryLicenseImage() else {
            XCTFail("Failed to create blurry test image")
            return
        }
        
        // When
        textDetector.recognizeText(in: blurryImage) { result in
            switch result {
            case .success(let text):
                // Then - Should still attempt recognition but may have lower accuracy
                XCTAssertNotNil(text)
            case .failure:
                // Acceptable for very blurry images
                break
            }
            expectation.fulfill()
        }
        
        waitForExpectations(timeout: 5.0)
    }
    
    // MARK: - Quality Assessment Tests
    
    func testImageQualityAssessment() {
        // Given
        let qualityAssessor = OCRQualityAssessment()
        guard let clearImage = TestDataProvider.sampleLicenseFrontImage(),
              let blurryImage = TestDataProvider.blurryLicenseImage() else {
            XCTFail("Failed to create test images")
            return
        }
        
        // When
        let clearQuality = qualityAssessor.assessQuality(of: clearImage)
        let blurryQuality = qualityAssessor.assessQuality(of: blurryImage)
        
        // Then
        XCTAssertGreaterThan(clearQuality.overallScore, blurryQuality.overallScore)
        XCTAssertTrue(clearQuality.isAcceptable)
    }
    
    // MARK: - Document Detection Tests
    
    func testDocumentBoundaryDetection() {
        // Given
        let detector = DocumentDetector()
        guard let testImage = TestDataProvider.sampleLicenseFrontImage() else {
            XCTFail("Failed to create test image")
            return
        }
        
        // When
        let boundary = detector.detectDocumentBoundary(in: testImage)
        
        // Then
        XCTAssertNotNil(boundary)
        XCTAssertGreaterThan(boundary!.width, 0)
        XCTAssertGreaterThan(boundary!.height, 0)
    }
    
    // MARK: - Performance Tests
    
    func testOCRPerformance() {
        guard let testImage = TestDataProvider.sampleLicenseFrontImage() else {
            XCTFail("Failed to create test image")
            return
        }
        
        let expectation = self.expectation(description: "Performance test")
        
        measure {
            textDetector.recognizeText(in: testImage) { _ in
                expectation.fulfill()
            }
            
            wait(for: [expectation], timeout: 5.0)
        }
    }
    
    // MARK: - Error Handling Tests
    
    func testNilImageHandling() {
        // Given
        let expectation = self.expectation(description: "Error handling")
        let nilImage = UIImage() // Empty image
        
        // When
        textDetector.recognizeText(in: nilImage) { result in
            switch result {
            case .success:
                XCTFail("Should have failed with empty image")
            case .failure(let error):
                // Then
                XCTAssertNotNil(error)
            }
            expectation.fulfill()
        }
        
        waitForExpectations(timeout: 2.0)
    }
}