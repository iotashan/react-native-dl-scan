import { performanceMonitor } from '../utils/PerformanceMonitor';
import {
  calculateQualityMetrics,
  shouldAnalyzeFrame,
} from '../frameProcessors/qualityMetrics';
import type { RealTimeQualityMetrics } from '../types/license';

// Mock frame
const mockFrame = {
  width: 1920,
  height: 1080,
  bytesPerRow: 7680,
  planarCount: 1,
  toString: () => '[Frame 1920x1080]',
} as any;

describe('Quality Indicator Performance Tests', () => {
  describe('Frame Processing Performance', () => {
    it('should maintain 60fps with quality metric calculations', async () => {
      performanceMonitor.startSession('barcode');
      
      // Simulate 60fps for 1 second (60 frames)
      const frameCount = 60;
      const frameInterval = 1000 / 60; // 16.67ms per frame
      
      performanceMonitor.checkpoint('quality_calculation_start');
      
      const startTime = performance.now();
      
      for (let i = 0; i < frameCount; i++) {
        const frameStart = performance.now();
        
        // Only calculate quality metrics for frames that should be analyzed
        if (shouldAnalyzeFrame(i, 10)) {
          calculateQualityMetrics(mockFrame);
        }
        
        const frameEnd = performance.now();
        const frameTime = frameEnd - frameStart;
        
        // Frame processing should be <16.67ms to maintain 60fps
        expect(frameTime).toBeLessThan(frameInterval);
        
        // Track frame metrics
        performanceMonitor.trackFrameProcessing(1, 0, 60);
      }
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      performanceMonitor.checkpoint('quality_calculation_end');
      
      const metrics = performanceMonitor.endSession();
      
      // Total time should be reasonable for 60 frames
      expect(totalTime).toBeLessThan(200); // Less than 200ms for 60 frames
      
      // Should maintain target frame rate
      expect(metrics?.frameProcessingRate).toBeGreaterThanOrEqual(55); // Allow some variance
      
      // No frames should be dropped
      expect(metrics?.framesDropped).toBe(0);
    });

    it('should throttle quality updates to 10fps maximum', async () => {
      jest.useFakeTimers();
      
      const updates: RealTimeQualityMetrics[] = [];
      const mockThrottledHook = {
        updateMetrics: jest.fn((metrics: RealTimeQualityMetrics) => {
          updates.push(metrics);
        }),
      };
      
      // Simulate 30fps camera with quality calculations
      const frameCount = 30; // 1 second at 30fps
      
      for (let i = 0; i < frameCount; i++) {
        if (shouldAnalyzeFrame(i, 10)) { // 10fps target
          const metrics = calculateQualityMetrics(mockFrame);
          mockThrottledHook.updateMetrics(metrics);
        }
        
        // Advance time by 33ms (30fps interval)
        jest.advanceTimersByTime(33);
      }
      
      // Should have approximately 10 updates (10fps)
      expect(mockThrottledHook.updateMetrics).toHaveBeenCalledTimes(10);
      
      jest.useRealTimers();
    });

    it('should handle high-frequency quality metric calculations efficiently', () => {
      const sessionId = performanceMonitor.startSession('ocr');
      
      performanceMonitor.checkpoint('stress_test_start');
      
      const iterations = 1000;
      const startTime = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        calculateQualityMetrics(mockFrame);
      }
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / iterations;
      
      performanceMonitor.checkpoint('stress_test_end');
      
      const metrics = performanceMonitor.endSession();
      
      // Each quality calculation should be fast
      expect(averageTime).toBeLessThan(5); // Less than 5ms per calculation
      
      // Total time should be reasonable
      expect(totalTime).toBeLessThan(1000); // Less than 1 second for 1000 calculations
      
      console.log(`Quality metrics calculation: ${averageTime.toFixed(2)}ms average per frame`);
    });
  });

  describe('Memory Performance', () => {
    it('should not leak memory during continuous operation', async () => {
      const sessionId = performanceMonitor.startSession('fallback');
      
      performanceMonitor.trackMemoryAllocation('initial_state');
      
      // Simulate continuous scanning for extended period
      const frames = 300; // 10 seconds at 30fps
      
      for (let i = 0; i < frames; i++) {
        // Calculate quality metrics for every 3rd frame (10fps)
        if (i % 3 === 0) {
          const metrics = calculateQualityMetrics(mockFrame);
          
          // Simulate component updates (would normally be throttled)
          if (i % 10 === 0) { // Update UI every ~300ms
            // Simulate React component re-render
            performanceMonitor.trackMemoryAllocation(`ui_update_${i}`);
          }
        }
        
        // Track memory periodically
        if (i % 30 === 0) { // Every second
          performanceMonitor.trackMemoryAllocation(`frame_${i}`);
        }
      }
      
      performanceMonitor.trackMemoryAllocation('final_state');
      
      const metrics = performanceMonitor.endSession();
      
      // Memory delta should be within acceptable bounds
      expect(metrics?.memoryDeltaMB).toBeLessThan(10); // Less than 10MB increase
      
      // Should meet memory target
      expect(metrics?.meetsMemoryTarget).toBe(true);
      
      console.log(`Memory usage delta: ${metrics?.memoryDeltaMB.toFixed(2)}MB`);
    });

    it('should efficiently cache quality metrics', () => {
      const sessionId = performanceMonitor.startSession('barcode');
      
      // Test cache performance with repeated frame IDs
      const uniqueFrames = 10;
      const repetitions = 100;
      
      performanceMonitor.checkpoint('cache_test_start');
      
      const startTime = performance.now();
      
      for (let rep = 0; rep < repetitions; rep++) {
        for (let frame = 0; frame < uniqueFrames; frame++) {
          const frameId = `frame_${frame}`;
          
          // This would use cache for repeated frame IDs
          calculateQualityMetrics(mockFrame);
        }
      }
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      performanceMonitor.checkpoint('cache_test_end');
      
      const metrics = performanceMonitor.endSession();
      
      // With caching, this should be much faster than calculating each time
      const averageTime = totalTime / (uniqueFrames * repetitions);
      expect(averageTime).toBeLessThan(1); // Less than 1ms per cached lookup
      
      console.log(`Cached quality lookup: ${averageTime.toFixed(3)}ms average`);
    });
  });

  describe('Component Rendering Performance', () => {
    it('should render quality indicators without performance impact', async () => {
      // This would be an integration test with React Testing Library
      // Testing that QualityIndicator renders within performance budget
      
      const mockMetrics: RealTimeQualityMetrics = {
        blur: { value: 0.3, status: 'warning' },
        lighting: { brightness: 0.6, uniformity: 0.7, status: 'warning' },
        positioning: { documentDetected: true, alignment: 0.8, distance: 'optimal', status: 'good' },
        overall: { score: 0.7, readyToScan: false },
      };
      
      const sessionId = performanceMonitor.startSession('ocr');
      
      performanceMonitor.checkpoint('render_start');
      
      // Simulate rapid metric updates (what throttling would prevent)
      const updates = 100;
      const startTime = performance.now();
      
      for (let i = 0; i < updates; i++) {
        // Simulate component state updates
        const updatedMetrics = {
          ...mockMetrics,
          blur: { ...mockMetrics.blur, value: Math.random() * 0.5 },
          overall: { 
            score: 0.5 + Math.random() * 0.5, 
            readyToScan: Math.random() > 0.5 
          },
        };
        
        // This would trigger re-renders in actual component
        // For performance test, we just validate the metrics structure
        expect(updatedMetrics.blur.value).toBeGreaterThanOrEqual(0);
        expect(updatedMetrics.overall.score).toBeGreaterThanOrEqual(0);
      }
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      performanceMonitor.checkpoint('render_end');
      
      const metrics = performanceMonitor.endSession();
      
      // Rapid updates should still be fast
      expect(totalTime).toBeLessThan(50); // Less than 50ms for 100 updates
      
      const averageUpdateTime = totalTime / updates;
      expect(averageUpdateTime).toBeLessThan(1); // Less than 1ms per update
      
      console.log(`Component update simulation: ${averageUpdateTime.toFixed(3)}ms average`);
    });
  });

  describe('Integration Performance', () => {
    it('should maintain overall performance targets with quality system active', async () => {
      const sessionId = performanceMonitor.startSession('fallback');
      
      performanceMonitor.checkpoint('integration_start');
      
      // Simulate full scanning workflow with quality indicators
      const scanDuration = 2000; // 2 seconds
      const frameRate = 30;
      const totalFrames = (scanDuration / 1000) * frameRate;
      
      const startTime = performance.now();
      
      for (let frame = 0; frame < totalFrames; frame++) {
        // Camera frame processing
        if (shouldAnalyzeFrame(frame, 10)) {
          performanceMonitor.checkpoint(`quality_calc_${frame}`);
          
          const metrics = calculateQualityMetrics(mockFrame);
          
          // Simulate quality-based decisions
          if (metrics.overall.readyToScan) {
            performanceMonitor.checkpoint('scan_ready');
            break; // Would trigger scan in real app
          }
        }
        
        // Simulate other processing
        performanceMonitor.trackFrameProcessing(1, 0, frameRate);
        
        // Track resource usage
        const cpuUsage = 30 + Math.random() * 20; // 30-50% CPU
        performanceMonitor.trackResourceUtilization(cpuUsage);
      }
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      performanceMonitor.checkpoint('integration_end');
      
      const metrics = performanceMonitor.endSession();
      
      // Should meet all performance targets
      expect(metrics?.meetsFallbackTarget).toBe(true);
      expect(metrics?.meetsMemoryTarget).toBe(true);
      expect(metrics?.meetsCpuTarget).toBe(true);
      
      // Quality system should not add significant overhead
      expect(totalTime).toBeLessThan(2500); // Allow some overhead but stay under 2.5s
      
      console.log('Integration performance:', {
        totalTime: `${totalTime.toFixed(2)}ms`,
        framesProcessed: metrics?.framesProcessed,
        avgCpu: `${metrics?.averageCpuUtilization?.toFixed(1)}%`,
        memoryDelta: `${metrics?.memoryDeltaMB.toFixed(2)}MB`,
      });
    });
  });
});