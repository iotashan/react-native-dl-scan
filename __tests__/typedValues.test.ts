import { toTypedValue } from '../src';
import {
  SEX_CODES,
  EYE_COLOR_CODES,
  HAIR_COLOR_CODES,
  formatTypedValue,
} from '../src';
import type { SexCode, EyeColorCode, HairColorCode } from '../src';

// toTypedValue (task #52) maps a raw AAMVA-coded string from the native layer
// into the public discriminated union:
//   - known code (case-insensitive, trimmed) → { code }
//   - null / empty / whitespace-only        → null (never fabricate 'other')
//   - anything else                          → { code: 'other', raw } with the
//                                              original (trimmed, case-kept) raw
// The conversion is pure (no native rebuild), so it is fully unit-tested here.

describe('toTypedValue — known codes', () => {
  it('maps an exact uppercase sex code', () => {
    expect(toTypedValue('M', SEX_CODES)).toEqual({ code: 'M' });
    expect(toTypedValue('F', SEX_CODES)).toEqual({ code: 'F' });
    expect(toTypedValue('X', SEX_CODES)).toEqual({ code: 'X' });
  });

  it('uppercases a lowercase code before matching', () => {
    expect(toTypedValue('m', SEX_CODES)).toEqual({ code: 'M' });
    expect(toTypedValue('bro', EYE_COLOR_CODES)).toEqual({ code: 'BRO' });
    expect(toTypedValue('blk', HAIR_COLOR_CODES)).toEqual({ code: 'BLK' });
  });

  it('trims surrounding whitespace before matching', () => {
    expect(toTypedValue('  F  ', SEX_CODES)).toEqual({ code: 'F' });
    expect(toTypedValue('\tHAZ\n', EYE_COLOR_CODES)).toEqual({ code: 'HAZ' });
    expect(toTypedValue(' bln ', HAIR_COLOR_CODES)).toEqual({ code: 'BLN' });
  });

  it('matches mixed case + whitespace together', () => {
    expect(toTypedValue('  Blu ', EYE_COLOR_CODES)).toEqual({ code: 'BLU' });
  });
});

describe('toTypedValue — every code in each set round-trips', () => {
  it('sex set', () => {
    for (const c of SEX_CODES) {
      expect(toTypedValue(c, SEX_CODES)).toEqual({ code: c });
      expect(toTypedValue(c.toLowerCase(), SEX_CODES)).toEqual({ code: c });
    }
  });

  it('eye-color set', () => {
    for (const c of EYE_COLOR_CODES) {
      expect(toTypedValue(c, EYE_COLOR_CODES)).toEqual({ code: c });
      expect(toTypedValue(` ${c.toLowerCase()} `, EYE_COLOR_CODES)).toEqual({
        code: c,
      });
    }
  });

  it('hair-color set', () => {
    for (const c of HAIR_COLOR_CODES) {
      expect(toTypedValue(c, HAIR_COLOR_CODES)).toEqual({ code: c });
      expect(toTypedValue(` ${c.toLowerCase()} `, HAIR_COLOR_CODES)).toEqual({
        code: c,
      });
    }
  });
});

describe('toTypedValue — unknown values become "other" with preserved raw', () => {
  it('maps an off-spec sex value, preserving original case', () => {
    expect(toTypedValue('Nonbinary', SEX_CODES)).toEqual({
      code: 'other',
      raw: 'Nonbinary',
    });
  });

  it('preserves the trimmed (but not uppercased) raw', () => {
    expect(toTypedValue('  Teal  ', EYE_COLOR_CODES)).toEqual({
      code: 'other',
      raw: 'Teal',
    });
  });

  it('a code from a DIFFERENT set is "other" for this set', () => {
    // 'BAL' (bald) is a hair code, not an eye code.
    expect(toTypedValue('BAL', EYE_COLOR_CODES)).toEqual({
      code: 'other',
      raw: 'BAL',
    });
  });

  it('a numeric AAMVA sex form (not normalized here) is "other"', () => {
    // The numeric 1/2/9 forms are normalized upstream; if one reaches JS it is
    // off the known M/F/X set and surfaces as 'other'.
    expect(toTypedValue('1', SEX_CODES)).toEqual({ code: 'other', raw: '1' });
  });
});

describe('toTypedValue — null / empty stay null (never fabricated "other")', () => {
  it('null → null', () => {
    expect(toTypedValue(null, SEX_CODES)).toBeNull();
    expect(toTypedValue(null, EYE_COLOR_CODES)).toBeNull();
    expect(toTypedValue(null, HAIR_COLOR_CODES)).toBeNull();
  });

  it('undefined → null', () => {
    expect(toTypedValue(undefined, SEX_CODES)).toBeNull();
  });

  it('empty string → null', () => {
    expect(toTypedValue('', SEX_CODES)).toBeNull();
  });

  it('whitespace-only → null', () => {
    expect(toTypedValue('   ', SEX_CODES)).toBeNull();
    expect(toTypedValue('\t\n', HAIR_COLOR_CODES)).toBeNull();
  });
});

describe('formatTypedValue — display helper', () => {
  it('returns the bare code for a known value', () => {
    expect(formatTypedValue({ code: 'M' as SexCode })).toBe('M');
    expect(formatTypedValue({ code: 'BRO' as EyeColorCode })).toBe('BRO');
    expect(formatTypedValue({ code: 'BLK' as HairColorCode })).toBe('BLK');
  });

  it('returns the preserved raw for an "other" value', () => {
    expect(formatTypedValue({ code: 'other', raw: 'Teal' })).toBe('Teal');
  });

  it('returns null for null/undefined', () => {
    expect(formatTypedValue(null)).toBeNull();
    expect(formatTypedValue(undefined)).toBeNull();
  });

  it('round-trips toTypedValue output back to a display string', () => {
    const tv = toTypedValue('haz', EYE_COLOR_CODES);
    expect(formatTypedValue(tv)).toBe('HAZ');
    const other = toTypedValue('Violet', EYE_COLOR_CODES);
    expect(formatTypedValue(other)).toBe('Violet');
  });
});
