// Mock for src/NativeDlScan.ts
const mockDlScan = {
  scanLicense: jest.fn().mockResolvedValue({
    success: true,
    data: {
      firstName: 'RAPID',
      lastName: 'TEST',
      licenseNumber: 'TEST123',
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
  }),
  parseOCRText: jest.fn().mockResolvedValue({
    success: true,
    data: {
      firstName: 'RAPID',
      lastName: 'TEST',
      licenseNumber: 'TEST123',
    },
  }),
  startScanning: jest.fn().mockResolvedValue(undefined),
  stopScanning: jest.fn().mockResolvedValue(undefined),
};

// Export for global access
global.__DL_SCAN_MOCK__ = mockDlScan;

module.exports = mockDlScan;
