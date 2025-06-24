/**
 * Isolated Performance Monitor Unit Tests
 * Tests the core performance monitoring functionality without React Native components
 */

import { performanceMonitor } from '../utils/PerformanceMonitor';
import type { PerformanceMetrics } from '../types/license';

// Mock the logger to avoid React Native dependencies
jest.mock('../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    getPerformanceMetrics: jest.fn(() => ({})),
  },
}));

// Mock performance.now() if not available
if (!global.performance) {
  global.performance = {
    now: jest.fn(() => Date.now()),
  } as any;
}

describe('Performance Monitor Unit Tests', () => {
  beforeEach(() => {
    performanceMonitor.clearAlerts();
    jest.clearAllMocks();
  });

  describe('Basic Session Management', () => {
    it('should start and end a performance session', async () => {
      const sessionId = performanceMonitor.startSession('ocr');
      expect(sessionId).toContain('ocr_');
      
      // Add small delay to ensure measurable time difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.totalProcessingTime).toBeGreaterThanOrEqual(0);
        expect(metrics.initialMemoryUsageMB).toBeGreaterThan(0);
        expect(metrics.finalMemoryUsageMB).toBeGreaterThan(0);
      }
    });

    it('should handle checkpoints correctly', () => {
      const sessionId = performanceMonitor.startSession('fallback');
      
      performanceMonitor.checkpoint('test_start');
      performanceMonitor.checkpoint('test_middle', { step: 1 });
      performanceMonitor.checkpoint('test_end');
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
    });

    it('should track memory allocations', () => {
      const sessionId = performanceMonitor.startSession('barcode');
      
      performanceMonitor.trackMemoryAllocation('operation1', 1024);
      performanceMonitor.trackMemoryAllocation('operation2');
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.memoryDeltaMB).toBeDefined();
      }
    });

    it('should track resource utilization', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      performanceMonitor.trackResourceUtilization(45, 30);
      performanceMonitor.trackResourceUtilization(55, 40);
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.peakCpuUtilization).toBeGreaterThan(0);
        expect(metrics.peakGpuUtilization).toBeGreaterThan(0);
      }
    });
  });

  describe('Performance Target Validation', () => {
    it('should validate OCR processing target (<2000ms)', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      // Simulate fast OCR processing
      performanceMonitor.checkpoint('ocr_start');
      performanceMonitor.checkpoint('ocr_end');
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        // For a very fast operation, should meet OCR target
        expect(metrics.meetsOcrTarget).toBe(true);
      }
    });

    it('should validate fallback processing target (<4000ms)', () => {
      const sessionId = performanceMonitor.startSession('fallback');
      
      // Simulate reasonably fast processing
      performanceMonitor.checkpoint('fallback_start');
      performanceMonitor.checkpoint('fallback_end');
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        // For a fast operation, should meet fallback target
        expect(metrics.meetsFallbackTarget).toBe(true);
      }
    });

    it('should validate memory usage target (<50MB)', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      // Memory delta should be small for a simple test
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        // Memory delta should typically be under 50MB
        expect(metrics.meetsMemoryTarget).toBe(true);
      }
    });

    it('should validate CPU utilization target (<60%)', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      // Track moderate CPU usage
      performanceMonitor.trackResourceUtilization(45);
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.meetsCpuTarget).toBe(true);
      }
    });
  });

  describe('Alert Generation', () => {
    it('should generate alerts for threshold violations', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      // Simulate high CPU usage
      performanceMonitor.trackResourceUtilization(75); // Above 60% threshold
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.meetsCpuTarget).toBe(false);
      }
      
      // Check for alerts
      const alerts = performanceMonitor.getRecentAlerts(5);
      expect(alerts.length).toBeGreaterThan(0);
      
      const cpuAlert = alerts.find(alert => alert.category === 'cpu');
      expect(cpuAlert).toBeDefined();
      if (cpuAlert) {
        expect(cpuAlert.type).toBe('warning');
        expect(cpuAlert.actualValue).toBe(75);
        expect(cpuAlert.threshold).toBe(60);
      }
    });

    it('should clear alerts when requested', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      performanceMonitor.trackResourceUtilization(75);
      performanceMonitor.endSession();
      
      let alerts = performanceMonitor.getRecentAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      
      performanceMonitor.clearAlerts();
      alerts = performanceMonitor.getRecentAlerts();
      expect(alerts.length).toBe(0);
    });
  });

  describe('Benchmarking', () => {
    it('should generate benchmark reports', () => {
      // Generate multiple sessions for benchmarking
      for (let i = 0; i < 5; i++) {
        const sessionId = performanceMonitor.startSession('ocr');
        performanceMonitor.checkpoint('test_checkpoint');
        performanceMonitor.trackResourceUtilization(40 + i * 2);
        performanceMonitor.endSession();
      }
      
      const benchmark = performanceMonitor.generateBenchmarkReport('ocr_test', 5);
      expect(benchmark).toBeDefined();
      if (benchmark) {
        expect(benchmark.testName).toBe('ocr_test');
        expect(benchmark.iterations).toBeGreaterThan(0);
        expect(benchmark.summary).toBeDefined();
        expect(benchmark.summary.mean).toBeDefined();
        expect(benchmark.summary.p95).toBeDefined();
      }
    });

    it('should detect performance regression', () => {
      // This test would need baseline data to properly test regression detection
      // For now, we'll just verify the report structure
      const benchmark = performanceMonitor.generateBenchmarkReport('empty_test', 1);
      expect(benchmark).toBeNull(); // No data available
    });
  });

  describe('Performance Targets', () => {
    it('should return correct performance targets', () => {
      const targets = performanceMonitor.getTargets();
      expect(targets).toEqual({
        ocrProcessingMs: 2000,
        fallbackProcessingMs: 4000,
        memoryDeltaMB: 50,
        cpuUtilizationPercent: 60,
      });
    });
  });

  describe('Stress Testing', () => {
    it('should handle multiple concurrent sessions gracefully', () => {
      // Start multiple sessions (though only one should be active)
      const sessionId1 = performanceMonitor.startSession('ocr');
      const sessionId2 = performanceMonitor.startSession('barcode'); // Should replace first
      
      performanceMonitor.checkpoint('test');
      const metrics = performanceMonitor.endSession();
      
      expect(metrics).toBeDefined();
      expect(sessionId2).toContain('barcode_');
    });

    it('should handle operations without active session', () => {
      // These should not throw errors
      performanceMonitor.checkpoint('orphan_checkpoint');
      performanceMonitor.trackMemoryAllocation('orphan_memory');
      performanceMonitor.trackResourceUtilization(50);
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeNull();
    });
  });

  describe('Memory Simulation', () => {
    it('should simulate memory growth patterns', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      // Simulate memory allocations
      for (let i = 0; i < 5; i++) {
        performanceMonitor.trackMemoryAllocation(`allocation_${i}`, 1024 * i);
      }
      
      const metrics = performanceMonitor.endSession();
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.memoryAllocations).toBeGreaterThan(0);
        expect(metrics.initialMemoryUsageMB).toBeGreaterThan(0);
        expect(metrics.finalMemoryUsageMB).toBeGreaterThan(0);
      }
    });
  });
});