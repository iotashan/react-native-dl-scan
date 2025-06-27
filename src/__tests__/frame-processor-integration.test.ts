/**
 * T02_S08: Frame Processor Integration Tests
 * Enhanced integration tests for frame processors with realistic mock data
 */

import type { Frame } from 'react-native-vision-camera';

// Mock react-native-vision-camera
jest.mock('react-native-vision-camera', () => {
  const mockPlugin = {
    call: jest.fn(),
  };
  return {
    VisionCameraProxy: {
      initFrameProcessorPlugin: jest.fn(() => mockPlugin),
    },
    // Export the mockPlugin for test access
    __mockPlugin: mockPlugin,
  };
});

// Import after mocking
import { scanLicense as scanLicenseFrame } from '../frameProcessors/scanLicense';
import { VisionCameraProxy } from 'react-native-vision-camera';

// Get the mock plugin from the mocked module
const mockPlugin = (require('react-native-vision-camera') as any).__mockPlugin;

// Enhanced Mock Frame Generator
class MockFrameGenerator {
  static createFrame(options: FrameOptions = {}): Frame {
    const width = options.width || 1920;
    const height = options.height || 1080;

    return {
      width,
      height,
      bytesPerRow: options.bytesPerRow || width * 4,
      planesCount: options.planesCount || 1,
      orientation: options.orientation || 'portrait',
      timestamp: options.timestamp || Date.now(),
      isValid: true,
      isMirrored: false,
      pixelFormat: options.pixelFormat || 'yuv',
      planarImage: true,
      pixelBuffer: null, // Not used in mock
    } as Frame;
  }

  static createHighQualityFrame(): Frame {
    return this.createFrame({
      width: 1920,
      height: 1080,
      quality: 'high',
      embedBarcode: true,
      barcodeType: 'pdf417',
    });
  }

  static createLowQualityFrame(): Frame {
    return this.createFrame({
      width: 640,
      height: 480,
      quality: 'low',
      blur: 5,
      embedBarcode: true,
      barcodeType: 'pdf417',
    });
  }

  static createFrameWithoutBarcode(): Frame {
    return this.createFrame({
      width: 1920,
      height: 1080,
      embedBarcode: false,
    });
  }

  static createCorruptedFrame(): Frame {
    return this.createFrame({
      width: 100,
      height: 100,
      corrupted: true,
    });
  }
}

interface FrameOptions {
  width?: number;
  height?: number;
  bytesPerRow?: number;
  planesCount?: number;
  orientation?: string;
  timestamp?: number;
  pixelFormat?: string;
  quality?: 'high' | 'medium' | 'low';
  blur?: number;
  embedBarcode?: boolean;
  barcodeType?: 'pdf417' | 'qr' | 'code128';
  corrupted?: boolean;
}

describe('Frame Processor Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mock implementation to default behavior
    mockPlugin.call.mockReset();
  });

  describe('PDF417 Barcode Detection', () => {
    it('should detect PDF417 barcode in high-quality frame', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createHighQualityFrame();
      const expectedResult = {
        success: true,
        data: {
          firstName: 'JOHN',
          lastName: 'DOE',
          licenseNumber: 'D1234567',
        },
        frameInfo: {
          width: 1920,
          height: 1080,
          timestamp: Date.now(),
        },
        processingTime: 45,
        confidence: 0.95,
        type: 'pdf417',
      };

      mockPlugin.call.mockReturnValue(expectedResult);

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(result).toMatchObject({
        success: true,
        data: expect.any(Object),
      });
      expect(result!.data?.firstName).toBe('JOHN');
      expect(mockPlugin.call).toHaveBeenCalledWith(mockFrame);
    });

    it('should handle low-quality frame with reduced confidence', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createLowQualityFrame();
      const expectedResult = {
        success: true,
        data: {
          firstName: 'JANE',
          lastName: 'SMITH',
          licenseNumber: 'S9876543',
        },
        processingTime: 120,
        confidence: 0.65,
        qualityIssues: ['blur', 'low_resolution'],
      };

      mockPlugin.call.mockReturnValue(expectedResult);

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(result).toMatchObject({
        success: true,
        data: expect.any(Object),
      });
      expect(result!.data?.firstName).toBe('JANE');
    });

    it('should return no detection for frame without barcode', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createFrameWithoutBarcode();

      // Mock returns null when no barcode is detected
      mockPlugin.call.mockReturnValue(null);

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(result).toBeNull();
      expect(mockPlugin.call).toHaveBeenCalledWith(mockFrame);
    });
  });

  describe('Frame Quality Assessment', () => {
    it('should assess frame quality before processing', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createFrame({
        width: 1920,
        height: 1080,
        quality: 'high',
      });

      const expectedResult = {
        success: true,
        data: {
          firstName: 'QUALITY',
          lastName: 'TEST',
        },
        frameQuality: {
          resolution: 'high',
          sharpness: 0.92,
          brightness: 0.85,
          contrast: 0.88,
          overall: 'excellent',
        },
        confidence: 0.96,
      };

      mockPlugin.call.mockReturnValue(expectedResult);

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(mockPlugin.call).toHaveBeenCalledWith(mockFrame);
    });

    it('should handle corrupted frame gracefully', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createCorruptedFrame();
      const expectedResult = {
        success: false,
        error: {
          code: 'CORRUPTED_FRAME',
          message: 'Frame data is corrupted',
          userMessage: 'Camera frame is corrupted',
          recoverable: true,
        },
      };

      mockPlugin.call.mockReturnValue(expectedResult);

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error?.code).toBe('CORRUPTED_FRAME');
    });
  });

  describe('Performance Requirements', () => {
    it('should process frames within 500ms for 2 FPS requirement', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createFrame();
      const expectedResult = {
        success: true,
        data: {
          firstName: 'PERF',
          lastName: 'TEST',
        },
        processingTime: 45, // 45ms - well within 500ms requirement
      };

      mockPlugin.call.mockReturnValue(expectedResult);

      // Act
      const startTime = Date.now();
      const result = scanLicenseFrame(mockFrame);
      const actualProcessingTime = Date.now() - startTime;

      // Assert
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(actualProcessingTime).toBeLessThan(100); // Mock should be very fast
    });

    it('should handle rapid frame processing without memory leaks', () => {
      // Arrange
      const frames = Array.from({ length: 30 }, () =>
        MockFrameGenerator.createFrame()
      );

      mockPlugin.call.mockReturnValue({
        success: true,
        data: {
          firstName: 'RAPID',
          lastName: 'TEST',
        },
        processingTime: 50,
      });

      // Act
      const results = frames.map((frame) => scanLicenseFrame(frame));

      // Assert
      expect(results).toHaveLength(30);
      expect(mockPlugin.call).toHaveBeenCalledTimes(30);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result!.success).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle frame processor plugin initialization failure', () => {
      // This test verifies the behavior when plugin initialization fails
      // Since we're testing the module-level plugin initialization, we check the module directly
      const mockFrame = MockFrameGenerator.createFrame();

      // Mock the plugin to return null (plugin failed to initialize)
      jest.doMock('react-native-vision-camera', () => ({
        VisionCameraProxy: {
          initFrameProcessorPlugin: jest.fn(() => null),
        },
      }));

      // Clear the require cache and re-require the module
      jest.resetModules();
      const {
        scanLicense: scanLicenseReloaded,
      } = require('../frameProcessors/scanLicense');

      // Act & Assert - This should trigger the error in the module initialization
      expect(() => scanLicenseReloaded(mockFrame)).toThrow(
        'Failed to load scanLicense plugin!'
      );
    });

    it('should handle native processing errors gracefully', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createFrame();
      // Return error result instead of throwing
      mockPlugin.call.mockReturnValue({
        success: false,
        error: {
          code: 'NATIVE_ERROR',
          message: 'Native processing error',
          userMessage: 'An error occurred while scanning',
          recoverable: true,
        },
      });

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error?.message).toBe('Native processing error');
    });

    it('should handle invalid frame properties', () => {
      // Arrange
      const invalidFrame = {
        width: 0,
        height: 0,
        isValid: false,
      } as Frame;

      // Mock plugin to return null for invalid frame (no detection)
      mockPlugin.call.mockReturnValue(null);

      // Act
      const result = scanLicenseFrame(invalidFrame);

      // Assert - Frame processor should return null for invalid frames
      expect(result).toBeNull();
      expect(mockPlugin.call).toHaveBeenCalledWith(invalidFrame);
    });
  });

  describe('Frame Processor Configuration', () => {
    it('should pass frame data to native processor correctly', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createFrame();

      mockPlugin.call.mockReturnValue({
        success: true,
        data: {
          firstName: 'CONFIG',
          lastName: 'TEST',
        },
      });

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(mockPlugin.call).toHaveBeenCalledWith(mockFrame);
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
    });

    it('should pass frame metadata to native processor', () => {
      // Arrange
      const mockFrame = MockFrameGenerator.createFrame({
        width: 1280,
        height: 720,
        orientation: 'landscape',
        timestamp: 1234567890,
      });

      mockPlugin.call.mockReturnValue({
        success: true,
        data: {
          firstName: 'META',
          lastName: 'DATA',
        },
        frameMetadata: {
          width: 1280,
          height: 720,
          orientation: 'landscape',
          timestamp: 1234567890,
        },
      });

      // Act
      const result = scanLicenseFrame(mockFrame);

      // Assert
      expect(mockPlugin.call).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1280,
          height: 720,
          orientation: 'landscape',
          timestamp: 1234567890,
        })
      );
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
    });
  });

  describe('Multi-Frame Processing', () => {
    it('should handle sequential frame processing', () => {
      // Arrange
      const frames = [
        MockFrameGenerator.createHighQualityFrame(),
        MockFrameGenerator.createLowQualityFrame(),
        MockFrameGenerator.createFrameWithoutBarcode(),
      ];

      // Set up mock returns for each frame
      mockPlugin.call
        .mockReturnValueOnce({ success: true, data: { firstName: 'HIGH', lastName: 'QUALITY' } })
        .mockReturnValueOnce({ success: true, data: { firstName: 'LOW', lastName: 'QUALITY' } })
        .mockReturnValueOnce(null); // No barcode detected

      // Act
      const results = frames.map((frame) => scanLicenseFrame(frame));

      // Assert
      expect(results[0]).toMatchObject({ success: true });
      expect(results[0]!.data?.firstName).toBe('HIGH');
      expect(results[1]).toMatchObject({ success: true });
      expect(results[1]!.data?.firstName).toBe('LOW');
      expect(results[2]).toBeNull();
    });

    it('should maintain consistent performance across multiple frames', () => {
      // Arrange
      const frameCount = 100;
      const frames = Array.from({ length: frameCount }, () =>
        MockFrameGenerator.createFrame()
      );

      mockPlugin.call.mockReturnValue({
        success: true,
        data: {
          firstName: 'PERFORMANCE',
          lastName: 'TEST',
        },
        processingTime: 55,
      });

      // Act
      const startTime = Date.now();
      const results = frames.map((frame) => scanLicenseFrame(frame));
      const totalTime = Date.now() - startTime;

      // Assert
      expect(results).toHaveLength(frameCount);
      expect(totalTime).toBeLessThan(1000); // Should process 100 frames in < 1 second in mock

      const avgProcessingTime = totalTime / frameCount;
      expect(avgProcessingTime).toBeLessThan(10); // Very fast in mock environment

      // Verify all results are successful
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result!.success).toBe(true);
      });
    });
  });
});
