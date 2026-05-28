// T is unused in the mock implementation — intentional, it mirrors the real module's shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type HybridObject<T> = unknown;

export const NitroModules = {
  createHybridObject: <T>(_name: string): T => {
    // Mock the DlScan hybrid: parseBarcodeData returns a known LicenseDataSpec
    // that mirrors what the C++ core would produce for a canonical fixture.
    return {
      parseBarcodeData: async (barcodeData: string) => {
        if (!barcodeData.includes('ANSI') && !barcodeData.includes('AAMVA')) {
          return null;
        }
        return {
          firstName: 'JOHN',
          lastName: 'DOE',
          middleName: undefined,
          dateOfBirth: '1990-08-15',
          expirationDate: undefined,
          issueDate: undefined,
          licenseNumber: '999888777',
          street: undefined,
          city: undefined,
          state: undefined,
          postalCode: undefined,
          country: undefined,
          sex: 'M' as const,
          eyeColor: undefined,
          height: undefined,
          vehicleClass: undefined,
          restrictions: undefined,
          endorsements: undefined,
          aamvaVersion: 9,
        };
      },
      recognizeLicenseFields: () => null,
    } as T;
  },
};
