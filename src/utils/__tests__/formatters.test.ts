import {
  formatDate,
  formatShortDate,
  calculateAge,
  formatFullName,
  formatLastNameFirst,
  formatAddress,
  formatAddressMultiline,
  formatHeight,
  formatWeight,
  formatLicenseNumber,
  isDateExpired,
  isDateValid,
  calculateDataCompleteness,
  cleanText,
  capitalizeWords,
  formatStateCode,
  formatConfidenceLevel,
  getConfidenceColor,
} from '../formatters';
import type { LicenseData } from '../../types/license';

describe('Date Formatting', () => {
  describe('formatDate', () => {
    it('formats valid date strings correctly', () => {
      // Use ISO dates with explicit timezone to avoid timezone issues
      const date1 = formatDate('2023-06-15T00:00:00Z');
      const date2 = formatDate('1985-12-25T00:00:00Z');

      expect(date1).toMatch(/June \d{1,2}, 2023/);
      expect(date2).toMatch(/December \d{1,2}, 1985/);
    });

    it('handles invalid dates gracefully', () => {
      expect(formatDate('invalid-date')).toBe('invalid-date');
      expect(formatDate('')).toBe('');
      expect(formatDate(undefined)).toBe('');
    });

    it('handles edge cases', () => {
      // Test with specific timezone-aware dates
      const invalidLeap = formatDate('2023-02-29T00:00:00Z');
      const validLeap = formatDate('2020-02-29T00:00:00Z');

      expect(invalidLeap).toMatch(/March \d{1,2}, 2023/);
      expect(validLeap).toMatch(/February \d{1,2}, 2020/);
    });
  });

  describe('formatShortDate', () => {
    it('formats dates in short format', () => {
      expect(formatShortDate('2023-06-15')).toBe('06/15/2023');
      expect(formatShortDate('1985-12-25')).toBe('12/25/1985');
    });

    it('handles invalid dates gracefully', () => {
      expect(formatShortDate('invalid-date')).toBe('invalid-date');
      expect(formatShortDate('')).toBe('');
      expect(formatShortDate(undefined)).toBe('');
    });
  });

  describe('calculateAge', () => {
    const mockDate = new Date('2023-06-15');
    const originalDate = Date;

    beforeAll(() => {
      // Mock Date constructor to return mockDate when called without arguments
      global.Date = jest.fn((dateString?: string | number) => {
        if (dateString === undefined) {
          return mockDate;
        }
        return new originalDate(dateString);
      }) as any;
      
      // Copy over static methods
      Object.assign(global.Date, originalDate);
      global.Date.now = jest.fn(() => mockDate.getTime());
    });

    afterAll(() => {
      // Restore original Date and clean up all references
      global.Date = originalDate;
      jest.restoreAllMocks();
      jest.clearAllTimers();
    });

    it('calculates age correctly', () => {
      expect(calculateAge(new Date('1985-06-15'))).toBe(38); // Same month/day
      expect(calculateAge('1985-06-14')).toBe(38); // Day before
      expect(calculateAge('1985-06-16')).toBe(37); // Day after
    });

    it('handles edge cases', () => {
      expect(calculateAge('2025-01-01')).toBe(-2); // Future date
      expect(calculateAge('invalid-date')).toBeNull();
      expect(calculateAge('')).toBeNull();
      expect(calculateAge(undefined)).toBeNull();
    });
  });
});

describe('Name Formatting', () => {
  describe('formatFullName', () => {
    it('formats complete names correctly', () => {
      const data: LicenseData = {
        firstName: 'John',
        middleName: 'Michael',
        lastName: 'Doe',
      };
      expect(formatFullName(data)).toBe('John Michael Doe');
    });

    it('handles missing middle name', () => {
      const data: LicenseData = {
        firstName: 'John',
        lastName: 'Doe',
      };
      expect(formatFullName(data)).toBe('John Doe');
    });

    it('handles missing parts gracefully', () => {
      expect(formatFullName({})).toBe('');
      expect(formatFullName({ firstName: 'John' })).toBe('John');
      expect(formatFullName({ lastName: 'Doe' })).toBe('Doe');
    });

    it('trims whitespace', () => {
      const data: LicenseData = {
        firstName: '  John  ',
        middleName: '  Michael  ',
        lastName: '  Doe  ',
      };
      expect(formatFullName(data)).toBe('John Michael Doe');
    });
  });

  describe('formatLastNameFirst', () => {
    it('formats names in last name first format', () => {
      const data: LicenseData = {
        firstName: 'John',
        middleName: 'Michael',
        lastName: 'Doe',
      };
      expect(formatLastNameFirst(data)).toBe('Doe, John Michael');
    });

    it('handles missing middle name', () => {
      const data: LicenseData = {
        firstName: 'John',
        lastName: 'Doe',
      };
      expect(formatLastNameFirst(data)).toBe('Doe, John');
    });

    it('falls back to normal format when no last name', () => {
      const data: LicenseData = {
        firstName: 'John',
        middleName: 'Michael',
      };
      expect(formatLastNameFirst(data)).toBe('John Michael');
    });
  });
});

describe('Address Formatting', () => {
  describe('formatAddress', () => {
    it('formats complete address correctly', () => {
      const data: LicenseData = {
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '90210',
        },
      };
      expect(formatAddress(data)).toBe('123 Main St, Anytown, CA, 90210');
    });

    it('handles missing components', () => {
      const data: LicenseData = {
        address: {
          street: '123 Main St',
          city: 'Anytown',
        },
      };
      expect(formatAddress(data)).toBe('123 Main St, Anytown');
    });

    it('handles empty address', () => {
      expect(formatAddress({})).toBe('');
    });
  });

  describe('formatAddressMultiline', () => {
    it('formats address in multiple lines', () => {
      const data: LicenseData = {
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '90210',
        },
      };
      expect(formatAddressMultiline(data)).toBe(
        '123 Main St\nAnytown, CA, 90210'
      );
    });

    it('handles missing street', () => {
      const data: LicenseData = {
        address: {
          city: 'Anytown',
          state: 'CA',
        },
      };
      expect(formatAddressMultiline(data)).toBe('Anytown, CA');
    });
  });
});

describe('Physical Measurements', () => {
  describe('formatHeight', () => {
    it('converts inches to feet and inches', () => {
      expect(formatHeight('72')).toBe('6\'0"');
      expect(formatHeight('73')).toBe('6\'1"');
      expect(formatHeight('60')).toBe('5\'0"');
    });

    it('preserves already formatted heights', () => {
      expect(formatHeight('5\'10"')).toBe('5\'10"');
      expect(formatHeight('6 ft 2 in')).toBe('6 ft 2 in');
    });

    it('handles invalid input', () => {
      expect(formatHeight('invalid')).toBe('invalid');
      expect(formatHeight('')).toBe('');
      expect(formatHeight(undefined)).toBe('');
    });
  });

  describe('formatWeight', () => {
    it('adds pounds unit to numeric weight', () => {
      expect(formatWeight('180')).toBe('180 lbs');
      expect(formatWeight('150')).toBe('150 lbs');
    });

    it('preserves already formatted weights', () => {
      expect(formatWeight('180 lbs')).toBe('180 lbs');
      expect(formatWeight('80 kg')).toBe('80 kg');
    });

    it('handles invalid input', () => {
      expect(formatWeight('invalid')).toBe('invalid');
      expect(formatWeight('')).toBe('');
      expect(formatWeight(undefined)).toBe('');
    });
  });
});

describe('License Number Formatting', () => {
  describe('formatLicenseNumber', () => {
    it('normalizes whitespace', () => {
      expect(formatLicenseNumber('D  1234567')).toBe('D 1234567');
      expect(formatLicenseNumber('  D1234567  ')).toBe('D1234567');
    });

    it('handles empty input', () => {
      expect(formatLicenseNumber('')).toBe('');
      expect(formatLicenseNumber(undefined)).toBe('');
    });
  });
});

describe('Date Validation', () => {
  describe('isDateExpired', () => {
    it('identifies expired dates correctly', () => {
      expect(isDateExpired('2020-01-01')).toBe(true);
      expect(isDateExpired('2030-12-31')).toBe(false);
    });

    it('handles invalid dates', () => {
      expect(isDateExpired('invalid-date')).toBe(false);
      expect(isDateExpired('')).toBe(false);
      expect(isDateExpired(undefined)).toBe(false);
    });
  });

  describe('isDateValid', () => {
    it('validates date strings correctly', () => {
      expect(isDateValid('2023-06-15')).toBe(true);
      expect(isDateValid('invalid-date')).toBe(false);
      expect(isDateValid('')).toBe(false);
      expect(isDateValid(undefined)).toBe(false);
    });
  });
});

describe('Data Quality Assessment', () => {
  describe('calculateDataCompleteness', () => {
    it('calculates completeness for full data', () => {
      const completeData: LicenseData = {
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: new Date('1985-06-15'),
        licenseNumber: 'D1234567',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          postalCode: '90210',
        },
        issueDate: new Date('2020-06-15'),
        expirationDate: new Date('2025-06-15'),
        middleName: 'Michael',
        licenseClass: 'C',
        sex: 'M',
        height: '72',
        weight: '180',
        eyeColor: 'Brown',
        hairColor: 'Black',
        restrictions: 'None',
        endorsements: 'None',
      };

      expect(calculateDataCompleteness(completeData)).toBe(1.0);
    });

    it('calculates completeness for partial data', () => {
      const partialData: LicenseData = {
        firstName: 'John',
        lastName: 'Doe',
        licenseNumber: 'D1234567',
      };

      const completeness = calculateDataCompleteness(partialData);
      expect(completeness).toBeGreaterThan(0);
      expect(completeness).toBeLessThan(1);
    });

    it('handles empty data', () => {
      expect(calculateDataCompleteness({})).toBe(0);
    });
  });
});

describe('Text Utilities', () => {
  describe('cleanText', () => {
    it('normalizes whitespace and removes special characters', () => {
      expect(cleanText('  Hello   World!  ')).toBe('Hello World');
      expect(cleanText('Test@#$%Text')).toBe('TestText');
    });

    it('preserves allowed characters', () => {
      expect(cleanText("O'Connor-Smith Jr.")).toBe("O'Connor-Smith Jr.");
    });

    it('handles empty input', () => {
      expect(cleanText('')).toBe('');
      expect(cleanText(undefined)).toBe('');
    });
  });

  describe('capitalizeWords', () => {
    it('capitalizes each word', () => {
      expect(capitalizeWords('john doe')).toBe('John Doe');
      expect(capitalizeWords('MARY JANE')).toBe('Mary Jane');
    });

    it('handles empty input', () => {
      expect(capitalizeWords('')).toBe('');
      expect(capitalizeWords(undefined)).toBe('');
    });
  });
});

describe('State Code Formatting', () => {
  describe('formatStateCode', () => {
    it('validates and formats US state codes', () => {
      expect(formatStateCode('ca')).toBe('CA');
      expect(formatStateCode('texas')).toBe('texas'); // Not a valid code
      expect(formatStateCode('NY')).toBe('NY');
    });

    it('handles empty input', () => {
      expect(formatStateCode('')).toBe('');
      expect(formatStateCode(undefined)).toBe('');
    });
  });
});

describe('Confidence Utilities', () => {
  describe('formatConfidenceLevel', () => {
    it('returns correct confidence levels', () => {
      expect(formatConfidenceLevel(0.95)).toBe('Very High');
      expect(formatConfidenceLevel(0.85)).toBe('High');
      expect(formatConfidenceLevel(0.7)).toBe('Medium');
      expect(formatConfidenceLevel(0.5)).toBe('Low');
      expect(formatConfidenceLevel(0.3)).toBe('Very Low');
    });
  });

  describe('getConfidenceColor', () => {
    it('returns correct colors for confidence levels', () => {
      expect(getConfidenceColor(0.9)).toBe('#4CAF50'); // Green
      expect(getConfidenceColor(0.7)).toBe('#FF9800'); // Orange
      expect(getConfidenceColor(0.4)).toBe('#F44336'); // Red
    });
  });
});
