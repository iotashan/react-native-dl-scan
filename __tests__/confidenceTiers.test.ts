import { normalizeLicenseData } from '../src';
import type { LicenseDataSpec } from '../src';

// Pins the JS-side decoding of the native dataConfidenceJson wire format into
// the public `dataConfidence` map (native.ts safeParseConfidence + tierForScore
// fallback). Focus: the marker_located (0.88) tier added for provenance-aware
// free-text confidence — it must round-trip from BOTH the v2 {score, tier}
// object form and the v1 bare-number form, and the score→tier fallback bands
// must not be stolen by the inserted 0.88 boundary.

const spec = (dataConfidenceJson: string): LicenseDataSpec => ({
  firstName: 'JANE',
  lastName: 'DOE',
  dataConfidenceJson,
});

describe('dataConfidence deserialization (marker_located tier)', () => {
  it('round-trips the v2 {score, tier} object form including marker_located', () => {
    const json = JSON.stringify({
      lastName: { score: 0.88, tier: 'marker_located' },
      firstName: { score: 1.0, tier: 'cross_validated' },
      dateOfBirth: { score: 0.85, tier: 'shape_matched' },
    });
    const d = normalizeLicenseData(spec(json));
    expect(d.dataConfidence?.lastName).toEqual({
      score: 0.88,
      tier: 'marker_located',
    });
    expect(d.dataConfidence?.firstName?.tier).toBe('cross_validated');
    expect(d.dataConfidence?.dateOfBirth?.tier).toBe('shape_matched');
  });

  it('derives marker_located from a v1 bare-number 0.88 score', () => {
    // v1 wire (backwards-compat): bare number → tier derived by tierForScore.
    const json = JSON.stringify({
      lastName: 0.88,
      street: 0.88,
    });
    const d = normalizeLicenseData(spec(json));
    expect(d.dataConfidence?.lastName).toEqual({
      score: 0.88,
      tier: 'marker_located',
    });
    expect(d.dataConfidence?.street?.tier).toBe('marker_located');
  });

  it('keeps the adjacent bands intact across the inserted 0.88 boundary', () => {
    // 0.95 → all_gates_passed, 0.88 → marker_located, 0.85 → shape_matched,
    // 0.50 → extracted_raw. The new band must not steal 0.85 or 0.95.
    const json = JSON.stringify({
      a: 0.95,
      b: 0.88,
      c: 0.85,
      d: 0.5,
      e: 1.0,
    });
    const d = normalizeLicenseData(spec(json));
    expect(d.dataConfidence?.a?.tier).toBe('all_gates_passed');
    expect(d.dataConfidence?.b?.tier).toBe('marker_located');
    expect(d.dataConfidence?.c?.tier).toBe('shape_matched');
    expect(d.dataConfidence?.d?.tier).toBe('extracted_raw');
    expect(d.dataConfidence?.e?.tier).toBe('cross_validated');
  });

  it('accepts marker_located as a valid v2 tier name (not rejected)', () => {
    const json = JSON.stringify({
      middleName: { score: 0.88, tier: 'marker_located' },
    });
    const d = normalizeLicenseData(spec(json));
    // A valid tier must survive VALID_TIERS filtering.
    expect(d.dataConfidence?.middleName?.tier).toBe('marker_located');
  });
});
