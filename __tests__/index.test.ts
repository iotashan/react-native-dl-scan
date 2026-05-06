import { NativeDlScan } from '../src';
import type { LicenseData } from '../src';

describe('NativeDlScan adapter (undefined → null normalization)', () => {
  it('returns null when input has no AAMVA/ANSI marker', async () => {
    const result = await NativeDlScan.parseBarcodeData('garbage');
    expect(result).toBeNull();
  });

  it('normalizes undefined fields to null in returned LicenseData', async () => {
    const result = await NativeDlScan.parseBarcodeData(
      'ANSI 636000090002DLDAQ999888777DCSDOEDACJOHNDBB19900815'
    );
    expect(result).not.toBeNull();
    const data = result as LicenseData;
    // Fields the mock populates explicitly
    expect(data.firstName).toBe('JOHN');
    expect(data.lastName).toBe('DOE');
    expect(data.licenseNumber).toBe('999888777');
    expect(data.dateOfBirth).toBe('1990-08-15');
    expect(data.sex).toBe('M');
    expect(data.aamvaVersion).toBe(9);
    // Critical assertion: undefined → null, not undefined
    expect(data.middleName).toBeNull();
    expect(data.middleName).not.toBeUndefined();
    expect(data.expirationDate).toBeNull();
    expect(data.country).toBeNull();
    expect(data.eyeColor).toBeNull();
  });
});
