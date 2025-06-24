import Foundation
import Vision
@testable import DlScan

// MARK: - Mock Delegates

/// Mock delegate for testing async callbacks
class MockScannerDelegate {
    var scanCompletedCalled = false
    var scanFailedCalled = false
    var lastResult: [String: Any]?
    var lastError: Error?
    
    private let expectation: XCTestExpectation?
    
    init(expectation: XCTestExpectation? = nil) {
        self.expectation = expectation
    }
    
    func scanCompleted(result: [String: Any]) {
        scanCompletedCalled = true
        lastResult = result
        expectation?.fulfill()
    }
    
    func scanFailed(error: Error) {
        scanFailedCalled = true
        lastError = error
        expectation?.fulfill()
    }
}

// MARK: - Mock Vision Request

/// Mock VNRecognizeTextRequest for testing OCR
class MockTextRecognitionRequest: VNRecognizeTextRequest {
    var shouldSucceed = true
    var mockResults: [VNRecognizedTextObservation] = []
    
    override func perform(_ requests: [VNRequest]) throws {
        if shouldSucceed {
            // Return mock results
            self.results = mockResults
        } else {
            throw NSError(domain: "MockError", code: 1, userInfo: nil)
        }
    }
}

// MARK: - Mock Barcode Detector

/// Mock barcode detector for testing
class MockBarcodeDetector {
    var shouldFindBarcode = true
    var mockBarcodeData = TestDataProvider.validPDF417Data()
    var scanCallCount = 0
    
    func detectBarcode(in pixelBuffer: CVPixelBuffer) -> String? {
        scanCallCount += 1
        return shouldFindBarcode ? mockBarcodeData : nil
    }
}

// MARK: - Test Extensions

extension XCTestCase {
    /// Wait for async operation with timeout
    func waitForExpectations(timeout: TimeInterval = 2.0) {
        waitForExpectations(timeout: timeout) { error in
            if let error = error {
                XCTFail("Expectation failed with error: \(error)")
            }
        }
    }
    
    /// Create expectation with description
    func expectation(description: String) -> XCTestExpectation {
        return self.expectation(description: description)
    }
}

// MARK: - Performance Testing Helpers

/// Measures performance of a block
class PerformanceMeasurer {
    private var measurements: [String: [TimeInterval]] = [:]
    
    func measure(label: String, block: () throws -> Void) rethrows {
        let start = CFAbsoluteTimeGetCurrent()
        try block()
        let end = CFAbsoluteTimeGetCurrent()
        
        let duration = end - start
        if measurements[label] == nil {
            measurements[label] = []
        }
        measurements[label]?.append(duration)
    }
    
    func averageTime(for label: String) -> TimeInterval? {
        guard let times = measurements[label], !times.isEmpty else { return nil }
        return times.reduce(0, +) / Double(times.count)
    }
    
    func report() -> String {
        var report = "Performance Report:\n"
        for (label, times) in measurements {
            let average = times.reduce(0, +) / Double(times.count)
            let min = times.min() ?? 0
            let max = times.max() ?? 0
            report += "\(label): avg=\(average)s, min=\(min)s, max=\(max)s\n"
        }
        return report
    }
}