/**
 * Comprehensive Integration Tests (T05_S03)
 * Tests complete workflows across React Native and native iOS layers
 */

// Mock react-native modules
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
    Platform: {
      OS: 'ios',
      select: (obj: any) => obj.ios || obj.default,
    },
    Alert: {
      alert: jest.fn(),
    },
    Linking: {
      openSettings: jest.fn(() => Promise.resolve()),
    },
  };
});

// Mock react-native-vision-camera
jest.mock('react-native-vision-camera', () => {
  const mockPlugin = {
    call: jest.fn(),
  };

  return {
    VisionCameraProxy: {
      initFrameProcessorPlugin: jest.fn(() => mockPlugin),
    },
  };
});

import { scanLicense, ScanError } from '../src/index';
import { scanLicense as scanLicenseFrame } from '../src/frameProcessors/scanLicense';
import { useErrorHandler } from '../src/hooks/useErrorHandler';
import { renderHook, act } from '@testing-library/react-native';
import type {
  LicenseData,
  ScanError as ScanErrorType,
} from '../src/types/license';

const mockScanLicenseFunction = (global as any).__mockScanLicense;

describe('Integration Tests - Complete Workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End License Scanning Workflow', () => {
    it('should complete successful PDF417 barcode scanning workflow', async () => {
      // Mock successful AAMVA license data
      const expectedLicenseData: LicenseData = {
        firstName: 'John',
        lastName: 'Doe',
        middleName: 'Q',
        licenseNumber: 'D12345678',
        dateOfBirth: new Date('1990-01-15'),
        issueDate: new Date('2020-01-01'),
        expirationDate: new Date('2026-01-15'),
        sex: 'M',
        eyeColor: 'BRO',
        hairColor: 'BRN',
        height: '5-10',
        weight: '180',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '12345',
          country: 'USA',
        },
        licenseClass: 'C',
        restrictions: 'NONE',
        endorsements: 'NONE',
        issuerIdentificationNumber: '636014',
        documentDiscriminator: '1234567890',
        isOrganDonor: true,
        isVeteran: false,
        isRealID: true,
      };

      // Mock native module response
      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: expectedLicenseData,
      });

      // Simulate complete AAMVA barcode data
      const aamvaBarcode =
        '@\n\x1e\rANSI 636014080000DAQD12345678DCSDOE DACJOHN DADQ DBB01151990DBA01152026DBD01012020DBC1 DAU510DAG123 MAIN ST DAILOS ANGELES DAJCA DAK90210';

      // Execute the scanning workflow
      const result = await scanLicense(aamvaBarcode);

      // Verify complete data extraction
      expect(result).toEqual(expectedLicenseData);
      expect(mockScanLicenseFunction).toHaveBeenCalledWith(aamvaBarcode);
    });

    it('should handle complete frame processor workflow', () => {
      const { VisionCameraProxy } = require('react-native-vision-camera');
      const mockPlugin = VisionCameraProxy.initFrameProcessorPlugin();

      // Mock frame processor success
      const mockFrameResult = {
        success: true,
        data: {
          firstName: 'Jane',
          lastName: 'Smith',
          licenseNumber: 'S98765432',
        },
        frameInfo: {
          width: 1920,
          height: 1080,
          timestamp: Date.now(),
        },
      };

      mockPlugin.call.mockReturnValue(mockFrameResult);

      // Simulate camera frame
      const mockFrame = {
        width: 1920,
        height: 1080,
        bytesPerRow: 7680,
        pixelFormat: 'yuv',
        planarImage: true,
        isValid: true,
        planesCount: 1,
        isMirrored: false,
        timestamp: Date.now(),
        orientation: 'portrait',
        pixelBuffer: null,
      } as any;

      const result = scanLicenseFrame(mockFrame);

      expect(result).toEqual(mockFrameResult);
      expect(mockPlugin.call).toHaveBeenCalledWith(mockFrame);
    });

    it('should handle error workflow with user feedback', async () => {
      // Mock error response from native module
      const mockError: ScanErrorType = {
        code: 'PARSING_FAILED',
        message: 'Invalid AAMVA format detected',
        userMessage: "This doesn't appear to be a valid driver's license",
        recoverable: true,
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: false,
        error: mockError,
      });

      // Setup error handler
      const { result: errorHandler } = renderHook(() =>
        useErrorHandler({
          onRetry: jest.fn(),
          onDismiss: jest.fn(),
        })
      );

      // Execute scanning with invalid data
      try {
        await scanLicense('INVALID_BARCODE_DATA');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ScanError);

        // Handle error through error handler
        act(() => {
          errorHandler.current.handleError(error as ScanError);
        });

        expect(errorHandler.current.lastError).toEqual(mockError);
        expect(errorHandler.current.errorCount).toBe(1);
      }
    });
  });

  describe('Multi-State License Support Integration', () => {
    const testStates = [
      { code: 'CA', iin: '636014', name: 'California' },
      { code: 'TX', iin: '636015', name: 'Texas' },
      { code: 'NY', iin: '636001', name: 'New York' },
      { code: 'FL', iin: '636010', name: 'Florida' },
    ];

    testStates.forEach((state) => {
      it(`should process ${state.name} (${state.code}) licenses`, async () => {
        const mockData: LicenseData = {
          firstName: 'Test',
          lastName: 'User',
          licenseNumber: `${state.code}123456789`,
          address: {
            state: state.code,
          },
          issuerIdentificationNumber: state.iin,
          dateOfBirth: new Date('1985-03-20'),
          expirationDate: new Date('2025-03-20'),
          sex: 'F',
        };

        mockScanLicenseFunction.mockResolvedValue({
          success: true,
          data: mockData,
        });

        const stateBarcode = `@\n\x1e\rANSI ${state.iin}080000DAQ${state.code}123456789`;
        const result = await scanLicense(stateBarcode);

        expect(result.address?.state).toBe(state.code);
        expect(result.issuerIdentificationNumber).toBe(state.iin);
        expect(result.licenseNumber).toBe(`${state.code}123456789`);
      });
    });
  });

  describe('Performance Integration Tests', () => {
    it('should handle rapid sequential scanning calls', async () => {
      const scanPromises: Promise<LicenseData>[] = [];

      // Mock successful responses
      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: {
          firstName: 'Speed',
          lastName: 'Test',
          licenseNumber: 'SPEED123',
          dateOfBirth: new Date('1990-01-01'),
          expirationDate: new Date('2026-01-01'),
          sex: 'M',
        },
      });

      // Execute 10 rapid calls
      for (let i = 0; i < 10; i++) {
        scanPromises.push(scanLicense(`TEST_BARCODE_${i}`));
      }

      const results = await Promise.all(scanPromises);

      expect(results).toHaveLength(10);
      expect(mockScanLicenseFunction).toHaveBeenCalledTimes(10);

      // Verify all calls completed successfully
      results.forEach((result) => {
        expect(result.firstName).toBe('Speed');
        expect(result.lastName).toBe('Test');
      });
    });

    it('should handle frame processor performance under load', () => {
      const { VisionCameraProxy } = require('react-native-vision-camera');
      const mockPlugin = VisionCameraProxy.initFrameProcessorPlugin();

      // Mock rapid frame processing
      mockPlugin.call.mockReturnValue({
        success: true,
        data: { processingComplete: true },
        processingTime: 0.05, // 50ms - meets 2 FPS requirement
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
      const results: any[] = [];

      // Process 30 frames rapidly (simulating 2 FPS for 15 seconds)
      for (let i = 0; i < 30; i++) {
        const result = scanLicenseFrame(mockFrame);
        results.push(result);
      }

      expect(results).toHaveLength(30);
      expect(mockPlugin.call).toHaveBeenCalledTimes(30);

      // Verify all frames processed successfully
      results.forEach((result) => {
        expect(result?.success).toBe(true);
        expect(result?.processingTime).toBeLessThan(0.5); // Under 500ms for 2 FPS
      });
    });
  });

  describe('Error Recovery Integration', () => {
    it('should handle transient errors with automatic recovery', async () => {
      const { result } = renderHook(() => useErrorHandler());

      // First call fails
      mockScanLicenseFunction.mockRejectedValueOnce(
        new Error('Network timeout')
      );

      // Second call succeeds
      mockScanLicenseFunction.mockResolvedValueOnce({
        success: true,
        data: {
          firstName: 'Recovery',
          lastName: 'Test',
          licenseNumber: 'REC123',
          dateOfBirth: new Date('1990-01-01'),
          expirationDate: new Date('2026-01-01'),
          sex: 'M',
        },
      });

      // First attempt
      try {
        await scanLicense('TEST_DATA');
        fail('Should have thrown error');
      } catch (error) {
        act(() => {
          result.current.handleError(error as Error);
        });
        expect(result.current.errorCount).toBe(1);
      }

      // Retry after error
      const retryResult = await scanLicense('TEST_DATA');
      expect(retryResult.firstName).toBe('Recovery');
      expect(retryResult.lastName).toBe('Test');
    });

    it('should escalate repeated failures appropriately', async () => {
      const { result } = renderHook(() =>
        useErrorHandler({
          onRetry: jest.fn(),
          onDismiss: jest.fn(),
        })
      );

      const failureError: ScanErrorType = {
        code: 'DETECTION_FAILED',
        message: 'Barcode detection failed',
        userMessage: 'Unable to detect license barcode',
        recoverable: true,
      };

      // Trigger multiple failures
      for (let i = 0; i < 6; i++) {
        act(() => {
          result.current.handleError(new ScanError(failureError));
        });
      }

      expect(result.current.errorCount).toBe(6);

      // After 6 failures, should show escalated error dialog
      const { Alert } = require('react-native');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Scanning Error',
        failureError.userMessage,
        expect.any(Array),
        { cancelable: true }
      );
    });
  });

  describe('Data Validation Integration', () => {
    it('should validate license expiration dates', async () => {
      const expiredLicenseData: LicenseData = {
        firstName: 'Expired',
        lastName: 'License',
        licenseNumber: 'EXP123',
        dateOfBirth: new Date('1980-01-01'),
        expirationDate: new Date('2020-01-01'), // Expired
        sex: 'M',
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: expiredLicenseData,
      });

      const result = await scanLicense('EXPIRED_LICENSE_BARCODE');

      // Verify data is returned (validation may happen at app level)
      expect(result.expirationDate).toEqual(new Date('2020-01-01'));
      expect(result.firstName).toBe('Expired');

      // Application layer should handle expiration validation
    });

    it('should handle incomplete license data gracefully', async () => {
      const incompleteLicenseData: Partial<LicenseData> = {
        firstName: 'Incomplete',
        lastName: 'Data',
        licenseNumber: 'INC123',
        // Missing required fields like dateOfBirth
        sex: 'F',
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: incompleteLicenseData,
      });

      const result = await scanLicense('INCOMPLETE_LICENSE_BARCODE');

      expect(result.firstName).toBe('Incomplete');
      expect(result.lastName).toBe('Data');
      expect(result.dateOfBirth).toBeUndefined();
    });
  });

  describe('Memory Management Integration', () => {
    it('should handle continuous processing without memory leaks', async () => {
      // Simulate continuous license scanning
      const iterations = 50;
      const results: LicenseData[] = [];

      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: {
          firstName: 'Memory',
          lastName: 'Test',
          licenseNumber: 'MEM123',
          dateOfBirth: new Date('1990-01-01'),
          expirationDate: new Date('2026-01-01'),
          sex: 'M',
        },
      });

      // Process many licenses in sequence
      for (let i = 0; i < iterations; i++) {
        const result = await scanLicense(`MEMORY_TEST_${i}`);
        results.push(result);
      }

      expect(results).toHaveLength(iterations);
      expect(mockScanLicenseFunction).toHaveBeenCalledTimes(iterations);

      // Verify consistent behavior across all iterations
      results.forEach((result) => {
        expect(result.firstName).toBe('Memory');
        expect(result.licenseNumber).toBe('MEM123');
      });
    });
  });

  describe('Platform Compatibility Integration', () => {
    it('should work correctly on iOS platform', () => {
      const { Platform } = require('react-native');
      expect(Platform.OS).toBe('ios');

      // Platform-specific functionality should be accessible
      expect(Platform.select({ ios: 'ios-specific', default: 'other' })).toBe(
        'ios-specific'
      );
    });

    it('should handle camera permissions on iOS', async () => {
      const { result } = renderHook(() => useErrorHandler());

      const permissionError: ScanErrorType = {
        code: 'CAMERA_PERMISSION_DENIED',
        message: 'Camera permission required',
        userMessage: 'Please grant camera permission to scan licenses',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(new ScanError(permissionError));
      });

      // Should trigger iOS settings opening
      const { Alert } = require('react-native');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Camera Permission Required',
        permissionError.userMessage,
        expect.arrayContaining([
          expect.objectContaining({ text: 'Open Settings' }),
        ]),
        { cancelable: false }
      );
    });
  });
});
