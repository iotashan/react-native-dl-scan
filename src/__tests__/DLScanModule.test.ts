import { NativeModules } from 'react-native';
import DLScanModule from '../DLScanModule';

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
}));

describe('DLScanModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startScanning', () => {
    it('should initialize camera with correct config', async () => {
      // Arrange
      const mockConfig = { mode: 'pdf417' };
      NativeModules.DlScan.startScanning.mockResolvedValue(true);

      // Act
      await DLScanModule.startScanning(mockConfig);

      // Assert
      expect(NativeModules.DlScan.startScanning).toHaveBeenCalledWith(
        mockConfig
      );
    });

    it('should throw error when camera permission is denied', async () => {
      // Arrange
      const error = new Error('Camera permission denied');
      NativeModules.DlScan.startScanning.mockRejectedValue(error);

      // Act & Assert
      await expect(DLScanModule.startScanning({})).rejects.toThrow(
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
      const result = await DLScanModule.scanLicense({ mode: 'auto' });

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
      const result = await DLScanModule.scanLicense({ mode: 'auto' });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockOCRData);
      expect(result.mode).toBe('ocr');
    });
  });

  describe('parseOCRText', () => {
    it('should parse OCR text and return structured data', async () => {
      // Arrange
      const ocrText = `
        DRIVER LICENSE
        JOHN DOE
        123 MAIN ST
        DLN D123456789
        DOB 01/01/1990
        EXP 01/01/2025
      `;
      const expectedData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        documentNumber: 'D123456789',
        dateOfBirth: '01/01/1990',
        dateOfExpiry: '01/01/2025',
      };
      NativeModules.DlScan.parseOCRText.mockResolvedValue({
        success: true,
        fields: expectedData,
      });

      // Act
      const result = await DLScanModule.parseOCRText(ocrText);

      // Assert
      expect(result.success).toBe(true);
      expect(result.fields).toEqual(expectedData);
    });

    it('should handle parsing errors gracefully', async () => {
      // Arrange
      const malformedText = '!@#$%^&*()';
      NativeModules.DlScan.parseOCRText.mockResolvedValue({
        success: false,
        error: 'Unable to parse text',
      });

      // Act
      const result = await DLScanModule.parseOCRText(malformedText);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unable to parse text');
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
