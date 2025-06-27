// Mock for src/NativeDlScan.ts - Dynamic implementation to support realistic testing
const mockDlScan = {
  scanLicense: jest.fn().mockImplementation((barcodeData) => {
    // Simulate processing based on input
    if (!barcodeData || typeof barcodeData !== 'string') {
      return Promise.resolve({
        success: false,
        error: {
          code: 'INVALID_BARCODE_DATA',
          message: 'Invalid barcode data provided',
          userMessage:
            'The barcode data is invalid. Please try scanning again.',
          recoverable: true,
        },
      });
    }

    // Simulate different responses based on barcode content for testing
    if (barcodeData.includes('invalid') || barcodeData.includes('INVALID')) {
      return Promise.resolve({
        success: false,
        error: {
          code: 'BARCODE_READ_ERROR',
          message: 'Could not read barcode data',
          userMessage:
            'Unable to read the barcode. Please ensure the license is clearly visible.',
          recoverable: true,
        },
      });
    }

    if (
      barcodeData.includes('corrupted') ||
      barcodeData.includes('CORRUPTED')
    ) {
      return Promise.resolve({
        success: false,
        error: {
          code: 'CORRUPTED_BARCODE',
          message: 'Corrupted barcode data detected',
          userMessage:
            'The barcode appears damaged. Please try with a different license.',
          recoverable: false,
        },
      });
    }

    // Default successful response with dynamic data based on input
    const testVariations = [
      {
        firstName: 'RAPID',
        lastName: 'TEST',
        licenseNumber: 'TEST123',
      },
      {
        firstName: 'JOHN',
        lastName: 'DOE',
        licenseNumber: 'DOE456',
      },
      {
        firstName: 'JANE',
        lastName: 'SMITH',
        licenseNumber: 'SMITH789',
      },
    ];

    // Use hash of barcode data to consistently return same result for same input
    const hash = barcodeData.split('').reduce((a, b) => {
      // eslint-disable-next-line no-bitwise
      a = (a << 5) - a + b.charCodeAt(0);
      // eslint-disable-next-line no-bitwise
      return a & a;
    }, 0);

    const variation = testVariations[Math.abs(hash) % testVariations.length];

    return Promise.resolve({
      success: true,
      data: {
        ...variation,
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2025-01-01'),
        sex: 'M',
        address: {
          street: '123 TEST ST',
          city: 'TEST CITY',
          state: 'CA',
          postalCode: '90210',
        },
      },
    });
  }),
  parseOCRText: jest.fn().mockImplementation((textObservations) => {
    if (!textObservations || !Array.isArray(textObservations)) {
      return Promise.resolve({
        success: false,
        error: {
          code: 'INVALID_OCR_INPUT',
          message: 'Invalid OCR text observations provided',
          userMessage: 'Unable to process the image text. Please try again.',
          recoverable: true,
        },
      });
    }

    // Simulate OCR parsing logic
    const allText = textObservations.map((obs) => obs.text).join(' ');
    const result = {
      firstName: 'RAPID',
      lastName: 'TEST',
      licenseNumber: 'TEST123',
    };

    // Basic OCR simulation - look for patterns in the text
    if (allText.includes('DOE')) {
      result.firstName = 'JOHN';
      result.lastName = 'DOE';
      result.licenseNumber = 'DOE456';
    } else if (allText.includes('SMITH')) {
      result.firstName = 'JANE';
      result.lastName = 'SMITH';
      result.licenseNumber = 'SMITH789';
    }

    // Simulate low confidence OCR failure
    const averageConfidence =
      textObservations.reduce((sum, obs) => sum + obs.confidence, 0) /
      textObservations.length;
    if (averageConfidence < 0.5) {
      return Promise.resolve({
        success: false,
        error: {
          code: 'LOW_OCR_CONFIDENCE',
          message: 'OCR confidence too low',
          userMessage:
            'The text is not clear enough. Please improve lighting and try again.',
          recoverable: true,
        },
      });
    }

    return Promise.resolve({
      success: true,
      data: {
        ...result,
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2025-01-01'),
        sex: 'M',
        address: {
          street: '123 TEST ST',
          city: 'TEST CITY',
          state: 'CA',
          postalCode: '90210',
        },
      },
    });
  }),
  startScanning: jest.fn().mockResolvedValue(undefined),
  stopScanning: jest.fn().mockResolvedValue(undefined),
};

// Store in global for test access
global.__DL_SCAN_MOCK__ = mockDlScan;

module.exports = mockDlScan;
