import type { LicenseData } from '../types/license';

/**
 * Utility functions for formatting and validating license data
 */

// Date formatting utilities
export const formatDate = (dateInput?: string | Date): string => {
  if (!dateInput) return '';

  try {
    const date =
      typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) {
      return typeof dateInput === 'string' ? dateInput : ''; // Return original if invalid
    }

    // Use UTC to ensure consistent behavior across timezones
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return typeof dateInput === 'string' ? dateInput : '';
  }
};

export const formatShortDate = (dateInput?: string | Date): string => {
  if (!dateInput) return '';

  try {
    const date =
      typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) {
      return typeof dateInput === 'string' ? dateInput : '';
    }

    // Use UTC to ensure consistent behavior across timezones
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    });
  } catch {
    return typeof dateInput === 'string' ? dateInput : '';
  }
};

// Age calculation
export const calculateAge = (dateOfBirth?: string | Date): number | null => {
  if (!dateOfBirth) return null;

  try {
    const birth =
      typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
    if (isNaN(birth.getTime())) return null;

    // Use consistent date handling - new Date() will use the mocked date in tests
    const today = new Date();

    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }

    return age;
  } catch {
    return null;
  }
};

// Name formatting
export const formatFullName = (data: LicenseData): string => {
  const parts = [
    data.firstName?.trim(),
    data.middleName?.trim(),
    data.lastName?.trim(),
  ].filter(Boolean);

  return parts.join(' ');
};

export const formatLastNameFirst = (data: LicenseData): string => {
  const firstName = data.firstName?.trim();
  const middleName = data.middleName?.trim();
  const lastName = data.lastName?.trim();

  if (!lastName) return formatFullName(data);

  const firstParts = [firstName, middleName].filter(Boolean);

  if (firstParts.length === 0) return lastName;

  return `${lastName}, ${firstParts.join(' ')}`;
};

// Address formatting
export const formatAddress = (data: LicenseData): string => {
  const parts = [
    data.address?.street?.trim(),
    data.address?.city?.trim(),
    data.address?.state?.trim(),
    data.address?.postalCode?.trim(),
  ].filter(Boolean);

  return parts.join(', ');
};

export const formatAddressMultiline = (data: LicenseData): string => {
  const street = data.address?.street?.trim();
  const cityStateZip = [
    data.address?.city?.trim(),
    data.address?.state?.trim(),
    data.address?.postalCode?.trim(),
  ]
    .filter(Boolean)
    .join(', ');

  return [street, cityStateZip].filter(Boolean).join('\n');
};

// Height and weight formatting
export const formatHeight = (height?: string): string => {
  if (!height) return '';

  // Handle various height formats
  const heightStr = height.trim();

  // Already formatted (e.g., "5'10"" or "5 ft 10 in")
  if (heightStr.includes("'") || heightStr.toLowerCase().includes('ft')) {
    return heightStr;
  }

  // Numeric value - assume inches
  const inches = parseInt(heightStr, 10);
  if (!isNaN(inches) && inches > 0) {
    const feet = Math.floor(inches / 12);
    const remainingInches = inches % 12;

    if (remainingInches === 0) {
      return `${feet}'0"`;
    }

    return `${feet}'${remainingInches}"`;
  }

  return heightStr;
};

export const formatWeight = (weight?: string): string => {
  if (!weight) return '';

  const weightStr = weight.trim();

  // Already has unit
  if (
    weightStr.toLowerCase().includes('lb') ||
    weightStr.toLowerCase().includes('kg')
  ) {
    return weightStr;
  }

  // Numeric value - assume pounds
  const pounds = parseInt(weightStr, 10);
  if (!isNaN(pounds) && pounds > 0) {
    return `${pounds} lbs`;
  }

  return weightStr;
};

// License number formatting
export const formatLicenseNumber = (licenseNumber?: string): string => {
  if (!licenseNumber) return '';

  // Remove extra spaces and format consistently
  return licenseNumber.trim().replace(/\s+/g, ' ');
};

// Validation utilities
export const isDateExpired = (dateString?: string): boolean => {
  if (!dateString) return false;

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return false;

    return date < new Date();
  } catch {
    return false;
  }
};

export const isDateValid = (dateString?: string): boolean => {
  if (!dateString) return false;

  try {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  } catch {
    return false;
  }
};

// Data completeness scoring
export const calculateDataCompleteness = (data: LicenseData): number => {
  let filledRequired = 0;
  let filledOptional = 0;

  // Check required fields
  const requiredChecks = [
    data.firstName && data.firstName.trim(),
    data.lastName && data.lastName.trim(),
    data.dateOfBirth,
    data.licenseNumber && data.licenseNumber.trim(),
    // Handle address object fields
    data.address?.street && data.address.street.trim(),
    data.address?.city && data.address.city.trim(),
    data.address?.state && data.address.state.trim(),
    data.issueDate,
    data.expirationDate,
  ];

  filledRequired = requiredChecks.filter(Boolean).length;

  // Check optional fields
  const optionalChecks = [
    data.middleName && data.middleName.trim(),
    data.address?.postalCode && data.address.postalCode.trim(),
    data.licenseClass && data.licenseClass.trim(),
    data.sex && data.sex.trim(),
    data.height && data.height.trim(),
    data.weight && data.weight.trim(),
    data.eyeColor && data.eyeColor.trim(),
    data.hairColor && data.hairColor.trim(),
    data.restrictions && data.restrictions.trim(),
    data.endorsements && data.endorsements.trim(),
  ];

  filledOptional = optionalChecks.filter(Boolean).length;

  // Weight required fields more heavily
  const requiredWeight = 0.7;
  const optionalWeight = 0.3;
  const totalRequired = 9; // 9 required fields
  const totalOptional = 10; // 10 optional fields

  const requiredScore = (filledRequired / totalRequired) * requiredWeight;
  const optionalScore = (filledOptional / totalOptional) * optionalWeight;

  return Math.round((requiredScore + optionalScore) * 100) / 100;
};

// Text cleaning utilities
export const cleanText = (text?: string): string => {
  if (!text) return '';

  return text
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\w\s-'.]/g, '') // Remove special characters except common ones
    .trim();
};

export const capitalizeWords = (text?: string): string => {
  if (!text) return '';

  return text
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// State code utilities
export const formatStateCode = (state?: string): string => {
  if (!state) return '';

  const stateStr = state.trim().toUpperCase();

  // US state codes mapping for validation
  const stateCodes = [
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
    'DC', // District of Columbia
  ];

  if (stateCodes.includes(stateStr)) {
    return stateStr;
  }

  return state.trim();
};

// Confidence level formatting
export const formatConfidenceLevel = (confidence: number): string => {
  if (confidence >= 0.9) return 'Very High';
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Medium';
  if (confidence >= 0.4) return 'Low';
  return 'Very Low';
};

export const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return '#4CAF50'; // Green
  if (confidence >= 0.6) return '#FF9800'; // Orange
  return '#F44336'; // Red
};

// Export default object with all utilities
export const formatters = {
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
};

export default formatters;
