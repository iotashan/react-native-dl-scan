import { normalizeLicenseData } from '../src';
import type { LicenseDataSpec } from '../src';

// Pins the JS-side plumbing of the per-line OCR observations (#82): the
// spec field passes through normalizeLicenseData verbatim (the wire
// OcrObservationSpec and the public OcrObservation are structurally
// identical), and absence normalizes to null per the public LicenseData
// convention. All values below are synthetic (GARCIA/SPRINGFIELD set).

describe('ocrObservations normalization', () => {
  it('passes observations through verbatim alongside cardImagePath', () => {
    const observations = [
      { text: 'GARCIA', x: 0.32, y: 0.18, width: 0.2, height: 0.05 },
      { text: '4827 LAKERIDGE DR', x: 0.3, y: 0.42, width: 0.34, height: 0.04 },
    ];
    const spec: LicenseDataSpec = {
      firstName: 'MARIA',
      cardImagePath: 'file:///cards/abc-card.jpg',
      ocrObservations: observations,
    };

    const d = normalizeLicenseData(spec);

    expect(d.cardImagePath).toBe('file:///cards/abc-card.jpg');
    expect(d.ocrObservations).toEqual(observations);
  });

  it('normalizes an absent field to null (not undefined)', () => {
    const d = normalizeLicenseData({ firstName: 'MARIA' });
    expect(d.ocrObservations).toBeNull();
    expect(d.ocrObservations).not.toBeUndefined();
  });
});
