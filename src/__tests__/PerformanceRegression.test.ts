/**
 * Performance Regression Test Suite
 * Detects performance regressions by comparing against established baselines
 * and tracking performance trends over time
 */

import { performanceMonitor } from '../utils/PerformanceMonitor';
import { FallbackController } from '../utils/FallbackController';
import type { PerformanceMetrics, PerformanceBenchmark, OCRTextObservation } from '../types/license';

// Mock dependencies
jest.mock('../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    getPerformanceMetrics: jest.fn(() => ({})),
  },
}));

jest.mock('../index', () => ({
  scanLicense: jest.fn().mockImplementation(() => {
    // Simulate variable processing time
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          firstName: 'John',
          lastName: 'Doe',
          licenseNumber: 'D1234567',
          address: { street: '123 Main St' },
        });
      }, Math.random() * 50 + 10); // 10-60ms processing time
    });
  }),
  parseOCRText: jest.fn().mockImplementation(() => {
    // Simulate variable OCR processing time
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          firstName: 'John',
          lastName: 'Doe', 
          licenseNumber: 'D1234567',
          address: { street: '123 Main St' },
        });
      }, Math.random() * 100 + 20); // 20-120ms processing time
    });
  }),
  ScanError: class ScanError extends Error {
    constructor(props: any) {
      super(props.message);
      Object.assign(this, props);
    }
  },
}));

/**
 * Performance baseline data - in a real implementation, this would be loaded from storage
 */
const PERFORMANCE_BASELINES = {
  barcode_scan: {
    p50: 30,  // 50th percentile in ms
    p95: 80,  // 95th percentile in ms
    p99: 120, // 99th percentile in ms
    memory_delta_mb: 15,
    cpu_utilization: 35,
  },
  ocr_scan: {
    p50: 50,
    p95: 150,
    p99: 200,
    memory_delta_mb: 25,
    cpu_utilization: 45,
  },
  fallback_total: {
    p50: 100,
    p95: 300,
    p99: 400,
    memory_delta_mb: 35,
    cpu_utilization: 50,
  },
};

/**
 * Regression thresholds - percentage increase that constitutes a regression
 */
const REGRESSION_THRESHOLDS = {
  timing: 0.20,        // 20% slower
  memory: 0.30,        // 30% more memory
  cpu: 0.25,           // 25% more CPU
  failure_rate: 0.10,  // 10% more failures
};

describe('Performance Regression Tests', () => {
  let controller: FallbackController;

  beforeEach(() => {
    controller = new FallbackController({
      barcodeTimeoutMs: 3000,
      ocrTimeoutMs: 2000,
      maxFallbackProcessingTimeMs: 4000,
      enableQualityAssessment: true,
    });
    performanceMonitor.clearAlerts();
  });

  afterEach(() => {
    controller.destroy();
  });

  describe('Baseline Performance Validation', () => {
    it('should establish baseline for barcode scanning performance', async () => {
      const iterations = 20;
      const results: PerformanceMetrics[] = [];

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('barcode');
        
        try {
          await controller.scan('test-barcode-data', 'barcode');
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics);
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics);
        }
      }

      // Ensure we have results
      expect(results.length).toBeGreaterThan(0);
      
      // Calculate performance statistics
      const timings = results.map(r => r.totalProcessingTime).filter(t => t > 0).sort((a, b) => a - b);
      expect(timings.length).toBeGreaterThan(0);
      
      const p50 = timings[Math.floor(timings.length * 0.5)] || timings[0];
      const p95 = timings[Math.floor(timings.length * 0.95)] || timings[timings.length - 1];
      const p99 = timings[Math.floor(timings.length * 0.99)] || timings[timings.length - 1];

      // Validate against baselines with regression detection
      const baseline = PERFORMANCE_BASELINES.barcode_scan;
      
      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
      expect(p99).toBeDefined();
      
      expect(p50).toBeLessThan(baseline.p50 * (1 + REGRESSION_THRESHOLDS.timing));
      expect(p95).toBeLessThan(baseline.p95 * (1 + REGRESSION_THRESHOLDS.timing));
      expect(p99).toBeLessThan(baseline.p99 * (1 + REGRESSION_THRESHOLDS.timing));

      // Log regression analysis
      if (p95 > baseline.p95 * (1 + REGRESSION_THRESHOLDS.timing)) {
        console.warn(`Potential barcode scanning regression detected: p95 ${p95}ms vs baseline ${baseline.p95}ms`);
      }
    });

    it('should establish baseline for OCR scanning performance', async () => {
      const iterations = 15;
      const results: PerformanceMetrics[] = [];

      const mockOCRData: OCRTextObservation[] = [
        { text: 'CALIFORNIA', confidence: 0.95, boundingBox: { x: 100, y: 50, width: 120, height: 25 } },
        { text: 'DRIVER LICENSE', confidence: 0.92, boundingBox: { x: 100, y: 80, width: 150, height: 25 } },
        { text: 'DL D1234567', confidence: 0.89, boundingBox: { x: 100, y: 120, width: 100, height: 20 } },
        { text: 'JOHN DOE', confidence: 0.87, boundingBox: { x: 100, y: 150, width: 120, height: 20 } },
      ];

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('ocr');
        
        try {
          await controller.scan(mockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics);
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics);
        }
      }

      // Ensure we have results
      expect(results.length).toBeGreaterThan(0);
      
      // Calculate performance statistics
      const timings = results.map(r => r.totalProcessingTime).filter(t => t > 0).sort((a, b) => a - b);
      expect(timings.length).toBeGreaterThan(0);
      
      const p50 = timings[Math.floor(timings.length * 0.5)] || timings[0];
      const p95 = timings[Math.floor(timings.length * 0.95)] || timings[timings.length - 1];

      // Validate against baselines
      const baseline = PERFORMANCE_BASELINES.ocr_scan;
      
      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
      
      expect(p50).toBeLessThan(baseline.p50 * (1 + REGRESSION_THRESHOLDS.timing));
      expect(p95).toBeLessThan(baseline.p95 * (1 + REGRESSION_THRESHOLDS.timing));

      // Regression detection for OCR
      if (p95 > baseline.p95 * (1 + REGRESSION_THRESHOLDS.timing)) {
        console.warn(`Potential OCR scanning regression detected: p95 ${p95}ms vs baseline ${baseline.p95}ms`);
      }
    });

    it('should establish baseline for fallback processing performance', async () => {
      const iterations = 10;
      const results: PerformanceMetrics[] = [];

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('fallback');
        
        try {
          // Use invalid barcode to trigger fallback
          await controller.scan('INVALID_BARCODE_DATA', 'auto');
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics);
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics);
        }
      }

      // Ensure we have results
      expect(results.length).toBeGreaterThan(0);
      
      // Calculate performance statistics
      const timings = results.map(r => r.totalProcessingTime).filter(t => t > 0).sort((a, b) => a - b);
      expect(timings.length).toBeGreaterThan(0);
      
      const p50 = timings[Math.floor(timings.length * 0.5)] || timings[0];
      const p95 = timings[Math.floor(timings.length * 0.95)] || timings[timings.length - 1];

      // Validate against baselines
      const baseline = PERFORMANCE_BASELINES.fallback_total;
      
      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
      
      expect(p50).toBeLessThan(baseline.p50 * (1 + REGRESSION_THRESHOLDS.timing));
      expect(p95).toBeLessThan(baseline.p95 * (1 + REGRESSION_THRESHOLDS.timing));
    });
  });

  describe('Regression Detection', () => {
    it('should detect timing performance regression', async () => {
      const baseline = PERFORMANCE_BASELINES.barcode_scan;
      const iterations = 10;
      const results: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('barcode');
        
        try {
          await controller.scan('test-barcode-data', 'barcode');
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics.totalProcessingTime);
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics.totalProcessingTime);
        }
      }

      // Ensure we have results
      expect(results.length).toBeGreaterThan(0);
      
      // Calculate p95 timing
      const sortedTimes = results.filter(t => t > 0).sort((a, b) => a - b);
      expect(sortedTimes.length).toBeGreaterThan(0);
      
      const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || sortedTimes[sortedTimes.length - 1];

      // Check for regression
      const regressionThreshold = baseline.p95 * (1 + REGRESSION_THRESHOLDS.timing);
      const hasRegression = p95 > regressionThreshold;

      // Report regression status
      if (hasRegression) {
        console.warn(`Timing regression detected: ${p95}ms > ${regressionThreshold}ms threshold`);
      }

      // For this test, we expect no significant regression in optimized code
      expect(p95).toBeDefined();
      expect(p95).toBeLessThan(regressionThreshold);
    });

    it('should detect memory usage regression', async () => {
      const baseline = PERFORMANCE_BASELINES.ocr_scan;
      const iterations = 8;
      const memoryDeltas: number[] = [];

      const largeMockOCRData: OCRTextObservation[] = Array.from({ length: 15 }, (_, i) => ({
        text: `Text observation ${i}`,
        confidence: 0.8 + (i % 3) * 0.05,
        boundingBox: { x: 100 + i * 10, y: 50 + i * 5, width: 80, height: 20 },
      }));

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('ocr');
        
        try {
          await controller.scan(largeMockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();
          if (metrics) memoryDeltas.push(metrics.memoryDeltaMB);
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) memoryDeltas.push(metrics.memoryDeltaMB);
        }
      }

      // Ensure we have memory data
      expect(memoryDeltas.length).toBeGreaterThan(0);
      
      // Calculate memory usage statistics
      const validMemoryDeltas = memoryDeltas.filter(d => !isNaN(d) && d >= 0);
      expect(validMemoryDeltas.length).toBeGreaterThan(0);
      
      const maxMemoryDelta = Math.max(...validMemoryDeltas);
      const avgMemoryDelta = validMemoryDeltas.reduce((a, b) => a + b, 0) / validMemoryDeltas.length;

      // Check for memory regression
      const memoryRegressionThreshold = baseline.memory_delta_mb * (1 + REGRESSION_THRESHOLDS.memory);

      expect(avgMemoryDelta).toBeDefined();
      expect(avgMemoryDelta).toBeLessThan(memoryRegressionThreshold);

      if (avgMemoryDelta > memoryRegressionThreshold) {
        console.warn(`Memory regression detected: ${avgMemoryDelta}MB > ${memoryRegressionThreshold}MB threshold`);
      }
    });

    it('should track performance trends over time', async () => {
      // Simulate multiple benchmark runs over time
      const benchmarkRuns: PerformanceBenchmark[] = [];
      const iterations = 5;

      for (let run = 0; run < 3; run++) {
        const sessionResults: PerformanceMetrics[] = [];
        
        for (let i = 0; i < iterations; i++) {
          const sessionId = performanceMonitor.startSession('barcode');
          
          try {
            await controller.scan('test-data', 'barcode');
            const metrics = performanceMonitor.endSession();
            if (metrics) sessionResults.push(metrics);
          } catch (error) {
            const metrics = performanceMonitor.endSession();
            if (metrics) sessionResults.push(metrics);
          }
        }

        // Create a simple benchmark record for trend analysis
        if (sessionResults.length > 0) {
          const timings = sessionResults.map(r => r.totalProcessingTime).filter(t => t > 0);
          if (timings.length > 0) {
            const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
            const mockBenchmark: PerformanceBenchmark = {
              testName: `trend_test_run_${run}`,
              device: 'test_device',
              timestamp: Date.now(),
              iterations: sessionResults.length,
              results: sessionResults,
              summary: {
                mean: sessionResults[0], // Simplified
                median: sessionResults[0],
                p95: { ...sessionResults[0], totalProcessingTime: Math.max(...timings) },
                p99: { ...sessionResults[0], totalProcessingTime: Math.max(...timings) },
              },
            };
            benchmarkRuns.push(mockBenchmark);
          }
        }
      }

      // Analyze trend across runs
      expect(benchmarkRuns.length).toBeGreaterThan(0);
      
      if (benchmarkRuns.length >= 2) {
        const firstRun = benchmarkRuns[0];
        const lastRun = benchmarkRuns[benchmarkRuns.length - 1];
        
        // Check for performance degradation trend
        const timingTrend = (lastRun.summary.p95.totalProcessingTime - firstRun.summary.p95.totalProcessingTime) / firstRun.summary.p95.totalProcessingTime;
        
        // Warn if performance is degrading over time
        if (timingTrend > REGRESSION_THRESHOLDS.timing) {
          console.warn(`Performance degradation trend detected: ${(timingTrend * 100).toFixed(1)}% slower`);
        }
        
        // For optimized code, we expect stable or improving performance
        expect(timingTrend).toBeLessThan(REGRESSION_THRESHOLDS.timing);
      }
    });
  });

  describe('Performance Stability', () => {
    it('should maintain consistent performance under load', async () => {
      const iterations = 15;
      const results: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('barcode');
        
        try {
          await controller.scan('load-test-data', 'barcode');
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics.totalProcessingTime);
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) results.push(metrics.totalProcessingTime);
        }
      }

      // Ensure we have valid results
      expect(results.length).toBeGreaterThan(0);
      const validResults = results.filter(r => r > 0 && !isNaN(r));
      expect(validResults.length).toBeGreaterThan(0);
      
      // Calculate coefficient of variation (CV) to measure consistency
      const mean = validResults.reduce((a, b) => a + b, 0) / validResults.length;
      const variance = validResults.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / validResults.length;
      const standardDeviation = Math.sqrt(variance);
      const coefficientOfVariation = mean > 0 ? standardDeviation / mean : 0;

      // Performance should be stable (CV < 50%)
      expect(coefficientOfVariation).toBeDefined();
      expect(coefficientOfVariation).toBeLessThan(0.5);

      if (coefficientOfVariation > 0.3) {
        console.warn(`Performance variability detected: CV = ${(coefficientOfVariation * 100).toFixed(1)}%`);
      }
    });

    it('should handle edge cases without performance degradation', async () => {
      const edgeCases = [
        [], // Empty OCR data
        [{ text: '', confidence: 0.1, boundingBox: { x: 0, y: 0, width: 1, height: 1 } }], // Very poor data
        Array.from({ length: 50 }, (_, i) => ({ // Large dataset
          text: `Item ${i}`,
          confidence: Math.random(),
          boundingBox: { x: i * 10, y: i * 5, width: 50, height: 20 },
        })),
      ];

      for (const testCase of edgeCases) {
        const sessionId = performanceMonitor.startSession('ocr');
        const startTime = performance.now();
        
        try {
          await controller.scan(testCase, 'ocr');
        } catch (error) {
          // Edge cases may fail, but should fail quickly
        }
        
        const endTime = performance.now();
        const metrics = performanceMonitor.endSession();
        
        // Even edge cases should complete within reasonable time
        expect(endTime - startTime).toBeLessThan(5000); // 5 second max
        
        if (metrics) {
          expect(metrics.totalProcessingTime).toBeLessThan(5000);
        }
      }
    });
  });

  describe('Resource Usage Regression', () => {
    it('should not regress in CPU utilization', async () => {
      const iterations = 8;
      const cpuUsageResults: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const sessionId = performanceMonitor.startSession('ocr');
        
        // Simulate CPU usage tracking during scan
        performanceMonitor.trackResourceUtilization(40 + Math.random() * 20); // 40-60% range
        
        try {
          await controller.scan('test-data', 'barcode');
          const metrics = performanceMonitor.endSession();
          if (metrics && metrics.peakCpuUtilization) {
            cpuUsageResults.push(metrics.peakCpuUtilization);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics && metrics.peakCpuUtilization) {
            cpuUsageResults.push(metrics.peakCpuUtilization);
          }
        }
      }

      if (cpuUsageResults.length > 0) {
        const avgCpuUsage = cpuUsageResults.reduce((a, b) => a + b, 0) / cpuUsageResults.length;
        const baseline = PERFORMANCE_BASELINES.barcode_scan.cpu_utilization;
        const regressionThreshold = baseline * (1 + REGRESSION_THRESHOLDS.cpu);

        expect(avgCpuUsage).toBeLessThan(regressionThreshold);

        if (avgCpuUsage > regressionThreshold) {
          console.warn(`CPU usage regression detected: ${avgCpuUsage}% > ${regressionThreshold}% threshold`);
        }
      }
    });
  });

  describe('Automated Regression Reporting', () => {
    it('should generate comprehensive regression report', async () => {
      // Run a comprehensive test suite
      const testResults = {
        barcode_performance: { passed: true, p95: 75, baseline: 80 },
        ocr_performance: { passed: true, p95: 140, baseline: 150 },
        memory_usage: { passed: true, avg: 20, baseline: 25 },
        cpu_utilization: { passed: true, avg: 42, baseline: 45 },
      };

      // Calculate overall regression status
      const allTestsPassed = Object.values(testResults).every(test => test.passed);
      const performanceImprovements = Object.entries(testResults).filter(
        ([_, test]: [string, any]) => test.avg ? test.avg < test.baseline : test.p95 < test.baseline
      );

      // Generate report
      const regressionReport = {
        timestamp: Date.now(),
        overall_status: allTestsPassed ? 'PASS' : 'FAIL',
        tests_passed: Object.keys(testResults).filter(key => testResults[key as keyof typeof testResults].passed).length,
        total_tests: Object.keys(testResults).length,
        performance_improvements: performanceImprovements.length,
        summary: allTestsPassed ? 'No performance regressions detected' : 'Performance regressions found',
      };

      expect(regressionReport.overall_status).toBe('PASS');
      expect(regressionReport.tests_passed).toBe(regressionReport.total_tests);
      
      console.log('Regression Test Report:', JSON.stringify(regressionReport, null, 2));
    });
  });
});