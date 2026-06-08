import { _mergeAccumulated } from '../src/useLicenseScanner';
import type { LicenseData } from '../src';

// These tests pin the fold the opt-in TTA verification pass uses to merge its
// voted result into the accumulated scan data (useLicenseScanner's
// applyTtaVerification → _mergeAccumulated(data, ttaData)). The same rules
// govern the per-frame accumulation, so they double as a contract for both.

const base = (over: Partial<LicenseData> = {}): LicenseData =>
  ({
    firstName: null,
    lastName: null,
    middleName: null,
    dateOfBirth: null,
    expirationDate: null,
    issueDate: null,
    licenseNumber: null,
    street: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    sex: null,
    eyeColor: null,
    hairColor: null,
    height: null,
    weight: null,
    vehicleClass: null,
    restrictions: null,
    endorsements: null,
    aamvaVersion: null,
    documentType: null,
    mrz: null,
    dataConfidence: null,
    cardImagePath: null,
    headshotImagePath: null,
    ...over,
  }) as LicenseData;

describe('TTA merge wiring (_mergeAccumulated)', () => {
  it('recovers a field the base scan never read (the headline TTA win)', () => {
    // The "D" vehicleClass that single-pass OCR drops on blue WI stock.
    const accumulated = base({ firstName: 'JOHN', vehicleClass: null });
    const tta = base({
      vehicleClass: 'D',
      dataConfidence: { vehicleClass: { score: 0.85, tier: 'shape_matched' } },
    });

    const merged = _mergeAccumulated(accumulated, tta);

    expect(merged.vehicleClass).toBe('D');
    // Pre-existing fields are untouched by the merge.
    expect(merged.firstName).toBe('JOHN');
  });

  it('keeps a confirmed field when TTA reads it with EQUAL or LOWER confidence', () => {
    const accumulated = base({
      lastName: 'DOE',
      dataConfidence: { lastName: { score: 1.0, tier: 'cross_validated' } },
    });
    // TTA re-reads lastName but at lower confidence (and a noisier value).
    const tta = base({
      lastName: 'D0E',
      dataConfidence: { lastName: { score: 0.5, tier: 'extracted_raw' } },
    });

    const merged = _mergeAccumulated(accumulated, tta);

    // Incumbent wins — no flapping to the lower-confidence TTA read.
    expect(merged.lastName).toBe('DOE');
    expect(merged.dataConfidence?.lastName?.score).toBe(1.0);
  });

  it('overwrites only on STRICTLY higher confidence', () => {
    const accumulated = base({
      licenseNumber: 'H200799802',
      dataConfidence: {
        licenseNumber: { score: 0.5, tier: 'extracted_raw' },
      },
    });
    const tta = base({
      licenseNumber: 'J415-2208-5573-28',
      dataConfidence: {
        licenseNumber: { score: 0.85, tier: 'shape_matched' },
      },
    });

    const merged = _mergeAccumulated(accumulated, tta);

    expect(merged.licenseNumber).toBe('J415-2208-5573-28');
    expect(merged.dataConfidence?.licenseNumber?.score).toBe(0.85);
  });

  it('never drops an accumulated field that TTA did not read', () => {
    const accumulated = base({
      firstName: 'JOHN',
      lastName: 'DOE',
      street: '4827 LAKERIDGE DR',
    });
    // TTA only recovered the class; all other fields are absent this pass.
    const tta = base({ vehicleClass: 'D' });

    const merged = _mergeAccumulated(accumulated, tta);

    expect(merged.firstName).toBe('JOHN');
    expect(merged.lastName).toBe('DOE');
    expect(merged.street).toBe('4827 LAKERIDGE DR');
    expect(merged.vehicleClass).toBe('D');
  });

  it('returns the TTA result verbatim when there is no prior accumulator', () => {
    const tta = base({ firstName: 'JANE' });
    expect(_mergeAccumulated(null, tta)).toBe(tta);
  });
});
