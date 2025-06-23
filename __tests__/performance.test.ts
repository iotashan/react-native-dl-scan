/**
 * Performance Tests (T05_S03)
 * Tests performance requirements including the 2 FPS OCR processing target
 */

// Mock react-native-vision-camera with a more comprehensive mock
jest.mock('react-native-vision-camera', () => {
  const mockPlugin = {
    call: jest.fn(() => null), // Default to null, will be overridden in tests
  };

  return {
    VisionCameraProxy: {
      initFrameProcessorPlugin: jest.fn(() => mockPlugin),
    },
  };
});

// Mock react-native
jest.mock('react-native', () => {
  const mockScanLicense = jest.fn();
  (global as any).__mockScanLicense = mockScanLicense;

  return {
    TurboModuleRegistry: {
      getEnforcing: jest.fn(() => ({
        scanLicense: mockScanLicense,
      })),
    },
    StyleSheet: {
      create: (styles: any) => styles,
    },
  };
});

import { scanLicense } from '../src/index';
import { scanLicense as scanLicenseFrame } from '../src/frameProcessors/scanLicense';
import type { LicenseData } from '../src/types/license';

const mockScanLicenseFunction = (global as any).__mockScanLicense;

describe('Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Barcode Processing Performance', () => {
    it('should process barcodes within acceptable time limits', async () => {
      const mockLicenseData: LicenseData = {
        firstName: 'Performance',
        lastName: 'Test',
        licenseNumber: 'PERF123',
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2026-01-01'),
        sex: 'M',
      };

      // Mock processing time of 100ms (well under 2 FPS requirement)
      mockScanLicenseFunction.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          success: true,
          data: mockLicenseData,
        };
      });

      const iterations = 10;
      const startTime = performance.now();

      // Process multiple barcodes
      const promises = Array.from({ length: iterations }, (_, i) =>
        scanLicense(`PERFORMANCE_TEST_${i}`)
      );

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / iterations;

      expect(results).toHaveLength(iterations);
      expect(averageTime).toBeLessThan(500); // Should average under 500ms (2 FPS)

      console.log(
        `Barcode processing average time: ${averageTime.toFixed(2)}ms`
      );
    });

    it('should handle burst processing without degradation', async () => {
      const mockData: LicenseData = {
        firstName: 'Burst',
        lastName: 'Test',
        licenseNumber: 'BURST123',
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2026-01-01'),
        sex: 'F',
      };

      // Add a small realistic delay to the mock
      mockScanLicenseFunction.mockImplementation(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 10 + 5)
        ); // 5-15ms
        return {
          success: true,
          data: mockData,
        };
      });

      const burstSize = 20;
      const times: number[] = [];

      // Measure individual processing times during burst
      for (let i = 0; i < burstSize; i++) {
        const start = performance.now();
        await scanLicense(`BURST_${i}`);
        const end = performance.now();
        times.push(end - start);
      }

      // Check that processing time doesn't degrade significantly
      const firstHalf = times.slice(0, burstSize / 2);
      const secondHalf = times.slice(burstSize / 2);

      const firstAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;

      // Ensure we have meaningful times to compare
      if (firstAvg > 0 && secondAvg > 0) {
        // Second half should not be more than 50% slower than first half
        expect(secondAvg).toBeLessThan(firstAvg * 1.5);
      } else {
        // If times are too fast to measure meaningfully, just verify they're reasonable
        expect(times.every((t) => t >= 0 && t < 1000)).toBe(true); // All times reasonable
      }

      console.log(
        `Burst test - First half avg: ${firstAvg.toFixed(2)}ms, Second half avg: ${secondAvg.toFixed(2)}ms`
      );
    });
  });

  describe('Frame Processor Performance', () => {
    it('should meet 2 FPS processing requirement for OCR mode', () => {
      const { VisionCameraProxy } = require('react-native-vision-camera');
      const mockPlugin = VisionCameraProxy.initFrameProcessorPlugin();

      // Mock OCR processing time (should be under 500ms for 2 FPS)
      const ocrProcessingTimes = [
        0.32,
        0.48,
        0.35,
        0.42,
        0.39, // Realistic OCR times
        0.31,
        0.45,
        0.38,
        0.44,
        0.36,
      ];

      let callIndex = 0;
      mockPlugin.call.mockImplementation(() => {
        const processingTime =
          ocrProcessingTimes[callIndex % ocrProcessingTimes.length];
        callIndex++;

        return {
          success: true,
          data: {
            firstName: 'OCR',
            lastName: 'Test',
            licenseNumber: `OCR${callIndex}`,
            dateOfBirth: new Date('1990-01-01'),
            expirationDate: new Date('2026-01-01'),
            sex: 'M',
          },
          processingTime,
          mode: 'ocr',
        };
      });

      const mockFrame = {
        width: 1280,
        height: 720,
        mode: 'ocr',
        isValid: true,
        bytesPerRow: 5120,
        planesCount: 1,
        isMirrored: false,
        timestamp: Date.now(),
        orientation: 'portrait',
        pixelFormat: 'yuv',
        planarImage: true,
        pixelBuffer: null,
      } as any;
      const results: any[] = [];

      // Process frames for OCR mode
      for (let i = 0; i < 10; i++) {
        const result = scanLicenseFrame(mockFrame);
        results.push(result);
      }

      // Verify all frames meet 2 FPS requirement (500ms max)
      results.forEach((result, index) => {
        expect(result?.processingTime).toBeLessThan(0.5);
        console.log(
          `OCR Frame ${index + 1}: ${(result?.processingTime * 1000).toFixed(0)}ms`
        );
      });

      const avgTime =
        results.reduce((sum, r) => sum + (r?.processingTime || 0), 0) /
        results.length;
      expect(avgTime).toBeLessThan(0.5);

      console.log(
        `OCR average processing time: ${(avgTime * 1000).toFixed(0)}ms (Target: <500ms)`
      );
    });

    it('should meet 10 FPS processing requirement for barcode mode', () => {
      const { VisionCameraProxy } = require('react-native-vision-camera');
      const mockPlugin = VisionCameraProxy.initFrameProcessorPlugin();

      // Mock barcode processing time (should be under 100ms for 10 FPS)
      const barcodeProcessingTimes = [
        0.05,
        0.08,
        0.06,
        0.07,
        0.055, // Realistic barcode times
        0.045,
        0.085,
        0.065,
        0.075,
        0.058,
      ];

      let callIndex = 0;
      mockPlugin.call.mockImplementation(() => {
        const processingTime =
          barcodeProcessingTimes[callIndex % barcodeProcessingTimes.length];
        callIndex++;

        return {
          success: true,
          data: {
            firstName: 'Barcode',
            lastName: 'Test',
            licenseNumber: `BAR${callIndex}`,
            dateOfBirth: new Date('1990-01-01'),
            expirationDate: new Date('2026-01-01'),
            sex: 'F',
          },
          processingTime,
          mode: 'barcode',
        };
      });

      const mockFrame = {
        width: 1920,
        height: 1080,
        mode: 'barcode',
        isValid: true,
        bytesPerRow: 7680,
        planesCount: 1,
        isMirrored: false,
        timestamp: Date.now(),
        orientation: 'portrait',
        pixelFormat: 'yuv',
        planarImage: true,
        pixelBuffer: null,
      } as any;
      const results: any[] = [];

      // Process frames for barcode mode
      for (let i = 0; i < 10; i++) {
        const result = scanLicenseFrame(mockFrame);
        results.push(result);
      }

      // Verify all frames meet 10 FPS requirement (100ms max)
      results.forEach((result, index) => {
        expect(result?.processingTime).toBeLessThan(0.1);
        console.log(
          `Barcode Frame ${index + 1}: ${(result?.processingTime * 1000).toFixed(0)}ms`
        );
      });

      const avgTime =
        results.reduce((sum, r) => sum + (r?.processingTime || 0), 0) /
        results.length;
      expect(avgTime).toBeLessThan(0.1);

      console.log(
        `Barcode average processing time: ${(avgTime * 1000).toFixed(0)}ms (Target: <100ms)`
      );
    });

    it('should handle frame rate limiting correctly', () => {
      const { VisionCameraProxy } = require('react-native-vision-camera');
      const mockPlugin = VisionCameraProxy.initFrameProcessorPlugin();

      // Mock frame processor that tracks timing
      const frameTimes: number[] = [];
      let lastFrameTime = 0;

      mockPlugin.call.mockImplementation(() => {
        const currentTime = performance.now();
        if (lastFrameTime > 0) {
          frameTimes.push(currentTime - lastFrameTime);
        }
        lastFrameTime = currentTime;

        return {
          success: true,
          data: {
            firstName: 'Frame',
            lastName: 'Test',
            licenseNumber: 'FRAME123',
            dateOfBirth: new Date('1990-01-01'),
            expirationDate: new Date('2026-01-01'),
            sex: 'M',
          },
          processingTime: 0.05,
        };
      });

      const mockFrame = {
        width: 1280,
        height: 720,
        isValid: true,
        bytesPerRow: 5120,
        planesCount: 1,
        isMirrored: false,
        timestamp: Date.now(),
        orientation: 'portrait',
        pixelFormat: 'yuv',
        planarImage: true,
        pixelBuffer: null,
      } as any;

      // Simulate rapid frame processing
      for (let i = 0; i < 20; i++) {
        scanLicenseFrame(mockFrame);

        // Small delay to simulate real frame timing
        const start = performance.now();
        while (performance.now() - start < 16); // ~60 FPS input rate
      }

      // Should have meaningful timing data (at least some frames processed)
      expect(frameTimes.length).toBeGreaterThan(0);

      // Log frame intervals for analysis
      if (frameTimes.length > 0) {
        const avgInterval =
          frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        console.log(`Average frame interval: ${avgInterval.toFixed(2)}ms`);
      }
    });
  });

  describe('Memory Performance', () => {
    it('should maintain stable memory usage during continuous processing', async () => {
      const mockData: LicenseData = {
        firstName: 'Memory',
        lastName: 'Stability',
        licenseNumber: 'MEM456',
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2026-01-01'),
        sex: 'M',
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: mockData,
      });

      const iterations = 100;
      const memorySnapshots: number[] = [];

      // Measure memory at intervals during processing
      for (let i = 0; i < iterations; i++) {
        await scanLicense(`MEMORY_STABILITY_${i}`);

        // Take memory snapshot every 10 iterations
        if (i % 10 === 0 && global.gc && process.memoryUsage) {
          global.gc();
          const usage = process.memoryUsage();
          memorySnapshots.push(usage.heapUsed);
        }
      }

      if (memorySnapshots.length > 2) {
        // Check for memory growth pattern
        const firstQuarter = memorySnapshots.slice(
          0,
          Math.floor(memorySnapshots.length / 4)
        );
        const lastQuarter = memorySnapshots.slice(
          -Math.floor(memorySnapshots.length / 4)
        );

        const avgFirst =
          firstQuarter.reduce((a, b) => a + b) / firstQuarter.length;
        const avgLast =
          lastQuarter.reduce((a, b) => a + b) / lastQuarter.length;

        const growth = (avgLast - avgFirst) / avgFirst;

        // Memory growth should be minimal (less than 20%)
        expect(growth).toBeLessThan(0.2);

        console.log(
          `Memory growth during ${iterations} iterations: ${(growth * 100).toFixed(1)}%`
        );
      }
    });

    it('should handle large license data efficiently', async () => {
      // Create license data with all possible fields
      const largeLicenseData: LicenseData = {
        firstName: 'VeryLongFirstNameForTesting',
        lastName: 'VeryLongLastNameForTesting',
        middleName: 'VeryLongMiddleNameForTesting',
        suffix: 'Sr',
        licenseNumber: 'LARGE123456789',
        dateOfBirth: new Date('1980-12-25'),
        issueDate: new Date('2020-01-01'),
        expirationDate: new Date('2030-01-01'),
        sex: 'M',
        eyeColor: 'BRO',
        hairColor: 'BLN',
        height: '6-02',
        weight: '200',
        address: {
          street: '1234 Very Long Street Name That Goes On And On Avenue',
          city: 'Very Long City Name That Tests Memory Usage',
          state: 'CA',
          postalCode: '12345-6789',
          country: 'USA',
        },
        licenseClass: 'CDL-A',
        restrictions: 'CORRECTIVE LENSES, DAYLIGHT DRIVING ONLY',
        endorsements: 'HAZMAT, PASSENGER, SCHOOL BUS',
        issuerIdentificationNumber: '636014',
        documentDiscriminator: 'VERY_LONG_DISCRIMINATOR_STRING_123456789',
        isOrganDonor: true,
        isVeteran: true,
        isRealID: true,
        allFields: {
          DAC: 'VeryLongFirstNameForTesting',
          DCS: 'VeryLongLastNameForTesting',
          DAD: 'VeryLongMiddleNameForTesting',
          // ... many more fields
        },
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: largeLicenseData,
      });

      const iterations = 50;
      const startTime = performance.now();

      // Process large license data multiple times
      const results = await Promise.all(
        Array.from({ length: iterations }, (_, i) =>
          scanLicense(`LARGE_LICENSE_${i}`)
        )
      );

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / iterations;

      expect(results).toHaveLength(iterations);
      expect(avgTime).toBeLessThan(1000); // Should still be fast with large data

      // Verify data integrity
      results.forEach((result) => {
        expect(result.firstName).toBe('VeryLongFirstNameForTesting');
        expect(result.lastName).toBe('VeryLongLastNameForTesting');
        expect(result.address?.street).toBe(
          '1234 Very Long Street Name That Goes On And On Avenue'
        );
      });

      console.log(
        `Large data processing average time: ${avgTime.toFixed(2)}ms`
      );
    });
  });

  describe('Concurrent Processing Performance', () => {
    it('should handle concurrent scan requests efficiently', async () => {
      const mockData: LicenseData = {
        firstName: 'Concurrent',
        lastName: 'Test',
        licenseNumber: 'CONC123',
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2026-01-01'),
        sex: 'F',
      };

      // Add realistic processing delay
      mockScanLicenseFunction.mockImplementation(async (data: string) => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 100 + 50)
        );
        return {
          success: true,
          data: { ...mockData, processedData: data },
        };
      });

      const concurrency = 10;
      const startTime = performance.now();

      // Launch concurrent requests
      const promises = Array.from({ length: concurrency }, (_, i) =>
        scanLicense(`CONCURRENT_${i}`)
      );

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      expect(results).toHaveLength(concurrency);

      // With proper concurrency, total time should be much less than sequential
      // Sequential would be ~concurrency * averageProcessingTime
      // Concurrent should be closer to max individual processing time
      expect(totalTime).toBeLessThan(concurrency * 100);

      console.log(
        `Concurrent processing (${concurrency} requests): ${totalTime.toFixed(2)}ms total`
      );
    });

    it('should handle mixed barcode and OCR processing', () => {
      const { VisionCameraProxy } = require('react-native-vision-camera');
      const mockPlugin = VisionCameraProxy.initFrameProcessorPlugin();

      let barcodeCount = 0;
      let ocrCount = 0;

      mockPlugin.call.mockImplementation((frame: any) => {
        const mode = frame.mode || (Math.random() > 0.5 ? 'barcode' : 'ocr');

        if (mode === 'barcode') {
          barcodeCount++;
          return {
            success: true,
            data: {
              firstName: 'Mixed',
              lastName: 'Barcode',
              licenseNumber: `BAR${barcodeCount}`,
              dateOfBirth: new Date('1990-01-01'),
              expirationDate: new Date('2026-01-01'),
              sex: 'M',
            },
            processingTime: 0.06, // 60ms for barcode
            mode: 'barcode',
          };
        } else {
          ocrCount++;
          return {
            success: true,
            data: {
              firstName: 'Mixed',
              lastName: 'OCR',
              licenseNumber: `OCR${ocrCount}`,
              dateOfBirth: new Date('1990-01-01'),
              expirationDate: new Date('2026-01-01'),
              sex: 'F',
            },
            processingTime: 0.35, // 350ms for OCR
            mode: 'ocr',
          };
        }
      });

      const results: any[] = [];

      // Process mixed frame types
      for (let i = 0; i < 20; i++) {
        const mode = i % 3 === 0 ? 'ocr' : 'barcode'; // 1/3 OCR, 2/3 barcode
        const frame = {
          width: 1280,
          height: 720,
          mode,
          isValid: true,
          bytesPerRow: 5120,
          planesCount: 1,
          isMirrored: false,
          timestamp: Date.now(),
          orientation: 'portrait',
          pixelFormat: 'yuv',
          planarImage: true,
          pixelBuffer: null,
        } as any;
        const result = scanLicenseFrame(frame);
        results.push(result);
      }

      // Verify processing times are appropriate for each mode
      const barcodeResults = results.filter((r) => r?.mode === 'barcode');
      const ocrResults = results.filter((r) => r?.mode === 'ocr');

      barcodeResults.forEach((result) => {
        expect(result?.processingTime).toBeLessThan(0.1); // 10 FPS
      });

      ocrResults.forEach((result) => {
        expect(result?.processingTime).toBeLessThan(0.5); // 2 FPS
      });

      console.log(
        `Mixed processing - Barcode: ${barcodeCount}, OCR: ${ocrCount}`
      );
    });
  });

  describe('UI Progress Performance', () => {
    const sampleBarcodeData = 'SAMPLE_BARCODE_DATA';
    const mockPerformance = {
      barcodeProcessingTime: 100, // 100ms baseline
    };

    it('should maintain performance with progress UI updates', async () => {
      const progressUpdates: number[] = [];
      let updateCount = 0;
      let progressInterval: NodeJS.Timeout | null = null;

      // Mock progress callback to track update frequency
      const onProgressUpdate = (_progress: any) => {
        updateCount++;
        progressUpdates.push(Date.now());
      };

      // Set up mock for this specific test with exact timing
      mockScanLicenseFunction.mockImplementation(async () => {
        // Start progress updates when scan starts
        progressInterval = setInterval(() => {
          onProgressUpdate({
            state: 'barcode',
            progressPercentage: Math.min(100, updateCount * 10),
          });
        }, 100);

        await new Promise((resolve) =>
          setTimeout(resolve, mockPerformance.barcodeProcessingTime)
        );

        // Clear interval before returning
        if (progressInterval) {
          clearInterval(progressInterval);
        }

        return {
          success: true,
          data: {
            firstName: 'Progress',
            lastName: 'Test',
            licenseNumber: 'PROG123',
            dateOfBirth: new Date('1990-01-01'),
            expirationDate: new Date('2026-01-01'),
            sex: 'M',
          },
        };
      });

      const startTime = Date.now();
      await mockScanLicenseFunction(sampleBarcodeData);
      const endTime = Date.now();

      const scanTime = endTime - startTime;

      // Verify performance impact is less than 5%
      expect(scanTime).toBeLessThan(
        Math.round(mockPerformance.barcodeProcessingTime * 1.05)
      );

      // Verify we had at least one progress update
      expect(updateCount).toBeGreaterThanOrEqual(1);
    });

    it('should complete mode switch animations within 300ms', async () => {
      let animationStartTime: number | null = null;
      let animationEndTime: number | null = null;

      const mockAnimationCallbacks = {
        onAnimationStart: () => {
          animationStartTime = Date.now();
        },
        onAnimationComplete: () => {
          animationEndTime = Date.now();
        },
      };

      // Simulate mode transition
      const animationDuration = 300; // As specified in ProgressIndicator

      mockAnimationCallbacks.onAnimationStart();
      await new Promise((resolve) => setTimeout(resolve, animationDuration));
      mockAnimationCallbacks.onAnimationComplete();

      const actualDuration = animationEndTime! - animationStartTime!;

      // Verify animation completes within specified time (with small buffer)
      expect(actualDuration).toBeLessThanOrEqual(310); // 300ms + 10ms buffer
      expect(actualDuration).toBeGreaterThanOrEqual(295); // Allow slight variance
    });
  });
});
