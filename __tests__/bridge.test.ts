// Mock react-native TurboModuleRegistry
jest.mock('react-native', () => {
  // Create the mock inside the factory function
  const mockScanLicense = jest.fn();
  // Store reference on a global for access in tests
  (global as any).__mockScanLicense = mockScanLicense;
  return {
    TurboModuleRegistry: {
      getEnforcing: jest.fn(() => ({
        scanLicense: mockScanLicense,
        startScanning: jest.fn(),
        stopScanning: jest.fn(),
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

// Import after mocks are set up
import { scanLicense, ScanError } from '../src/index';

// Get the mock function from global
const mockScanLicenseFunction = (global as any).__mockScanLicense;

describe('React Native Bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should handle successful scan', async () => {
    const mockData = {
      success: true,
      data: {
        firstName: 'John',
        lastName: 'Doe',
        licenseNumber: 'D12345678',
        dateOfBirth: new Date('1990-01-01'),
        sex: 'M' as const,
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '12345',
        },
      },
    };

    mockScanLicenseFunction.mockResolvedValue(mockData);

    const result = await scanLicense('mock-barcode-data');
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
    expect(result.licenseNumber).toBe('D12345678');
    expect(result.sex).toBe('M');
  });

  test('should handle parsing errors', async () => {
    const mockError = {
      success: false,
      error: {
        code: 'PARSING_FAILED',
        message: 'Invalid format',
        userMessage: "This doesn't appear to be a valid license.",
        recoverable: true,
      },
    };

    mockScanLicenseFunction.mockResolvedValue(mockError);

    await expect(scanLicense('invalid-data')).rejects.toThrow(ScanError);

    try {
      await scanLicense('invalid-data');
    } catch (error) {
      expect(error).toBeInstanceOf(ScanError);
      if (error instanceof ScanError) {
        expect(error.code).toBe('PARSING_FAILED');
        expect(error.userMessage).toBe(
          "This doesn't appear to be a valid license."
        );
        expect(error.recoverable).toBe(true);
      }
    }
  });

  test('should handle native module rejection', async () => {
    const nativeError = new Error('Native module error');
    mockScanLicenseFunction.mockRejectedValue(nativeError);

    await expect(scanLicense('test-data')).rejects.toThrow(ScanError);

    try {
      await scanLicense('test-data');
    } catch (error) {
      expect(error).toBeInstanceOf(ScanError);
      if (error instanceof ScanError) {
        expect(error.code).toBe('UNKNOWN_ERROR');
        expect(error.recoverable).toBe(true);
      }
    }
  });

  test('should handle unknown scanning error', async () => {
    const mockData = {
      success: false,
      // Missing error field
    };

    mockScanLicenseFunction.mockResolvedValue(mockData);

    await expect(scanLicense('test-data')).rejects.toThrow(
      'Unknown scanning error'
    );
  });

  test('should pass through all license data fields', async () => {
    const mockData = {
      success: true,
      data: {
        firstName: 'Jane',
        lastName: 'Smith',
        middleName: 'Marie',
        suffix: 'Jr',
        licenseNumber: 'S98765432',
        dateOfBirth: new Date('1985-05-15'),
        issueDate: new Date('2020-01-01'),
        expirationDate: new Date('2028-01-01'),
        sex: 'F' as const,
        eyeColor: 'BRN',
        hairColor: 'BLN',
        height: '5-06',
        weight: '140',
        address: {
          street: '456 Oak Ave',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
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
        allFields: {
          DCS: 'Smith',
          DAC: 'Jane',
          DAD: 'Marie',
        },
      },
    };

    mockScanLicenseFunction.mockResolvedValue(mockData);

    const result = await scanLicense('complete-barcode-data');

    // Verify all fields are passed through
    expect(result.firstName).toBe('Jane');
    expect(result.lastName).toBe('Smith');
    expect(result.middleName).toBe('Marie');
    expect(result.suffix).toBe('Jr');
    expect(result.licenseNumber).toBe('S98765432');
    expect(result.sex).toBe('F');
    expect(result.eyeColor).toBe('BRN');
    expect(result.hairColor).toBe('BLN');
    expect(result.height).toBe('5-06');
    expect(result.weight).toBe('140');
    expect(result.address?.street).toBe('456 Oak Ave');
    expect(result.address?.city).toBe('Springfield');
    expect(result.address?.state).toBe('IL');
    expect(result.address?.postalCode).toBe('62701');
    expect(result.address?.country).toBe('USA');
    expect(result.licenseClass).toBe('C');
    expect(result.restrictions).toBe('NONE');
    expect(result.endorsements).toBe('NONE');
    expect(result.issuerIdentificationNumber).toBe('636014');
    expect(result.documentDiscriminator).toBe('1234567890');
    expect(result.isOrganDonor).toBe(true);
    expect(result.isVeteran).toBe(false);
    expect(result.isRealID).toBe(true);
    expect(result.allFields).toEqual({
      DCS: 'Smith',
      DAC: 'Jane',
      DAD: 'Marie',
    });
  });
});
