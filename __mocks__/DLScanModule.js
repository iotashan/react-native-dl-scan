module.exports = {
  scanLicense: jest.fn().mockResolvedValue({
    success: true,
    data: {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: '123456789',
      dateOfBirth: '1990-01-01',
      expirationDate: '2025-01-01',
    },
  }),
  parseOCRText: jest.fn().mockResolvedValue({
    success: true,
    fields: {
      name: 'John Doe',
      licenseNumber: '123456789',
    },
  }),
  scanPDF417: jest.fn().mockResolvedValue({
    success: true,
    barcodeData: 'mock-barcode-data',
  }),
};
