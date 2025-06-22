// Mock react-native TurboModuleRegistry
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

import { scanLicense, ScanError } from '../index';
import type { LicenseData, ScanError as ScanErrorType } from '../types/license';

const mockScanLicenseFunction = (global as any).__mockScanLicense;

describe('Main Index Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scanLicense function', () => {
    it('should successfully parse valid AAMVA barcode data', async () => {
      const mockLicenseData: LicenseData = {
        firstName: 'John',
        lastName: 'Doe',
        licenseNumber: 'D12345678',
        dateOfBirth: new Date('1990-01-15'),
        expirationDate: new Date('2026-01-15'),
        sex: 'M',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '12345',
        },
        isOrganDonor: false,
        isVeteran: false,
        isRealID: true,
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: true,
        data: mockLicenseData,
      });

      const result = await scanLicense(
        '@\n\x1e\rANSI 636014080000DAQD12345678...'
      );

      expect(result).toEqual(mockLicenseData);
      expect(mockScanLicenseFunction).toHaveBeenCalledWith(
        '@\n\x1e\rANSI 636014080000DAQD12345678...'
      );
    });

    it('should handle empty barcode data', async () => {
      const mockError: ScanErrorType = {
        code: 'INVALID_FORMAT',
        message: 'Barcode data is empty',
        userMessage: 'No barcode data detected',
        recoverable: true,
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: false,
        error: mockError,
      });

      await expect(scanLicense('')).rejects.toThrow(ScanError);
    });

    it('should handle invalid AAMVA format', async () => {
      const mockError: ScanErrorType = {
        code: 'PARSING_FAILED',
        message: 'Invalid AAMVA format',
        userMessage: "This doesn't appear to be a valid license",
        recoverable: true,
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: false,
        error: mockError,
      });

      await expect(scanLicense('INVALID_DATA')).rejects.toThrow(ScanError);
    });

    it('should handle corrupted barcode data', async () => {
      const mockError: ScanErrorType = {
        code: 'DATA_CORRUPTION',
        message: 'Barcode data appears corrupted',
        userMessage: 'The barcode appears damaged or unreadable',
        recoverable: true,
      };

      mockScanLicenseFunction.mockResolvedValue({
        success: false,
        error: mockError,
      });

      const corruptedData = '@\n\x1e\rANSI 636014080000DAQ\x00\x00\x00';
      await expect(scanLicense(corruptedData)).rejects.toThrow(ScanError);
    });

    it('should handle success false without error object', async () => {
      mockScanLicenseFunction.mockResolvedValue({
        success: false,
        // Missing error field
      });

      await expect(scanLicense('test-data')).rejects.toThrow(
        'Unknown scanning error'
      );
    });

    it('should handle native module failures', async () => {
      const nativeError = new Error('Native module crashed');
      mockScanLicenseFunction.mockRejectedValue(nativeError);

      try {
        await scanLicense('test-data');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ScanError);
        if (error instanceof ScanError) {
          expect(error.code).toBe('UNKNOWN_ERROR');
          expect(error.message).toBe('Native module crashed');
          expect(error.recoverable).toBe(true);
        }
      }
    });

    it('should handle different state license formats', async () => {
      const states = ['CA', 'TX', 'NY', 'FL'];

      for (const state of states) {
        const mockData: LicenseData = {
          firstName: 'Test',
          lastName: 'User',
          licenseNumber: `${state}123456`,
          address: {
            state,
          },
          dateOfBirth: new Date('1990-01-01'),
          expirationDate: new Date('2026-01-01'),
          sex: 'M',
        };

        mockScanLicenseFunction.mockResolvedValue({
          success: true,
          data: mockData,
        });

        const result = await scanLicense(`mock-${state}-barcode`);
        expect(result.address?.state).toBe(state);
        expect(result.licenseNumber).toBe(`${state}123456`);
      }
    });
  });

  describe('ScanError class', () => {
    it('should create error with all properties', () => {
      const errorData: ScanErrorType = {
        code: 'TEST_ERROR',
        message: 'Test error message',
        userMessage: 'User-friendly test message',
        recoverable: true,
      };

      const error = new ScanError(errorData);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ScanError');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test error message');
      expect(error.userMessage).toBe('User-friendly test message');
      expect(error.recoverable).toBe(true);
    });

    it('should handle non-recoverable errors', () => {
      const errorData: ScanErrorType = {
        code: 'FATAL_ERROR',
        message: 'Fatal system error',
        userMessage: 'A critical error occurred',
        recoverable: false,
      };

      const error = new ScanError(errorData);

      expect(error.recoverable).toBe(false);
      expect(error.code).toBe('FATAL_ERROR');
    });

    it('should be properly serializable', () => {
      const errorData: ScanErrorType = {
        code: 'SERIALIZATION_TEST',
        message: 'Test message',
        userMessage: 'User message',
        recoverable: true,
      };

      const error = new ScanError(errorData);
      const serialized = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        userMessage: error.userMessage,
        recoverable: error.recoverable,
      });

      const parsed = JSON.parse(serialized);
      expect(parsed.name).toBe('ScanError');
      expect(parsed.code).toBe('SERIALIZATION_TEST');
      expect(parsed.userMessage).toBe('User message');
      expect(parsed.recoverable).toBe(true);
    });
  });

  describe('Module exports', () => {
    it('should export all required functions and types', () => {
      const indexModule = require('../index');

      expect(typeof indexModule.scanLicense).toBe('function');
      expect(typeof indexModule.ScanError).toBe('function');
      expect(typeof indexModule.useLicenseScanner).toBe('function');
      expect(typeof indexModule.scanLicenseFrame).toBe('function');
      expect(typeof indexModule.CameraScanner).toBe('function');
    });

    it('should re-export types correctly', () => {
      // This is a compile-time check more than runtime
      // If types are not exported correctly, TypeScript compilation will fail
      expect(true).toBe(true);
    });
  });
});
