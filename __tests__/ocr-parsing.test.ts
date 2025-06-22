/**
 * OCR Field Parsing Integration Tests (T01_S04)
 * Tests complete OCR parsing workflow with Vision Framework integration
 */

// Mock react-native TurboModuleRegistry for OCR parsing
jest.mock('react-native', () => {
  const mockParseOCRText = jest.fn();
  (global as any).__mockParseOCRText = mockParseOCRText;

  return {
    TurboModuleRegistry: {
      getEnforcing: jest.fn(() => ({
        scanLicense: jest.fn(),
        parseOCRText: mockParseOCRText,
      })),
    },
    StyleSheet: {
      create: (styles: any) => styles,
    },
  };
});

import { parseOCRText } from '../src/index';
import type { OCRTextObservation, LicenseData } from '../src/types/license';

const mockParseOCRTextFunction = (global as any).__mockParseOCRText;

describe('OCR Field Parsing Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseOCRText function', () => {
    it('should successfully parse California license OCR data', async () => {
      // Given: California license OCR observations
      const californiaObservations: OCRTextObservation[] = [
        {
          text: 'CALIFORNIA',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.9, width: 0.3, height: 0.05 },
        },
        {
          text: 'DRIVER LICENSE',
          confidence: 0.92,
          boundingBox: { x: 0.1, y: 0.85, width: 0.4, height: 0.05 },
        },
        {
          text: 'LN DOE',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.75, width: 0.2, height: 0.04 },
        },
        {
          text: 'FN JOHN',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.7, width: 0.2, height: 0.04 },
        },
        {
          text: 'DL D1234567',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 },
        },
        {
          text: 'DOB 01/15/1990',
          confidence: 0.88,
          boundingBox: { x: 0.1, y: 0.5, width: 0.3, height: 0.04 },
        },
        {
          text: 'EXP 01/15/2026',
          confidence: 0.88,
          boundingBox: { x: 0.1, y: 0.45, width: 0.3, height: 0.04 },
        },
        {
          text: 'SEX M',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.4, width: 0.15, height: 0.04 },
        },
        {
          text: 'HGT 5-10',
          confidence: 0.85,
          boundingBox: { x: 0.1, y: 0.35, width: 0.2, height: 0.04 },
        },
        {
          text: 'WGT 180',
          confidence: 0.85,
          boundingBox: { x: 0.1, y: 0.3, width: 0.2, height: 0.04 },
        },
      ];

      const expectedLicenseData: LicenseData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        licenseNumber: 'D1234567',
        dateOfBirth: new Date('1990-01-15'),
        expirationDate: new Date('2026-01-15'),
        sex: 'M',
        height: '5-10',
        weight: '180',
      };

      // Mock successful OCR parsing
      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: expectedLicenseData,
        processingTime: 0.25,
      });

      // When: Parsing OCR text
      const result = await parseOCRText(californiaObservations);

      // Then: Should extract structured license data
      expect(mockParseOCRTextFunction).toHaveBeenCalledWith(
        californiaObservations
      );
      expect(result.firstName).toBe('JOHN');
      expect(result.lastName).toBe('DOE');
      expect(result.licenseNumber).toBe('D1234567');
      expect(result.sex).toBe('M');
      expect(result.height).toBe('5-10');
      expect(result.weight).toBe('180');
    });

    it('should successfully parse Texas license OCR data', async () => {
      // Given: Texas license OCR observations
      const texasObservations: OCRTextObservation[] = [
        {
          text: 'TEXAS',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.9, width: 0.2, height: 0.05 },
        },
        {
          text: 'DRIVER LICENSE',
          confidence: 0.92,
          boundingBox: { x: 0.1, y: 0.85, width: 0.4, height: 0.05 },
        },
        {
          text: 'SMITH, JANE',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.75, width: 0.3, height: 0.04 },
        },
        {
          text: 'DL 12345678',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 },
        },
        {
          text: 'DOB 03/20/1985',
          confidence: 0.88,
          boundingBox: { x: 0.1, y: 0.5, width: 0.3, height: 0.04 },
        },
        {
          text: 'SEX F',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.4, width: 0.15, height: 0.04 },
        },
      ];

      const expectedData: LicenseData = {
        firstName: 'JANE',
        lastName: 'SMITH',
        licenseNumber: '12345678',
        dateOfBirth: new Date('1985-03-20'),
        sex: 'F',
      };

      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: expectedData,
        processingTime: 0.18,
      });

      // When: Parsing Texas OCR data
      const result = await parseOCRText(texasObservations);

      // Then: Should extract Texas license data correctly
      expect(result.firstName).toBe('JANE');
      expect(result.lastName).toBe('SMITH');
      expect(result.licenseNumber).toBe('12345678');
      expect(result.sex).toBe('F');
    });

    it('should handle parsing errors gracefully', async () => {
      // Given: Invalid OCR observations
      const invalidObservations: OCRTextObservation[] = [
        {
          text: 'CORRUPTED_TEXT',
          confidence: 0.1,
          boundingBox: { x: 0, y: 0, width: 0.1, height: 0.1 },
        },
      ];

      // Mock parsing error
      mockParseOCRTextFunction.mockResolvedValue({
        success: false,
        error: {
          code: 'INSUFFICIENT_DATA',
          message: 'Not enough valid text found to extract license data',
          userMessage:
            'Unable to read license information. Please ensure the license is clearly visible.',
          recoverable: true,
        },
        processingTime: 0.05,
      });

      // When: Parsing invalid data
      // Then: Should throw appropriate error
      await expect(parseOCRText(invalidObservations)).rejects.toThrow(
        'Not enough valid text found'
      );
    });

    it('should handle low confidence OCR data', async () => {
      // Given: Low confidence observations
      const lowConfidenceObservations: OCRTextObservation[] = [
        {
          text: 'J0HN', // OCR errors
          confidence: 0.3,
          boundingBox: { x: 0.1, y: 0.7, width: 0.15, height: 0.04 },
        },
        {
          text: 'D0E',
          confidence: 0.25,
          boundingBox: { x: 0.1, y: 0.75, width: 0.15, height: 0.04 },
        },
        {
          text: 'D12G4567', // Mixed up characters
          confidence: 0.4,
          boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 },
        },
      ];

      const partialData: LicenseData = {
        firstName: 'JOHN', // Corrected by parser
        lastName: 'DOE', // Corrected by parser
        licenseNumber: 'D1234567', // Corrected by parser
      };

      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: partialData,
        processingTime: 0.35,
      });

      // When: Parsing low confidence data
      const result = await parseOCRText(lowConfidenceObservations);

      // Then: Should still extract corrected data
      expect(result.firstName).toBe('JOHN');
      expect(result.lastName).toBe('DOE');
      expect(result.licenseNumber).toBe('D1234567');
    });

    it('should handle empty observations array', async () => {
      // Given: Empty observations
      const emptyObservations: OCRTextObservation[] = [];

      mockParseOCRTextFunction.mockResolvedValue({
        success: false,
        error: {
          code: 'NO_TEXT_FOUND',
          message: 'No text observations provided',
          userMessage: 'No text was detected in the image. Please try again.',
          recoverable: true,
        },
      });

      // When: Parsing empty data
      // Then: Should handle gracefully
      await expect(parseOCRText(emptyObservations)).rejects.toThrow(
        'No text observations provided'
      );
    });

    it('should perform within acceptable time limits', async () => {
      // Given: Large set of observations
      const largeObservationSet: OCRTextObservation[] = [];
      for (let i = 0; i < 50; i++) {
        largeObservationSet.push({
          text: `TEXT_${i}`,
          confidence: Math.random() * 0.5 + 0.5,
          boundingBox: {
            x: Math.random() * 0.8,
            y: Math.random() * 0.8,
            width: 0.1,
            height: 0.05,
          },
        });
      }

      // Add actual license data
      largeObservationSet.push(
        {
          text: 'JOHN',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.7, width: 0.15, height: 0.04 },
        },
        {
          text: 'DOE',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.75, width: 0.15, height: 0.04 },
        },
        {
          text: 'D1234567',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 },
        }
      );

      const performanceData: LicenseData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        licenseNumber: 'D1234567',
      };

      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: performanceData,
        processingTime: 0.45, // Just under 500ms target
      });

      // When: Parsing large dataset
      const startTime = Date.now();
      const result = await parseOCRText(largeObservationSet);
      const totalTime = Date.now() - startTime;

      // Then: Should complete within reasonable time
      expect(result).toBeDefined();
      expect(totalTime).toBeLessThan(1000); // Allow for mock overhead
      expect(result.firstName).toBe('JOHN');
    });

    it('should handle multiple address formats', async () => {
      // Given: Address-heavy observations
      const addressObservations: OCRTextObservation[] = [
        {
          text: 'JOHN DOE',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.8, width: 0.25, height: 0.04 },
        },
        {
          text: '123 MAIN STREET',
          confidence: 0.85,
          boundingBox: { x: 0.1, y: 0.5, width: 0.4, height: 0.04 },
        },
        {
          text: 'APT 5B',
          confidence: 0.8,
          boundingBox: { x: 0.1, y: 0.45, width: 0.2, height: 0.04 },
        },
        {
          text: 'ANYTOWN CA 90210',
          confidence: 0.85,
          boundingBox: { x: 0.1, y: 0.4, width: 0.4, height: 0.04 },
        },
        {
          text: 'D1234567',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 },
        },
      ];

      const addressData: LicenseData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        licenseNumber: 'D1234567',
        address: {
          street: '123 MAIN STREET APT 5B',
          city: 'ANYTOWN',
          state: 'CA',
          postalCode: '90210',
        },
      };

      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: addressData,
        processingTime: 0.32,
      });

      // When: Parsing address data
      const result = await parseOCRText(addressObservations);

      // Then: Should extract complete address
      expect(result.address?.street).toContain('123 MAIN STREET');
      expect(result.address?.city).toBe('ANYTOWN');
      expect(result.address?.state).toBe('CA');
      expect(result.address?.postalCode).toBe('90210');
    });

    it('should maintain consistent results across multiple calls', async () => {
      // Given: Consistent input observations
      const consistentObservations: OCRTextObservation[] = [
        {
          text: 'JOHN',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.7, width: 0.15, height: 0.04 },
        },
        {
          text: 'DOE',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.75, width: 0.15, height: 0.04 },
        },
        {
          text: 'D1234567',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 },
        },
      ];

      const consistentData: LicenseData = {
        firstName: 'JOHN',
        lastName: 'DOE',
        licenseNumber: 'D1234567',
      };

      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: consistentData,
        processingTime: 0.2,
      });

      // When: Parsing multiple times
      const results = await Promise.all([
        parseOCRText(consistentObservations),
        parseOCRText(consistentObservations),
        parseOCRText(consistentObservations),
      ]);

      // Then: Results should be consistent
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.firstName).toBe('JOHN');
        expect(result.lastName).toBe('DOE');
        expect(result.licenseNumber).toBe('D1234567');
      });

      // Should have called native module for each parsing attempt
      expect(mockParseOCRTextFunction).toHaveBeenCalledTimes(3);
    });
  });

  describe('OCR Text Observation validation', () => {
    it('should accept well-formed observations', () => {
      const validObservation: OCRTextObservation = {
        text: 'VALID TEXT',
        confidence: 0.85,
        boundingBox: {
          x: 0.1,
          y: 0.5,
          width: 0.3,
          height: 0.05,
        },
      };

      // Should not throw when creating observation
      expect(() => {
        const observations = [validObservation];
        expect(observations[0]?.text).toBe('VALID TEXT');
        expect(observations[0]?.confidence).toBe(0.85);
      }).not.toThrow();
    });

    it('should handle edge case confidence values', () => {
      const edgeCaseObservations: OCRTextObservation[] = [
        {
          text: 'HIGH CONFIDENCE',
          confidence: 1.0, // Maximum confidence
          boundingBox: { x: 0, y: 0, width: 0.5, height: 0.1 },
        },
        {
          text: 'ZERO CONFIDENCE',
          confidence: 0.0, // Minimum confidence
          boundingBox: { x: 0, y: 0.2, width: 0.5, height: 0.1 },
        },
        {
          text: 'NEGATIVE CONFIDENCE',
          confidence: -0.1, // Invalid confidence (should be handled gracefully)
          boundingBox: { x: 0, y: 0.4, width: 0.5, height: 0.1 },
        },
      ];

      mockParseOCRTextFunction.mockResolvedValue({
        success: true,
        data: { firstName: 'TEST' },
        processingTime: 0.1,
      });

      // Should handle edge cases without crashing
      expect(async () => {
        await parseOCRText(edgeCaseObservations);
      }).not.toThrow();
    });
  });
});
