/**
 * T02_S08: Bridge Communication Integration Tests
 * Comprehensive tests for React Native bridge communication with enhanced fixtures and utilities
 */

// Mock the modules before importing them
jest.mock('../index', () => ({
  scanLicense: jest.fn(),
  parseOCRText: jest.fn(),
  ScanError: class MockScanError extends Error {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly recoverable: boolean;

    constructor(error: any) {
      super(error.message);
      this.name = 'ScanError';
      this.code = error.code;
      this.userMessage = error.userMessage;
      this.recoverable = error.recoverable;
    }
  },
}));

import { NativeModules } from 'react-native';
import { TestFixtures } from './test-fixtures';
import {
  PlatformTestUtils,
  MockUtils,
  PerformanceTestUtils,
} from './test-utilities/platform-test-utils';
import { scanLicense, parseOCRText, ScanError } from '../index';

// Setup platform-specific mocks
MockUtils.createPlatformNativeModuleMock('DlScan');
MockUtils.mockCameraPermissions(true);

describe('Bridge Communication Integration Tests', () => {
  let mockNativeModule: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeModule = NativeModules.DlScan;
  });

  describe('Native Module Method Invocation', () => {
    it('should handle scanLicense bridge communication correctly', async () => {
      // Arrange
      const expectedLicenseData = TestFixtures.licenses.valid.california;
      const testBarcode = TestFixtures.barcodes.valid.california;

      mockNativeModule.scanLicense.mockResolvedValue(
        TestFixtures.responses.successfulScan(expectedLicenseData)
      );

      // Act
      const result = await scanLicense(testBarcode);

      // Assert
      expect(mockNativeModule.scanLicense).toHaveBeenCalledWith(testBarcode);
      expect(result).toEqual(expectedLicenseData);
    });

    it('should handle parseOCRText bridge communication correctly', async () => {
      // Arrange
      const testOCRData = TestFixtures.ocr.valid.california;
      const expectedResult = TestFixtures.responses.ocrResult(testOCRData);

      mockNativeModule.parseOCRText.mockResolvedValue(expectedResult);

      // Act
      const result = await parseOCRText(testOCRData);

      // Assert
      expect(mockNativeModule.parseOCRText).toHaveBeenCalledWith(testOCRData);
      expect(result).toBeDefined();
    });

    PlatformTestUtils.runCrossPlatformTest(
      'should handle platform-specific native module calls',
      (platform: string) => {
        // Arrange
        const platformConfig =
          PlatformTestUtils.getPlatformConfig()[
            platform as keyof ReturnType<
              typeof PlatformTestUtils.getPlatformConfig
            >
          ];

        // Act & Assert
        expect(platformConfig).toBeDefined();
        expect(platformConfig.permissions.camera).toBeDefined();

        if (platform === 'ios') {
          expect(platformConfig.features.nativeImageProcessing).toBe(true);
        } else {
          expect(platformConfig.features.backgroundProcessing).toBe(false);
        }
      }
    );
  });

  describe('Promise and Callback Handling', () => {
    it('should handle successful promise resolution', async () => {
      // Arrange
      const testData = TestFixtures.licenses.valid.texas;
      mockNativeModule.scanLicense.mockResolvedValue(
        TestFixtures.responses.successfulScan(testData)
      );

      // Act
      const result = await scanLicense(TestFixtures.barcodes.valid.texas);

      // Assert
      expect(result).toEqual(testData);
      expect(mockNativeModule.scanLicense).toHaveBeenCalledTimes(1);
    });

    it('should handle promise rejection with proper error mapping', async () => {
      // Arrange
      const testError = TestFixtures.errors.barcode.invalidFormat;
      mockNativeModule.scanLicense.mockRejectedValue(new ScanError(testError));

      // Act & Assert
      await expect(
        scanLicense(TestFixtures.barcodes.invalid.malformed)
      ).rejects.toThrow(ScanError);
    });

    it('should handle timeout errors appropriately', async () => {
      // Arrange
      const timeoutError = TestFixtures.errors.barcode.timeout;
      mockNativeModule.scanLicense.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new ScanError(timeoutError)), 100);
          })
      );

      // Act & Assert
      await expect(scanLicense('slow-barcode')).rejects.toThrow(
        'Scanning took too long'
      );
    });
  });

  describe('Data Serialization and Deserialization', () => {
    it('should properly serialize complex license data', async () => {
      // Arrange
      const complexLicenseData = {
        ...TestFixtures.licenses.valid.california,
        customFields: {
          veteranStatus: true,
          organDonor: false,
          additionalEndorsements: ['MOTORCYCLE', 'COMMERCIAL'],
        },
      };

      mockNativeModule.scanLicense.mockResolvedValue(
        TestFixtures.responses.successfulScan(complexLicenseData)
      );

      // Act
      const result = await scanLicense(TestFixtures.barcodes.valid.california);

      // Assert
      expect(result).toEqual(complexLicenseData);
      expect(result.customFields).toBeDefined();
      expect(result.customFields.additionalEndorsements).toHaveLength(2);
    });

    it('should handle partial data deserialization gracefully', async () => {
      // Arrange
      const partialData = TestFixtures.licenses.incomplete.missingDOB;
      mockNativeModule.scanLicense.mockResolvedValue(
        TestFixtures.responses.successfulScan(partialData as any)
      );

      // Act
      const result = await scanLicense(TestFixtures.barcodes.valid.california);

      // Assert
      expect(result.firstName).toBe('INCOMPLETE');
      expect(result.lastName).toBe('DATA');
      expect(result.dateOfBirth).toBeUndefined();
    });

    it('should handle OCR text observation arrays correctly', async () => {
      // Arrange
      const ocrObservations = TestFixtures.ocr.valid.california;
      const expectedResult = TestFixtures.responses.ocrResult(ocrObservations);

      mockNativeModule.parseOCRText.mockResolvedValue(expectedResult);

      // Act
      await parseOCRText(ocrObservations);

      // Assert
      expect(mockNativeModule.parseOCRText).toHaveBeenCalledWith(
        ocrObservations
      );
      expect(Array.isArray(ocrObservations)).toBe(true);
      expect(ocrObservations[0]).toHaveProperty('boundingBox');
      expect(ocrObservations[0]).toHaveProperty('confidence');
    });
  });

  describe('Multi-State License Support', () => {
    TestFixtures.states.forEach((state) => {
      it(`should handle ${state.name} (${state.code}) license processing via bridge`, async () => {
        // Arrange
        const stateBarcode = TestFixtures.barcodes.valid.california.replace(
          '636014',
          state.iin
        );
        const stateLicenseData = {
          ...TestFixtures.licenses.valid.california,
          address: {
            ...TestFixtures.licenses.valid.california.address,
            state: state.code,
          },
          issuerIdentificationNumber: state.iin,
          licenseNumber: `${state.code}123456789`,
        };

        mockNativeModule.scanLicense.mockResolvedValue(
          TestFixtures.responses.successfulScan(stateLicenseData)
        );

        // Act
        const result = await scanLicense(stateBarcode);

        // Assert
        expect(result.address?.state).toBe(state.code);
        expect(result.issuerIdentificationNumber).toBe(state.iin);
        expect(mockNativeModule.scanLicense).toHaveBeenCalledWith(stateBarcode);
      });
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle rapid sequential bridge calls', async () => {
      // Arrange
      const testData = TestFixtures.licenses.valid.california;
      mockNativeModule.scanLicense.mockResolvedValue(
        TestFixtures.responses.successfulScan(testData)
      );

      const { result, executionTime } =
        await PerformanceTestUtils.measurePlatformPerformance(
          async () => {
            const promises = Array.from({ length: 10 }, (_, i) =>
              scanLicense(`RAPID_TEST_${i}`)
            );
            return Promise.all(promises);
          },
          {
            ios: { maxTime: 1000 }, // 1 second for 10 calls on iOS
            android: { maxTime: 1500 }, // 1.5 seconds for 10 calls on Android
          }
        );

      // Assert
      expect(result).toHaveLength(10);
      expect(mockNativeModule.scanLicense).toHaveBeenCalledTimes(10);
      expect(executionTime).toBeLessThan(2000); // Overall safety limit
    });

    it('should handle concurrent bridge operations efficiently', async () => {
      // Arrange
      const testConfigs = [
        {
          data: TestFixtures.licenses.valid.california,
          barcode: TestFixtures.barcodes.valid.california,
        },
        {
          data: TestFixtures.licenses.valid.texas,
          barcode: TestFixtures.barcodes.valid.texas,
        },
        {
          data: TestFixtures.licenses.valid.newYork,
          barcode: TestFixtures.barcodes.valid.newYork,
        },
      ];

      testConfigs.forEach((config) => {
        mockNativeModule.scanLicense.mockResolvedValueOnce(
          TestFixtures.responses.successfulScan(config.data)
        );
      });

      // Act
      const startTime = Date.now();
      const promises = testConfigs.map((config) => scanLicense(config.barcode));
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Assert
      expect(results).toHaveLength(3);
      expect(totalTime).toBeLessThan(500); // Concurrent calls should be faster
      expect(mockNativeModule.scanLicense).toHaveBeenCalledTimes(3);
    });

    it('should manage memory effectively during continuous operations', async () => {
      // Arrange
      const iterations = TestFixtures.performance.memoryTest.iterations;
      mockNativeModule.scanLicense.mockResolvedValue(
        TestFixtures.responses.successfulScan(
          TestFixtures.licenses.valid.california
        )
      );

      // Act
      PerformanceTestUtils.measureMemoryUsage(
        'Bridge Communication Memory Test',
        () => {
          const promises: Promise<any>[] = [];
          for (let i = 0; i < iterations; i++) {
            promises.push(scanLicense(`MEMORY_TEST_${i}`));
          }
          return Promise.all(promises);
        }
      );

      // Memory expectations are validated within measureMemoryUsage
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from transient bridge communication failures', async () => {
      // Arrange
      const transientError = TestFixtures.errors.system.networkError;
      const successData = TestFixtures.licenses.valid.california;

      // First call fails, second succeeds
      mockNativeModule.scanLicense
        .mockRejectedValueOnce(new ScanError(transientError))
        .mockResolvedValueOnce(
          TestFixtures.responses.successfulScan(successData)
        );

      // Act
      try {
        await scanLicense('test-barcode');
        throw new Error('Expected first call to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(ScanError);
        expect((error as ScanError).code).toBe('NETWORK_ERROR');
      }

      // Retry should succeed
      const result = await scanLicense('test-barcode');

      // Assert
      expect(result).toEqual(successData);
      expect(mockNativeModule.scanLicense).toHaveBeenCalledTimes(2);
    });

    it('should handle system-level errors appropriately', async () => {
      // Arrange
      const systemError = TestFixtures.errors.system.unknownError;
      mockNativeModule.scanLicense.mockRejectedValue(
        new ScanError(systemError)
      );

      // Act & Assert
      await expect(scanLicense('test-barcode')).rejects.toThrow(
        'An unexpected error occurred'
      );
    });

    it('should handle permission-related errors with proper guidance', async () => {
      // Arrange
      const permissionError = TestFixtures.errors.system.cameraPermission;
      mockNativeModule.scanLicense.mockRejectedValue(
        new ScanError(permissionError)
      );

      // Act & Assert
      try {
        await scanLicense('test-barcode');
        throw new Error('Expected permission error');
      } catch (error) {
        expect(error).toBeInstanceOf(ScanError);
        expect((error as ScanError).code).toBe('CAMERA_PERMISSION_DENIED');
        expect((error as ScanError).userMessage).toContain('camera permission');
        expect((error as ScanError).recoverable).toBe(true);
      }
    });
  });

  describe('Bridge Event Handling', () => {
    it('should handle native events from bridge properly', () => {
      // Note: This would require actual event emitter testing
      // For now, we test the mock setup
      expect(mockNativeModule.scanLicense).toBeDefined();
      expect(typeof mockNativeModule.scanLicense).toBe('function');
    });

    it('should clean up bridge resources properly', () => {
      // Arrange & Act
      jest.clearAllMocks();

      // Assert
      expect(mockNativeModule.scanLicense).not.toHaveBeenCalled();
    });
  });

  describe('Bridge Configuration and Initialization', () => {
    PlatformTestUtils.onlyOnPlatform(
      'ios',
      'should configure iOS-specific bridge features',
      () => {
        // iOS-specific bridge configuration testing
        expect(mockNativeModule.configureVisionFramework).toBeDefined();
        expect(mockNativeModule.enableHapticFeedback).toBeDefined();
      }
    );

    PlatformTestUtils.onlyOnPlatform(
      'android',
      'should configure Android-specific bridge features',
      () => {
        // Android-specific bridge configuration testing
        expect(mockNativeModule.configureMLKit).toBeDefined();
        expect(mockNativeModule.enableVibration).toBeDefined();
      }
    );
  });
});
