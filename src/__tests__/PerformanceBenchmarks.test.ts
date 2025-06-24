import { FallbackController } from '../utils/FallbackController';
import { performanceMonitor } from '../utils/PerformanceMonitor';
import type { PerformanceMetrics, OCRTextObservation } from '../types/license';

/**
 * Performance Benchmarking Test Suite
 * Validates OCR <2s, Fallback <4s, Memory <50MB, CPU <60% targets
 */
describe('Performance Benchmarks', () => {
  let controller: FallbackController;
  const performanceTargets = {
    ocrProcessingMs: 2000,
    fallbackProcessingMs: 4000,
    memoryDeltaMB: 50,
    cpuUtilizationPercent: 60,
  };

  beforeEach(() => {
    controller = new FallbackController({
      barcodeTimeoutMs: 3000,
      ocrTimeoutMs: 2000,
      maxFallbackProcessingTimeMs: 4000,
      enableQualityAssessment: true,
    });

    // Clear previous performance data
    performanceMonitor.clearAlerts();
  });

  afterEach(() => {
    controller.destroy();
  });

  describe('OCR Performance Targets', () => {
    /**
     * Test OCR processing meets <2 second target (95th percentile)
     */
    it('should complete OCR processing in <2 seconds (95th percentile)', async () => {
      const iterations = 20;
      const results: PerformanceMetrics[] = [];

      const mockOCRData = generateHighQualityOCRData();

      for (let i = 0; i < iterations; i++) {
        performanceMonitor.startSession('ocr');

        try {
          await controller.scan(mockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();

          if (metrics) {
            results.push(metrics);
          }
        } catch (error) {
          // Continue test even if scan fails
          const metrics = performanceMonitor.endSession();
          if (metrics) {
            results.push(metrics);
          }
        }
      }

      // Calculate 95th percentile
      const sortedTimes = results
        .map((r) => r.ocrProcessingTime || 0)
        .sort((a, b) => a - b);

      const p95Index = Math.floor(iterations * 0.95);
      const p95Time = sortedTimes[p95Index];

      expect(p95Time).toBeLessThan(performanceTargets.ocrProcessingMs);
      expect(
        results.filter((r) => r.meetsOcrTarget).length / results.length
      ).toBeGreaterThan(0.95); // 95% should meet target
    });

    /**
     * Test OCR processing under stress (poor quality data)
     */
    it('should handle poor quality OCR data within performance limits', async () => {
      const mockPoorOCRData = generatePoorQualityOCRData();

      performanceMonitor.startSession('ocr');

      try {
        await controller.scan(mockPoorOCRData, 'ocr');
      } catch (error) {
        // Expected to fail with poor data, but should still meet timing
      }

      const metrics = performanceMonitor.endSession();

      expect(metrics).toBeDefined();
      if (metrics) {
        // Even with poor data, should not exceed timeout
        expect(metrics.ocrProcessingTime || 0).toBeLessThan(2500); // 500ms grace period
      }
    });
  });

  describe('Fallback Performance Targets', () => {
    /**
     * Test total fallback process meets <4 second target (95th percentile)
     */
    it('should complete fallback process in <4 seconds (95th percentile)', async () => {
      const iterations = 15;
      const results: PerformanceMetrics[] = [];

      const invalidBarcodeData = 'INVALID_BARCODE_DATA';

      for (let i = 0; i < iterations; i++) {
        performanceMonitor.startSession('fallback');

        try {
          await controller.scan(invalidBarcodeData, 'auto');
          const metrics = performanceMonitor.endSession();

          if (metrics) {
            results.push(metrics);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) {
            results.push(metrics);
          }
        }
      }

      // Calculate 95th percentile
      const sortedTimes = results
        .map((r) => r.totalProcessingTime)
        .sort((a, b) => a - b);

      const p95Index = Math.floor(iterations * 0.95);
      const p95Time = sortedTimes[p95Index];

      expect(p95Time).toBeLessThan(performanceTargets.fallbackProcessingMs);
      expect(
        results.filter((r) => r.meetsFallbackTarget).length / results.length
      ).toBeGreaterThan(0.9); // 90% should meet target (allowing some variance for fallback)
    });

    /**
     * Test mode transition time meets <200ms requirement
     */
    it('should complete mode transitions in <200ms', async () => {
      const iterations = 10;
      const transitionTimes: number[] = [];

      const invalidBarcodeData = 'INVALID_BARCODE_DATA';

      for (let i = 0; i < iterations; i++) {
        performanceMonitor.startSession('fallback');

        try {
          await controller.scan(invalidBarcodeData, 'auto');
          const metrics = performanceMonitor.endSession();

          if (metrics && metrics.modeTransitionTime) {
            transitionTimes.push(metrics.modeTransitionTime);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics && metrics.modeTransitionTime) {
            transitionTimes.push(metrics.modeTransitionTime);
          }
        }
      }

      // All transitions should be under 200ms
      transitionTimes.forEach((time) => {
        expect(time).toBeLessThan(200);
      });

      // Average should be well under 200ms
      const averageTransitionTime =
        transitionTimes.reduce((a, b) => a + b, 0) / transitionTimes.length;
      expect(averageTransitionTime).toBeLessThan(100);
    });
  });

  describe('Memory Performance Targets', () => {
    /**
     * Test memory usage increase during fallback is <50MB
     */
    it('should limit memory increase to <50MB during fallback', async () => {
      const iterations = 5;
      const memoryDeltas: number[] = [];

      const invalidBarcodeData = 'INVALID_BARCODE_DATA';

      for (let i = 0; i < iterations; i++) {
        performanceMonitor.startSession('fallback');

        try {
          await controller.scan(invalidBarcodeData, 'auto');
          const metrics = performanceMonitor.endSession();

          if (metrics) {
            memoryDeltas.push(metrics.memoryDeltaMB);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) {
            memoryDeltas.push(metrics.memoryDeltaMB);
          }
        }
      }

      // All memory deltas should be under 50MB
      memoryDeltas.forEach((delta) => {
        expect(delta).toBeLessThan(performanceTargets.memoryDeltaMB);
      });

      // Average should be reasonable
      const averageMemoryDelta =
        memoryDeltas.reduce((a, b) => a + b, 0) / memoryDeltas.length;
      expect(averageMemoryDelta).toBeLessThan(30); // Well under target
    });

    /**
     * Test memory cleanup after multiple scans
     */
    it('should maintain stable memory usage across multiple scans', async () => {
      const iterations = 10;
      const finalMemoryUsages: number[] = [];

      const mockOCRData = generateHighQualityOCRData();

      for (let i = 0; i < iterations; i++) {
        performanceMonitor.startSession('ocr');

        try {
          await controller.scan(mockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();

          if (metrics) {
            finalMemoryUsages.push(metrics.finalMemoryUsageMB);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) {
            finalMemoryUsages.push(metrics.finalMemoryUsageMB);
          }
        }
      }

      // Memory should not continuously grow
      const firstHalf = finalMemoryUsages.slice(0, 5);
      const secondHalf = finalMemoryUsages.slice(5);

      const firstHalfAvg =
        firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondHalfAvg =
        secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      // Memory growth should be minimal
      const memoryGrowth = secondHalfAvg - firstHalfAvg;
      expect(memoryGrowth).toBeLessThan(20); // <20MB growth acceptable
    });
  });

  describe('CPU Utilization Targets', () => {
    /**
     * Test CPU utilization stays below 60% during peak processing
     */
    it('should maintain CPU utilization below 60% during processing', async () => {
      const iterations = 5;
      const peakCpuUsages: number[] = [];

      const mockOCRData = generateHighQualityOCRData();

      for (let i = 0; i < iterations; i++) {
        performanceMonitor.startSession('ocr');

        try {
          await controller.scan(mockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();

          if (metrics && metrics.peakCpuUtilization) {
            peakCpuUsages.push(metrics.peakCpuUtilization);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics && metrics.peakCpuUtilization) {
            peakCpuUsages.push(metrics.peakCpuUtilization);
          }
        }
      }

      // All peak CPU usages should be under 60%
      peakCpuUsages.forEach((usage) => {
        expect(usage).toBeLessThan(performanceTargets.cpuUtilizationPercent);
      });

      // Average should be well under target
      const averageCpuUsage =
        peakCpuUsages.reduce((a, b) => a + b, 0) / peakCpuUsages.length;
      expect(averageCpuUsage).toBeLessThan(45); // Well under 60% target
    });
  });

  describe('Regression Detection', () => {
    /**
     * Test performance regression detection
     */
    it('should detect performance regressions', async () => {
      // Run baseline performance
      const baselineResults: PerformanceMetrics[] = [];
      const mockOCRData = generateHighQualityOCRData();

      for (let i = 0; i < 10; i++) {
        performanceMonitor.startSession('ocr');

        try {
          await controller.scan(mockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();

          if (metrics) {
            baselineResults.push(metrics);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) {
            baselineResults.push(metrics);
          }
        }
      }

      // Generate benchmark report
      const benchmarkReport = performanceMonitor.generateBenchmarkReport(
        'ocr_baseline',
        10
      );

      expect(benchmarkReport).toBeDefined();
      if (benchmarkReport) {
        expect(benchmarkReport.results.length).toBeGreaterThan(0);
        expect(benchmarkReport.summary).toBeDefined();

        // Check if any regressions detected
        const hasRegressions = benchmarkReport.regressionDetected;

        // Log performance summary for analysis
        console.log('Performance Benchmark Summary:', {
          testName: benchmarkReport.testName,
          iterations: benchmarkReport.iterations,
          regressionDetected: hasRegressions,
          p95Time: benchmarkReport.summary.p95.totalProcessingTime,
          targetsP95: {
            ocr: benchmarkReport.summary.p95.meetsOcrTarget,
            fallback: benchmarkReport.summary.p95.meetsFallbackTarget,
            memory: benchmarkReport.summary.p95.meetsMemoryTarget,
            cpu: benchmarkReport.summary.p95.meetsCpuTarget,
          },
        });
      }
    });
  });

  describe('Stress Testing', () => {
    /**
     * Test performance under concurrent operations
     */
    it('should maintain performance under concurrent scanning', async () => {
      const concurrentScans = 3;
      const mockOCRData = generateHighQualityOCRData();

      const scanPromises = Array.from({ length: concurrentScans }, async () => {
        performanceMonitor.startSession('ocr');

        try {
          await controller.scan(mockOCRData, 'ocr');
          return performanceMonitor.endSession();
        } catch (error) {
          return performanceMonitor.endSession();
        }
      });

      const results = await Promise.allSettled(scanPromises);

      // At least 80% should complete successfully
      const successfulResults = results
        .filter((r) => r.status === 'fulfilled' && r.value)
        .map(
          (r) => (r as PromiseFulfilledResult<PerformanceMetrics | null>).value
        );

      expect(successfulResults.length).toBeGreaterThan(concurrentScans * 0.8);

      // Performance should still be reasonable under load
      successfulResults.forEach((metrics) => {
        if (metrics) {
          expect(metrics.totalProcessingTime).toBeLessThan(3000); // 50% grace period
        }
      });
    });

    /**
     * Test extended scanning session for memory leaks
     */
    it('should handle extended scanning sessions without memory leaks', async () => {
      const extendedIterations = 25;
      const mockOCRData = generateHighQualityOCRData();
      const memoryReadings: number[] = [];

      for (let i = 0; i < extendedIterations; i++) {
        performanceMonitor.startSession('ocr');

        try {
          await controller.scan(mockOCRData, 'ocr');
          const metrics = performanceMonitor.endSession();

          if (metrics) {
            memoryReadings.push(metrics.finalMemoryUsageMB);
          }
        } catch (error) {
          const metrics = performanceMonitor.endSession();
          if (metrics) {
            memoryReadings.push(metrics.finalMemoryUsageMB);
          }
        }

        // Small delay between scans
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Memory should not show linear growth pattern (indicating leaks)
      const firstQuarter = memoryReadings.slice(
        0,
        Math.floor(extendedIterations / 4)
      );
      const lastQuarter = memoryReadings.slice(
        -Math.floor(extendedIterations / 4)
      );

      const firstQuarterAvg =
        firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
      const lastQuarterAvg =
        lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;

      const memoryGrowth = lastQuarterAvg - firstQuarterAvg;

      // Memory growth should be minimal over extended session
      expect(memoryGrowth).toBeLessThan(30); // <30MB growth over extended session
    });
  });
});

// Helper functions for generating test data

function generateHighQualityOCRData(): OCRTextObservation[] {
  return [
    {
      text: 'CALIFORNIA',
      confidence: 0.98,
      boundingBox: { x: 100, y: 50, width: 120, height: 25 },
    },
    {
      text: 'DRIVER LICENSE',
      confidence: 0.96,
      boundingBox: { x: 100, y: 80, width: 150, height: 25 },
    },
    {
      text: 'DL D1234567',
      confidence: 0.95,
      boundingBox: { x: 100, y: 120, width: 100, height: 20 },
    },
    {
      text: 'LN ANDERSON',
      confidence: 0.93,
      boundingBox: { x: 100, y: 150, width: 120, height: 20 },
    },
    {
      text: 'FN MICHAEL',
      confidence: 0.94,
      boundingBox: { x: 100, y: 180, width: 100, height: 20 },
    },
    {
      text: 'DOB 03/15/1985',
      confidence: 0.92,
      boundingBox: { x: 100, y: 210, width: 120, height: 20 },
    },
    {
      text: '1234 OAK STREET',
      confidence: 0.89,
      boundingBox: { x: 100, y: 240, width: 150, height: 20 },
    },
  ];
}

function generatePoorQualityOCRData(): OCRTextObservation[] {
  return [
    {
      text: 'C4L1F0RN14',
      confidence: 0.45,
      boundingBox: { x: 100, y: 50, width: 120, height: 25 },
    },
    {
      text: 'DR|V3R L|C3NS3',
      confidence: 0.42,
      boundingBox: { x: 100, y: 80, width: 150, height: 25 },
    },
    {
      text: '0L 0|2345G7',
      confidence: 0.38,
      boundingBox: { x: 100, y: 120, width: 100, height: 20 },
    },
    {
      text: 'LN 4ND3R50N',
      confidence: 0.35,
      boundingBox: { x: 100, y: 150, width: 120, height: 20 },
    },
    {
      text: 'FN M|CH43L',
      confidence: 0.36,
      boundingBox: { x: 100, y: 180, width: 100, height: 20 },
    },
  ];
}
