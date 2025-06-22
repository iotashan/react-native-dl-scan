/**
 * OCR Field Parsing Example
 * Demonstrates how to use the new OCR parsing functionality with Vision Framework
 */

import { parseOCRText, type OCRTextObservation, type LicenseData } from 'react-native-dl-scan';

/**
 * Example: Parse OCR text observations from Vision Framework
 * This would typically be called after getting text observations from camera frames
 */
export async function parseDriverLicenseFromOCR(
  textObservations: OCRTextObservation[]
): Promise<LicenseData> {
  try {
    // Parse the OCR text observations into structured license data
    const licenseData = await parseOCRText(textObservations);
    
    console.log('Successfully parsed license data:', {
      name: `${licenseData.firstName} ${licenseData.lastName}`,
      licenseNumber: licenseData.licenseNumber,
      dateOfBirth: licenseData.dateOfBirth,
      expirationDate: licenseData.expirationDate,
      state: licenseData.address?.state,
    });
    
    return licenseData;
  } catch (error) {
    console.error('Failed to parse OCR text:', error);
    throw error;
  }
}

/**
 * Example: Sample California license OCR observations
 * This represents what you might get from Vision Framework text detection
 */
export function getCaliforniaLicenseExample(): OCRTextObservation[] {
  return [
    {
      text: "CALIFORNIA",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.9, width: 0.3, height: 0.05 }
    },
    {
      text: "DRIVER LICENSE",
      confidence: 0.92,
      boundingBox: { x: 0.1, y: 0.85, width: 0.4, height: 0.05 }
    },
    {
      text: "LN SMITH",
      confidence: 0.9,
      boundingBox: { x: 0.1, y: 0.75, width: 0.2, height: 0.04 }
    },
    {
      text: "FN JOHN",
      confidence: 0.9,
      boundingBox: { x: 0.1, y: 0.7, width: 0.2, height: 0.04 }
    },
    {
      text: "DL D1234567",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 }
    },
    {
      text: "DOB 01/15/1990",
      confidence: 0.88,
      boundingBox: { x: 0.1, y: 0.5, width: 0.3, height: 0.04 }
    },
    {
      text: "EXP 01/15/2026",
      confidence: 0.88,
      boundingBox: { x: 0.1, y: 0.45, width: 0.3, height: 0.04 }
    },
    {
      text: "SEX M",
      confidence: 0.9,
      boundingBox: { x: 0.1, y: 0.4, width: 0.15, height: 0.04 }
    },
    {
      text: "HGT 5-10",
      confidence: 0.85,
      boundingBox: { x: 0.1, y: 0.35, width: 0.2, height: 0.04 }
    },
    {
      text: "WGT 180",
      confidence: 0.85,
      boundingBox: { x: 0.1, y: 0.3, width: 0.2, height: 0.04 }
    },
    {
      text: "EYES BRN",
      confidence: 0.8,
      boundingBox: { x: 0.1, y: 0.25, width: 0.2, height: 0.04 }
    },
    {
      text: "HAIR BLK",
      confidence: 0.8,
      boundingBox: { x: 0.1, y: 0.2, width: 0.2, height: 0.04 }
    },
    {
      text: "123 MAIN ST",
      confidence: 0.85,
      boundingBox: { x: 0.1, y: 0.15, width: 0.3, height: 0.04 }
    },
    {
      text: "ANYTOWN CA 90210",
      confidence: 0.85,
      boundingBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.04 }
    }
  ];
}

/**
 * Example: Sample Texas license OCR observations
 * Shows different state format handling
 */
export function getTexasLicenseExample(): OCRTextObservation[] {
  return [
    {
      text: "TEXAS",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.9, width: 0.2, height: 0.05 }
    },
    {
      text: "DRIVER LICENSE",
      confidence: 0.92,
      boundingBox: { x: 0.1, y: 0.85, width: 0.4, height: 0.05 }
    },
    {
      text: "JOHNSON, MARY",
      confidence: 0.9,
      boundingBox: { x: 0.1, y: 0.75, width: 0.3, height: 0.04 }
    },
    {
      text: "DL 12345678",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.04 }
    },
    {
      text: "DOB 03/20/1985",
      confidence: 0.88,
      boundingBox: { x: 0.1, y: 0.5, width: 0.3, height: 0.04 }
    },
    {
      text: "EXP 03/20/2025",
      confidence: 0.88,
      boundingBox: { x: 0.1, y: 0.45, width: 0.3, height: 0.04 }
    },
    {
      text: "SEX F",
      confidence: 0.9,
      boundingBox: { x: 0.1, y: 0.4, width: 0.15, height: 0.04 }
    },
    {
      text: "HGT 5-06",
      confidence: 0.85,
      boundingBox: { x: 0.1, y: 0.35, width: 0.2, height: 0.04 }
    },
    {
      text: "WGT 135",
      confidence: 0.85,
      boundingBox: { x: 0.1, y: 0.3, width: 0.2, height: 0.04 }
    }
  ];
}

/**
 * Example: Batch processing multiple license images
 */
export async function batchProcessLicenseImages(
  ocrResultsBatch: OCRTextObservation[][]
): Promise<LicenseData[]> {
  const results: LicenseData[] = [];
  const errors: Error[] = [];
  
  for (let i = 0; i < ocrResultsBatch.length; i++) {
    const batch = ocrResultsBatch[i];
    if (!batch) continue;
    
    try {
      const licenseData = await parseOCRText(batch);
      results.push(licenseData);
      console.log(`Successfully processed license ${i + 1}`);
    } catch (error) {
      console.error(`Failed to process license ${i + 1}:`, error);
      errors.push(error as Error);
    }
  }
  
  console.log(`Batch processing complete: ${results.length} successful, ${errors.length} failed`);
  
  return results;
}

/**
 * Example: Performance monitoring for OCR parsing
 */
export async function monitorOCRPerformance(
  textObservations: OCRTextObservation[]
): Promise<{ data: LicenseData; processingTime: number }> {
  const startTime = Date.now();
  
  try {
    const licenseData = await parseOCRText(textObservations);
    const processingTime = Date.now() - startTime;
    
    console.log(`OCR parsing completed in ${processingTime}ms`);
    
    // Log performance warning if over target
    if (processingTime > 500) {
      console.warn(`OCR parsing took ${processingTime}ms, exceeding 500ms target`);
    }
    
    return { data: licenseData, processingTime };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`OCR parsing failed after ${processingTime}ms:`, error);
    throw error;
  }
}

/**
 * Example: Error handling with recovery suggestions
 */
export async function parseWithErrorHandling(
  textObservations: OCRTextObservation[]
): Promise<{ success: boolean; data?: LicenseData; error?: string }> {
  try {
    const licenseData = await parseOCRText(textObservations);
    return { success: true, data: licenseData };
  } catch (error: any) {
    // Handle different types of errors with specific suggestions
    if (error.code === 'INSUFFICIENT_DATA') {
      return {
        success: false,
        error: 'Not enough license information detected. Please ensure the entire license is visible and well-lit.'
      };
    } else if (error.code === 'LOW_CONFIDENCE') {
      return {
        success: false,
        error: 'License text is unclear. Please improve lighting and hold the device steady.'
      };
    } else if (error.code === 'INVALID_FORMAT') {
      return {
        success: false,
        error: 'This does not appear to be a valid driver\'s license format.'
      };
    } else {
      return {
        success: false,
        error: 'Unable to read license. Please try again or use barcode scanning instead.'
      };
    }
  }
}

/**
 * Example: State-specific validation
 */
export function validateStateSpecificData(
  licenseData: LicenseData,
  expectedState?: string
): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Validate license number format based on state
  if (expectedState === 'CA' && licenseData.licenseNumber) {
    // California: Letter + 7 digits
    if (!/^[A-Z]\d{7}$/.test(licenseData.licenseNumber)) {
      issues.push('California license number should be 1 letter followed by 7 digits');
    }
  } else if (expectedState === 'TX' && licenseData.licenseNumber) {
    // Texas: 8 digits
    if (!/^\d{8}$/.test(licenseData.licenseNumber)) {
      issues.push('Texas license number should be 8 digits');
    }
  }
  
  // Validate required fields
  if (!licenseData.firstName) {
    issues.push('First name is required');
  }
  if (!licenseData.lastName) {
    issues.push('Last name is required');
  }
  if (!licenseData.licenseNumber) {
    issues.push('License number is required');
  }
  if (!licenseData.dateOfBirth) {
    issues.push('Date of birth is required');
  }
  
  // Validate date formats and ranges
  if (licenseData.dateOfBirth) {
    const dob = new Date(licenseData.dateOfBirth);
    const now = new Date();
    const age = now.getFullYear() - dob.getFullYear();
    
    if (age < 16 || age > 100) {
      issues.push('Date of birth indicates invalid age for driver license');
    }
  }
  
  if (licenseData.expirationDate) {
    const expDate = new Date(licenseData.expirationDate);
    const now = new Date();
    
    if (expDate < now) {
      issues.push('License appears to be expired');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

/**
 * Example usage:
 * 
 * // Parse California license
 * const caObservations = getCaliforniaLicenseExample();
 * const caLicense = await parseDriverLicenseFromOCR(caObservations);
 * 
 * // Parse Texas license
 * const txObservations = getTexasLicenseExample();
 * const txLicense = await parseDriverLicenseFromOCR(txObservations);
 * 
 * // Monitor performance
 * const { data, processingTime } = await monitorOCRPerformance(caObservations);
 * 
 * // Validate state-specific format
 * const validation = validateStateSpecificData(caLicense, 'CA');
 * if (!validation.isValid) {
 *   console.log('Validation issues:', validation.issues);
 * }
 */