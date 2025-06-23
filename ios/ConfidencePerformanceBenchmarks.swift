import XCTest
import Vision
@testable import RnDlScan

/**
 * Performance benchmarks for Confidence Scoring and Error Correction
 * Ensures <50ms additional processing time requirement is met
 */
class ConfidencePerformanceBenchmarks: XCTestCase {
    
    private var parser: OCRFieldParser!
    private var confidenceCalculator: ConfidenceCalculator!
    private var errorCorrector: ErrorCorrector!
    
    override func setUp() {
        super.setUp()
        parser = OCRFieldParser()
        confidenceCalculator = ConfidenceCalculator()
        errorCorrector = ErrorCorrector()
    }
    
    override func tearDown() {
        parser = nil
        confidenceCalculator = nil
        errorCorrector = nil
        super.tearDown()
    }
    
    // MARK: - Baseline Performance Tests
    
    func testBaselineOCRParsing_withoutConfidenceSystem() {
        // This measures the baseline performance without confidence/error correction
        // to establish the overhead added by the new system
        
        // Given: Standard license observations
        let observations = createRealisticLicenseObservations()
        
        // When: Measuring baseline parsing time (multiple runs for accuracy)
        var baselineTimes: [TimeInterval] = []
        
        for _ in 0..<10 {
            let startTime = CFAbsoluteTimeGetCurrent()
            
            // Simulate basic parsing without confidence/error correction
            let normalizedObs = observations.map { obs in
                NormalizedTextObservation(
                    text: obs["text"] as? String ?? "",
                    confidence: obs["confidence"] as? Float ?? 0,
                    boundingBox: CGRect.zero
                )
            }
            
            // Basic field extraction simulation
            _ = extractFieldsBaseline(from: normalizedObs)
            
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            baselineTimes.append(processingTime)
        }
        
        let averageBaseline = baselineTimes.reduce(0, +) / Double(baselineTimes.count)
        
        print("Baseline OCR parsing average: \(averageBaseline * 1000)ms")
        XCTAssertLessThan(averageBaseline, 0.1, "Baseline should be fast")
    }
    
    func testFullSystem_withConfidenceAndErrorCorrection() {
        // Given: Standard license observations
        let observations = createRealisticLicenseObservations()
        
        // When: Measuring full system performance
        var fullSystemTimes: [TimeInterval] = []
        
        for _ in 0..<10 {
            let startTime = CFAbsoluteTimeGetCurrent()
            var error: NSError?
            _ = parser.parseOCRFields(from: observations, error: &error)
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            fullSystemTimes.append(processingTime)
        }
        
        let averageFullSystem = fullSystemTimes.reduce(0, +) / Double(fullSystemTimes.count)
        
        print("Full system average: \(averageFullSystem * 1000)ms")
        XCTAssertLessThan(averageFullSystem, 0.5, "Full system should complete in <500ms")
    }
    
    // MARK: - Component-Specific Performance Tests
    
    func testConfidenceCalculation_isolatedPerformance() {
        // Given: Extracted fields
        let fields = createExtractedFields(count: 15) // Typical license has ~15 fields
        let observations = createNormalizedObservations(count: 30)
        
        // When: Measuring confidence calculation only
        let measure = PerfTimer()
        
        for _ in 0..<100 {
            measure.start()
            _ = confidenceCalculator.calculateConfidenceScores(
                for: fields,
                from: observations
            )
            measure.stop()
        }
        
        // Then: Should add minimal overhead
        let avgTime = measure.averageTime
        print("Confidence calculation average: \(avgTime * 1000)ms")
        XCTAssertLessThan(avgTime, 0.025, "Confidence calculation should add <25ms")
    }
    
    func testErrorCorrection_isolatedPerformance() {
        // Given: Fields with OCR errors
        let fields = createFieldsWithOCRErrors(count: 15)
        let observations = createNormalizedObservations(count: 30)
        
        // When: Measuring error correction only
        let measure = PerfTimer()
        
        for _ in 0..<100 {
            measure.start()
            _ = errorCorrector.correctFields(
                fields,
                detectedState: "CA",
                from: observations
            )
            measure.stop()
        }
        
        // Then: Should add minimal overhead
        let avgTime = measure.averageTime
        print("Error correction average: \(avgTime * 1000)ms")
        XCTAssertLessThan(avgTime, 0.025, "Error correction should add <25ms")
    }
    
    // MARK: - Stress Tests
    
    func testStressTest_largeNumberOfFields() {
        // Given: Unusually large number of fields
        let fields = createExtractedFields(count: 50)
        let observations = createNormalizedObservations(count: 100)
        
        // When: Processing large dataset
        let startTime = CFAbsoluteTimeGetCurrent()
        
        let enhancedFields = confidenceCalculator.calculateConfidenceScores(
            for: fields,
            from: observations
        )
        
        let correctedFields = errorCorrector.correctFields(
            enhancedFields,
            detectedState: "CA",
            from: observations
        )
        
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        
        // Then: Should still meet performance requirements
        print("Large dataset processing: \(processingTime * 1000)ms for \(fields.count) fields")
        XCTAssertLessThan(processingTime, 0.1, "Should handle large datasets efficiently")
        XCTAssertEqual(correctedFields.count, fields.count)
    }
    
    func testStressTest_poorQualityOCR() {
        // Given: Low confidence OCR with many errors
        let observations = createPoorQualityObservations()
        
        // When: Processing poor quality data
        let measure = PerfTimer()
        
        for _ in 0..<10 {
            measure.start()
            var error: NSError?
            _ = parser.parseOCRFields(from: observations, error: &error)
            measure.stop()
        }
        
        // Then: Should maintain performance even with poor data
        let avgTime = measure.averageTime
        print("Poor quality OCR average: \(avgTime * 1000)ms")
        XCTAssertLessThan(avgTime, 0.5, "Should handle poor quality data within limits")
    }
    
    // MARK: - Memory Performance Tests
    
    func testMemoryPerformance_repeatedProcessing() {
        // Given: Standard observations
        let observations = createRealisticLicenseObservations()
        
        // Baseline memory
        let baselineMemory = getMemoryUsage()
        
        // When: Processing repeatedly
        for _ in 0..<100 {
            autoreleasepool {
                var error: NSError?
                _ = parser.parseOCRFields(from: observations, error: &error)
            }
        }
        
        // Then: Memory should not grow significantly
        let finalMemory = getMemoryUsage()
        let memoryGrowth = finalMemory - baselineMemory
        
        print("Memory growth after 100 iterations: \(memoryGrowth / 1024 / 1024)MB")
        XCTAssertLessThan(memoryGrowth, 50 * 1024 * 1024, "Memory growth should be minimal")
    }
    
    // MARK: - Comparative Performance Tests
    
    func testPerformanceComparison_confidenceSystemOverhead() {
        // This test measures the exact overhead added by confidence/error correction
        
        let observations = createRealisticLicenseObservations()
        let iterations = 50
        
        // Measure without confidence system (simulated)
        var withoutSystemTimes: [TimeInterval] = []
        for _ in 0..<iterations {
            let startTime = CFAbsoluteTimeGetCurrent()
            _ = simulateBasicOCRParsing(observations)
            withoutSystemTimes.append(CFAbsoluteTimeGetCurrent() - startTime)
        }
        
        // Measure with full confidence system
        var withSystemTimes: [TimeInterval] = []
        for _ in 0..<iterations {
            let startTime = CFAbsoluteTimeGetCurrent()
            var error: NSError?
            _ = parser.parseOCRFields(from: observations, error: &error)
            withSystemTimes.append(CFAbsoluteTimeGetCurrent() - startTime)
        }
        
        let avgWithout = withoutSystemTimes.reduce(0, +) / Double(iterations)
        let avgWith = withSystemTimes.reduce(0, +) / Double(iterations)
        let overhead = avgWith - avgWithout
        
        print("Performance comparison:")
        print("  Without confidence: \(avgWithout * 1000)ms")
        print("  With confidence: \(avgWith * 1000)ms")
        print("  Overhead: \(overhead * 1000)ms")
        
        XCTAssertLessThan(overhead, 0.05, "Confidence system should add <50ms overhead")
    }
    
    // MARK: - Real-World Scenario Tests
    
    func testRealWorldScenario_californiaLicense() {
        // Given: Real-world California license data
        let observations = createCaliforniaLicenseWithErrors()
        
        // When: Processing with full system
        let measure = PerfTimer()
        var results: [[String: Any]?] = []
        
        for _ in 0..<20 {
            measure.start()
            var error: NSError?
            let result = parser.parseOCRFields(from: observations, error: &error)
            results.append(result)
            measure.stop()
        }
        
        // Then: Verify performance and accuracy
        let avgTime = measure.averageTime
        print("California license average: \(avgTime * 1000)ms")
        XCTAssertLessThan(avgTime, 0.5, "Real-world processing should be <500ms")
        
        // Verify corrections were applied
        if let firstResult = results.first, let result = firstResult {
            XCTAssertEqual(result["licenseNumber"] as? String, "D1234567", "Should correct license number")
            XCTAssertEqual(result["firstName"] as? String, "JOHN", "Should correct first name")
        }
    }
    
    // MARK: - Helper Methods
    
    private func createRealisticLicenseObservations() -> [[String: Any]] {
        return [
            ["text": "CALIFORNIA", "confidence": Float(0.95), "boundingBox": ["x": 0.1, "y": 0.9, "width": 0.3, "height": 0.05]],
            ["text": "DRIVER LICENSE", "confidence": Float(0.92), "boundingBox": ["x": 0.1, "y": 0.85, "width": 0.3, "height": 0.05]],
            ["text": "DL D1234567", "confidence": Float(0.88), "boundingBox": ["x": 0.1, "y": 0.6, "width": 0.2, "height": 0.05]],
            ["text": "LN DOE", "confidence": Float(0.85), "boundingBox": ["x": 0.1, "y": 0.7, "width": 0.2, "height": 0.05]],
            ["text": "FN JOHN", "confidence": Float(0.87), "boundingBox": ["x": 0.1, "y": 0.65, "width": 0.2, "height": 0.05]],
            ["text": "DOB 01/15/1990", "confidence": Float(0.82), "boundingBox": ["x": 0.1, "y": 0.5, "width": 0.25, "height": 0.05]],
            ["text": "EXP 01/15/2026", "confidence": Float(0.83), "boundingBox": ["x": 0.1, "y": 0.45, "width": 0.25, "height": 0.05]],
            ["text": "SEX M", "confidence": Float(0.9), "boundingBox": ["x": 0.1, "y": 0.4, "width": 0.1, "height": 0.05]],
            ["text": "HGT 5-10", "confidence": Float(0.8), "boundingBox": ["x": 0.1, "y": 0.35, "width": 0.15, "height": 0.05]],
            ["text": "EYES BRN", "confidence": Float(0.78), "boundingBox": ["x": 0.1, "y": 0.3, "width": 0.15, "height": 0.05]],
            ["text": "123 MAIN ST", "confidence": Float(0.75), "boundingBox": ["x": 0.1, "y": 0.2, "width": 0.3, "height": 0.05]]
        ]
    }
    
    private func createCaliforniaLicenseWithErrors() -> [[String: Any]] {
        return [
            ["text": "CALIFORNIA", "confidence": Float(0.95), "boundingBox": ["x": 0.1, "y": 0.9, "width": 0.3, "height": 0.05]],
            ["text": "DRIVER LICENSE", "confidence": Float(0.92), "boundingBox": ["x": 0.1, "y": 0.85, "width": 0.3, "height": 0.05]],
            ["text": "DL DI23456O", "confidence": Float(0.75), "boundingBox": ["x": 0.1, "y": 0.6, "width": 0.2, "height": 0.05]], // OCR errors
            ["text": "LN D0E", "confidence": Float(0.7), "boundingBox": ["x": 0.1, "y": 0.7, "width": 0.2, "height": 0.05]], // OCR error
            ["text": "FN J0HN", "confidence": Float(0.72), "boundingBox": ["x": 0.1, "y": 0.65, "width": 0.2, "height": 0.05]], // OCR error
            ["text": "DOB O1/15/199O", "confidence": Float(0.68), "boundingBox": ["x": 0.1, "y": 0.5, "width": 0.25, "height": 0.05]], // OCR errors
            ["text": "SEX M", "confidence": Float(0.9), "boundingBox": ["x": 0.1, "y": 0.4, "width": 0.1, "height": 0.05]]
        ]
    }
    
    private func createPoorQualityObservations() -> [[String: Any]] {
        var observations: [[String: Any]] = []
        
        // Simulate poor quality OCR with low confidence and errors
        for i in 0..<30 {
            observations.append([
                "text": "T3XT\(i)W1TH3RR0R5", // Lots of OCR errors
                "confidence": Float.random(in: 0.3...0.6), // Low confidence
                "boundingBox": ["x": Double.random(in: 0...0.8), "y": Double.random(in: 0...0.8), "width": 0.2, "height": 0.05]
            ])
        }
        
        return observations
    }
    
    private func createExtractedFields(count: Int) -> [String: FieldExtractionResult] {
        var fields: [String: FieldExtractionResult] = [:]
        let fieldNames = ["firstName", "lastName", "licenseNumber", "dateOfBirth", "address",
                         "expirationDate", "issueDate", "sex", "height", "weight",
                         "eyeColor", "hairColor", "licenseClass", "restrictions", "endorsements"]
        
        for i in 0..<min(count, fieldNames.count) {
            fields[fieldNames[i]] = FieldExtractionResult(
                value: "VALUE\(i)",
                confidence: Float.random(in: 0.7...0.95),
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.1, y: Double(i) * 0.05, width: 0.2, height: 0.05)
            )
        }
        
        return fields
    }
    
    private func createFieldsWithOCRErrors(count: Int) -> [String: FieldExtractionResult] {
        var fields: [String: FieldExtractionResult] = [:]
        let fieldNames = ["firstName", "lastName", "licenseNumber", "dateOfBirth", "address"]
        let errorPatterns = ["0", "1", "5", "8", "6"] // Common OCR confusion characters
        
        for i in 0..<min(count, fieldNames.count) {
            let value = "VALUE\(errorPatterns.randomElement()!)\(i)"
            fields[fieldNames[i]] = FieldExtractionResult(
                value: value,
                confidence: Float.random(in: 0.6...0.8),
                extractionMethod: .patternMatching,
                boundingBox: CGRect(x: 0.1, y: Double(i) * 0.05, width: 0.2, height: 0.05)
            )
        }
        
        return fields
    }
    
    private func createNormalizedObservations(count: Int) -> [NormalizedTextObservation] {
        return (0..<count).map { i in
            NormalizedTextObservation(
                text: "TEXT\(i)",
                confidence: Float.random(in: 0.7...0.95),
                boundingBox: CGRect(x: Double.random(in: 0...0.8), y: Double.random(in: 0...0.8), width: 0.2, height: 0.05)
            )
        }
    }
    
    private func extractFieldsBaseline(from observations: [NormalizedTextObservation]) -> [String: String] {
        // Simulate basic field extraction without confidence/error correction
        var fields: [String: String] = [:]
        
        for obs in observations {
            if obs.text.contains("FN") {
                fields["firstName"] = obs.text.replacingOccurrences(of: "FN ", with: "")
            } else if obs.text.contains("LN") {
                fields["lastName"] = obs.text.replacingOccurrences(of: "LN ", with: "")
            } else if obs.text.contains("DL") {
                fields["licenseNumber"] = obs.text.replacingOccurrences(of: "DL ", with: "")
            }
        }
        
        return fields
    }
    
    private func simulateBasicOCRParsing(_ observations: [[String: Any]]) -> [String: Any] {
        // Simulate basic parsing without confidence/error correction
        var result: [String: Any] = [:]
        
        for obs in observations {
            if let text = obs["text"] as? String {
                if text.contains("FN") {
                    result["firstName"] = text.replacingOccurrences(of: "FN ", with: "")
                } else if text.contains("LN") {
                    result["lastName"] = text.replacingOccurrences(of: "LN ", with: "")
                }
            }
        }
        
        result["extractionMethod"] = "OCR"
        return result
    }
    
    private func getMemoryUsage() -> Int64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_,
                         task_flavor_t(MACH_TASK_BASIC_INFO),
                         $0,
                         &count)
            }
        }
        
        return result == KERN_SUCCESS ? Int64(info.resident_size) : 0
    }
}

// MARK: - Performance Timer Helper

private class PerfTimer {
    private var measurements: [TimeInterval] = []
    private var startTime: CFAbsoluteTime = 0
    
    func start() {
        startTime = CFAbsoluteTimeGetCurrent()
    }
    
    func stop() {
        let elapsed = CFAbsoluteTimeGetCurrent() - startTime
        measurements.append(elapsed)
    }
    
    var averageTime: TimeInterval {
        guard !measurements.isEmpty else { return 0 }
        return measurements.reduce(0, +) / Double(measurements.count)
    }
    
    var minTime: TimeInterval {
        return measurements.min() ?? 0
    }
    
    var maxTime: TimeInterval {
        return measurements.max() ?? 0
    }
    
    func reset() {
        measurements.removeAll()
    }
}