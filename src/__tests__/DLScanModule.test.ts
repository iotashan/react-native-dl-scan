import { NativeModules } from 'react-native';
import DLScanModule from '../NativeDlScan';
import type { OCRTextObservation } from '../types/license';

// Mock the native module
jest.mock('react-native', () => ({
  NativeModules: {
    DlScan: {
      scanLicense: jest.fn(),
      parseOCRText: jest.fn(),
      startScanning: jest.fn(),
      stopScanning: jest.fn(),
    },
  },
  TurboModuleRegistry: {
    getEnforcing: jest.fn(() => ({
      scanLicense: jest.fn(),
      parseOCRText: jest.fn(),
      startScanning: jest.fn(),
      stopScanning: jest.fn(),
    })),
  },
}));

describe('DLScanModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startScanning', () => {
    it('should initialize camera', async () => {
      // Arrange
      NativeModules.DlScan.startScanning.mockResolvedValue(undefined);

      // Act
      await DLScanModule.startScanning();

      // Assert
      expect(NativeModules.DlScan.startScanning).toHaveBeenCalled();
    });

    it('should throw error when camera permission is denied', async () => {
      // Arrange
      const error = new Error('Camera permission denied');
      NativeModules.DlScan.startScanning.mockRejectedValue(error);

      // Act & Assert
      await expect(DLScanModule.startScanning()).rejects.toThrow(
        'Camera permission denied'
      );
    });
  });

  describe('scanLicense', () => {
    it('should return parsed license data on successful scan', async () => {
      // Arrange
      const mockLicenseData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        documentNumber: 'D123456789',
        dateOfBirth: '01/01/1990',
        dateOfExpiry: '01/01/2025',
      };
      NativeModules.DlScan.scanLicense.mockResolvedValue({
        success: true,
        data: mockLicenseData,
      });

      // Act
      const result = await DLScanModule.scanLicense('mock-barcode-data');

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockLicenseData);
    });

    it('should handle OCR fallback when barcode fails', async () => {
      // Arrange
      const mockOCRData = {
        firstName: 'JANE',
        lastName: 'SMITH',
        confidence: 0.85,
      };
      NativeModules.DlScan.scanLicense
        .mockResolvedValueOnce({ success: false, error: 'Barcode not found' })
        .mockResolvedValueOnce({
          success: true,
          data: mockOCRData,
          mode: 'ocr',
        });

      // Act
      const result = await DLScanModule.scanLicense('mock-barcode-data');

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockOCRData);
      expect((result as any).mode).toBe('ocr');
    });
  });

  describe('parseOCRText', () => {
    it('should parse OCR text and return structured data', async () => {
      // Arrange
      const ocrObservations: OCRTextObservation[] = [
        {
          text: 'DRIVER LICENSE',
          confidence: 0.95,
          boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        },
        {
          text: 'JOHN DOE',
          confidence: 0.92,
          boundingBox: { x: 0, y: 30, width: 100, height: 20 },
        },
        {
          text: '123 MAIN ST',
          confidence: 0.88,
          boundingBox: { x: 0, y: 60, width: 100, height: 20 },
        },
        {
          text: 'DLN D123456789',
          confidence: 0.9,
          boundingBox: { x: 0, y: 90, width: 100, height: 20 },
        },
        {
          text: 'DOB 01/01/1990',
          confidence: 0.89,
          boundingBox: { x: 0, y: 120, width: 100, height: 20 },
        },
        {
          text: 'EXP 01/01/2025',
          confidence: 0.91,
          boundingBox: { x: 0, y: 150, width: 100, height: 20 },
        },
      ];
      const expectedData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        documentNumber: 'D123456789',
        dateOfBirth: new Date('1990-01-01'),
        dateOfExpiry: new Date('2025-01-01'),
        success: true,
      };
      NativeModules.DlScan.parseOCRText.mockResolvedValue(expectedData);

      // Act
      const result = await DLScanModule.parseOCRText(ocrObservations);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data?.firstName).toBe('JOHN');
      expect(result.data?.lastName).toBe('DOE');
    });

    it('should handle parsing errors gracefully', async () => {
      // Arrange
      const malformedObservations: OCRTextObservation[] = [
        {
          text: '!@#$%^&*()',
          confidence: 0.1,
          boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        },
      ];
      NativeModules.DlScan.parseOCRText.mockResolvedValue({
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'Unable to parse text',
        },
      });

      // Act
      const result = await DLScanModule.parseOCRText(malformedObservations);

      // Assert
      expect(result.success).toBe(false);
      expect((result as any).error.message).toBe('Unable to parse text');
    });
  });

  describe('stopScanning', () => {
    it('should stop camera and clean up resources', async () => {
      // Arrange
      NativeModules.DlScan.stopScanning.mockResolvedValue(true);

      // Act
      await DLScanModule.stopScanning();

      // Assert
      expect(NativeModules.DlScan.stopScanning).toHaveBeenCalled();
    });
  });
});
