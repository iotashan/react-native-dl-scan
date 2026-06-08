import {
  _detectRequiredContradiction,
  _decideScanOutcome,
} from '../src/useLicenseScanner';
import type { LicenseData } from '../src';

// Regression guard for the validation-pass contradiction check. The check must
// compare a fresh frame's re-read against the value accumulated BEFORE this
// frame was merged — NOT against the post-merge value. Otherwise a
// higher-confidence strict re-read (e.g. a free-text name that rose from 0.50
// to 0.88 under provenance-aware tiers) overwrites the baseline during the
// merge and the check ends up comparing the fresh value against itself,
// silently masking a real contradiction and finalizing prematurely.

const ld = (o: Partial<LicenseData>): LicenseData =>
  o as unknown as LicenseData;

describe('_detectRequiredContradiction', () => {
  it('flags a fresh re-read that differs from the pre-merge accumulated value (Q3 regression)', () => {
    // The fresh strict read would outrank the accumulated value in the merge,
    // yet the contradiction must still be caught because the comparison is made
    // against the pre-merge snapshot.
    const prev = ld({ firstName: 'MARCUS' });
    const frame = ld({ firstName: 'MARCO' });
    expect(_detectRequiredContradiction(prev, frame, ['firstName'])).toBe(true);
  });

  it('no contradiction when the fresh re-read matches (case/space-insensitive)', () => {
    expect(
      _detectRequiredContradiction(
        ld({ lastName: 'DELGADO' }),
        ld({ lastName: ' delgado ' }),
        ['lastName']
      )
    ).toBe(false);
  });

  it('a newly-appearing field is not a contradiction (no prior value)', () => {
    expect(
      _detectRequiredContradiction(
        ld({ firstName: null }),
        ld({ firstName: 'MARCUS' }),
        ['firstName']
      )
    ).toBe(false);
  });

  it('a field absent this frame is not a contradiction', () => {
    expect(
      _detectRequiredContradiction(
        ld({ firstName: 'MARCUS' }),
        ld({ firstName: null }),
        ['firstName']
      )
    ).toBe(false);
  });

  it('null accumulator is never a contradiction', () => {
    expect(
      _detectRequiredContradiction(null, ld({ firstName: 'X' }), ['firstName'])
    ).toBe(false);
  });

  it('typed value-set fields compare by display form, not [object Object]', () => {
    expect(
      _detectRequiredContradiction(
        ld({ sex: { code: 'M' } }),
        ld({ sex: { code: 'F' } }),
        ['sex']
      )
    ).toBe(true);
    expect(
      _detectRequiredContradiction(
        ld({ sex: { code: 'M' } }),
        ld({ sex: { code: 'M' } }),
        ['sex']
      )
    ).toBe(false);
  });

  it('only the required fields are considered', () => {
    // street differs but is not required → not a contradiction
    expect(
      _detectRequiredContradiction(
        ld({ street: 'A ST' }),
        ld({ street: 'B AVE' }),
        ['firstName']
      )
    ).toBe(false);
  });
});

describe('_decideScanOutcome (validation-pass wiring)', () => {
  const baseInput = (
    over: Partial<Parameters<typeof _decideScanOutcome>[0]> = {}
  ): Parameters<typeof _decideScanOutcome>[0] => ({
    prevAccumulated: null,
    frameData: ld({}),
    requiredFields: ['firstName'],
    requiredComplete: true,
    maxFrames: 30,
    validationPass: true,
    validationFp: 'awaiting',
    passCount: 5,
    ...over,
  });

  it('keeps validation ACTIVE when a fresh re-read contradicts the pre-merge value (Q3 wiring)', () => {
    // prev=MARCUS, fresh=MARCO. A real merge would overwrite the accumulator
    // with the higher-confidence MARCO, but the decision compares the fresh
    // frame against the PRE-merge prev and must detect the contradiction.
    const out = _decideScanOutcome(
      baseInput({
        prevAccumulated: ld({ firstName: 'MARCUS' }),
        frameData: ld({ firstName: 'MARCO' }),
      })
    );
    expect(out.validationActive).toBe(true);
    expect(out.finalize).toBe(false);
    expect(out.phase).toBe('validating');
  });

  it('finalizes (confirmed) when the validation re-read agrees', () => {
    const out = _decideScanOutcome(
      baseInput({
        prevAccumulated: ld({ firstName: 'MARCUS' }),
        frameData: ld({ firstName: 'MARCUS' }),
      })
    );
    expect(out.finalize).toBe(true);
    expect(out.validationConfirmed).toBe(true);
    expect(out.phase).toBe('complete');
  });

  it('waits one validation frame on the first complete frame', () => {
    const out = _decideScanOutcome(baseInput({ validationFp: '' }));
    expect(out.nextValidationFp).toBe('awaiting');
    expect(out.validationActive).toBe(true);
    expect(out.finalize).toBe(false);
  });

  it('finalizes immediately when validationPass is disabled', () => {
    const out = _decideScanOutcome(
      baseInput({ validationPass: false, validationFp: '' })
    );
    expect(out.finalize).toBe(true);
    expect(out.phase).toBe('complete');
  });

  it('resets validation while a required field is missing', () => {
    const out = _decideScanOutcome(
      baseInput({ requiredComplete: false, validationFp: 'awaiting' })
    );
    expect(out.nextValidationFp).toBe('');
    expect(out.finalize).toBe(false);
    expect(out.phase).toBe('scanning');
  });

  it('hard-caps at maxFrames, finalizing incomplete when required never completed', () => {
    const out = _decideScanOutcome(
      baseInput({ requiredComplete: false, passCount: 30, validationFp: '' })
    );
    expect(out.finalize).toBe(true);
    expect(out.phase).toBe('incomplete');
  });
});
