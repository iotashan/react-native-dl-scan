import type { OCRTextObservation } from '../types/license';

/**
 * Mock OCR data utilities for testing
 * Provides standardized mock data for license scanning tests
 */

/**
 * Generate standard mock OCR observations for a typical driver's license
 */
export function generateMockOCRData(): OCRTextObservation[] {
  return [
    {
      text: 'SAMPLE',
      confidence: 0.95,
      boundingBox: { x: 100, y: 50, width: 80, height: 20 },
    },
    {
      text: 'JOHN',
      confidence: 0.98,
      boundingBox: { x: 100, y: 80, width: 60, height: 20 },
    },
    {
      text: 'DOE',
      confidence: 0.97,
      boundingBox: { x: 170, y: 80, width: 50, height: 20 },
    },
    {
      text: 'D12345678',
      confidence: 0.93,
      boundingBox: { x: 100, y: 110, width: 100, height: 20 },
    },
    {
      text: '123 MAIN ST',
      confidence: 0.89,
      boundingBox: { x: 100, y: 140, width: 120, height: 20 },
    },
    {
      text: 'ANYTOWN CA 12345',
      confidence: 0.91,
      boundingBox: { x: 100, y: 170, width: 150, height: 20 },
    },
  ];
}

/**
 * Generate mock OCR data with custom confidence levels
 */
export function generateMockOCRDataWithConfidence(
  confidence: number
): OCRTextObservation[] {
  return generateMockOCRData().map((obs) => ({
    ...obs,
    confidence,
  }));
}

/**
 * Generate mock OCR data for specific test scenarios
 */
export function generateMockOCRDataForState(
  state: string
): OCRTextObservation[] {
  const baseData = generateMockOCRData();

  // Replace the state in the address field
  const stateSpecificData = baseData.map((obs) => {
    if (obs.text.includes('CA')) {
      return {
        ...obs,
        text: obs.text.replace('CA', state),
      };
    }
    return obs;
  });

  return stateSpecificData;
}

/**
 * Generate low-quality mock OCR data (for fallback testing)
 */
export function generateLowQualityMockOCRData(): OCRTextObservation[] {
  return [
    {
      text: 'J0HN', // OCR error: 0 instead of O
      confidence: 0.65,
      boundingBox: { x: 100, y: 80, width: 60, height: 20 },
    },
    {
      text: 'D0E', // OCR error: 0 instead of O
      confidence: 0.62,
      boundingBox: { x: 170, y: 80, width: 50, height: 20 },
    },
    {
      text: '012345678', // OCR error: 0 instead of D
      confidence: 0.58,
      boundingBox: { x: 100, y: 110, width: 100, height: 20 },
    },
  ];
}

/**
 * Generate empty/no-text mock OCR data (for error scenarios)
 */
export function generateEmptyMockOCRData(): OCRTextObservation[] {
  return [];
}

/**
 * Generate partial mock OCR data (missing some fields)
 */
export function generatePartialMockOCRData(): OCRTextObservation[] {
  return [
    {
      text: 'JOHN',
      confidence: 0.98,
      boundingBox: { x: 100, y: 80, width: 60, height: 20 },
    },
    {
      text: 'DOE',
      confidence: 0.97,
      boundingBox: { x: 170, y: 80, width: 50, height: 20 },
    },
    // Missing license number and address
  ];
}

/**
 * Mock license data that corresponds to the standard OCR observations
 */
export const mockLicenseData = {
  firstName: 'John',
  lastName: 'Doe',
  licenseNumber: 'D12345678',
  address: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    postalCode: '12345',
  },
};
