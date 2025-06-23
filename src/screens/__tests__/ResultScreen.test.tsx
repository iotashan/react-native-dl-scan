import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ResultScreen, type ScanResult } from '../ResultScreen';
import type { LicenseData } from '../../types/license';

// Mock Alert
jest.spyOn(Alert, 'alert');

describe('ResultScreen', () => {
  const mockOnRescan = jest.fn();
  const mockOnDone = jest.fn();
  const mockOnReportIssue = jest.fn();

  const completeLicenseData: LicenseData = {
    firstName: 'John',
    middleName: 'Michael',
    lastName: 'Doe',
    dateOfBirth: '1985-06-15',
    sex: 'M',
    height: '72',
    weight: '180',
    eyeColor: 'Brown',
    hairColor: 'Black',
    addressStreet: '123 Main Street',
    addressCity: 'Anytown',
    addressState: 'CA',
    addressZip: '90210',
    licenseNumber: 'D1234567',
    documentId: 'DL123456789',
    licenseClass: 'C',
    restrictions: 'None',
    endorsements: 'None',
    issueDate: '2020-06-15',
    expiryDate: '2025-06-15',
    issuingState: 'CA',
    issuingCountry: 'USA',
    documentType: 'Driver License',
  };

  const partialLicenseData: LicenseData = {
    firstName: 'Jane',
    lastName: 'Smith',
    licenseNumber: 'D9876543',
    issueDate: '2022-03-10',
  };

  const expiredLicenseData: LicenseData = {
    ...completeLicenseData,
    expiryDate: '2020-01-01', // Expired
  };

  const completeScanResult: ScanResult = {
    mode: 'pdf417',
    data: completeLicenseData,
    confidence: {
      overall: 0.95,
      fields: {
        firstName: 0.98,
        lastName: 0.97,
        licenseNumber: 0.99,
      },
    },
    timestamp: Date.now(),
  };

  const partialScanResult: ScanResult = {
    mode: 'ocr',
    data: partialLicenseData,
    confidence: {
      overall: 0.75,
      fields: {
        firstName: 0.85,
        lastName: 0.80,
        licenseNumber: 0.60,
      },
    },
    timestamp: Date.now(),
  };

  const expiredScanResult: ScanResult = {
    mode: 'auto',
    data: expiredLicenseData,
    timestamp: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders correctly with complete data', () => {
      const { toJSON } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );
      
      expect(toJSON()).toMatchSnapshot();
    });

    it('renders correctly with partial data', () => {
      const { toJSON } = render(
        <ResultScreen
          scanResult={partialScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );
      
      expect(toJSON()).toMatchSnapshot();
    });

    it('displays success header with scan mode', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('Scan Complete')).toBeTruthy();
      expect(getByText('Scanned using pdf417 mode')).toBeTruthy();
    });
  });

  describe('Personal Information Section', () => {
    it('displays full name correctly', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('John Michael Doe')).toBeTruthy();
    });

    it('calculates and displays age', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      // Should display date of birth with calculated age
      expect(getByText(/1985-06-15.*Age \d+/)).toBeTruthy();
    });

    it('handles missing personal information gracefully', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={partialScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('Jane Smith')).toBeTruthy();
      expect(getByText('Not provided')).toBeTruthy(); // Should show for missing fields
    });
  });

  describe('Address Section', () => {
    it('formats complete address correctly', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('123 Main Street, Anytown, CA, 90210')).toBeTruthy();
    });

    it('handles missing address gracefully', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={partialScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      // Should show "Not provided" for missing address
      const notProvidedElements = getByText('Not provided');
      expect(notProvidedElements).toBeTruthy();
    });
  });

  describe('License Details Section', () => {
    it('displays license information correctly', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('D1234567')).toBeTruthy();
      expect(getByText('C')).toBeTruthy(); // License class
    });

    it('shows expiry status for valid license', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText(/2025-06-15.*Valid/)).toBeTruthy();
    });

    it('shows expired status for expired license', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={expiredScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText(/2020-01-01.*EXPIRED/)).toBeTruthy();
    });
  });

  describe('Physical Description Section', () => {
    it('renders collapsible physical description section', () => {
      const { getByText, queryByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('Physical Description')).toBeTruthy();
      
      // Should be collapsed initially - height/weight not visible
      expect(queryByText('72')).toBeNull();
    });

    it('expands physical description when tapped', async () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      const expandButton = getByText('Physical Description');
      fireEvent.press(expandButton);

      await waitFor(() => {
        expect(getByText('72')).toBeTruthy(); // Height
        expect(getByText('180')).toBeTruthy(); // Weight
      });
    });

    it('hides section when no physical data available', () => {
      const { queryByText } = render(
        <ResultScreen
          scanResult={partialScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(queryByText('Physical Description')).toBeNull();
    });
  });

  describe('Document Metadata Section', () => {
    it('displays scan mode correctly', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('PDF417 Barcode')).toBeTruthy();
    });

    it('displays confidence score when available', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByText('95%')).toBeTruthy(); // Overall confidence
    });

    it('handles missing confidence gracefully', () => {
      const { queryByText } = render(
        <ResultScreen
          scanResult={expiredScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      // Should not crash when confidence is undefined
      expect(queryByText(/\d+%/)).toBeNull();
    });
  });

  describe('Action Bar', () => {
    it('renders all action buttons', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
          onReportIssue={mockOnReportIssue}
        />
      );

      expect(getByText('Rescan')).toBeTruthy();
      expect(getByText('Done')).toBeTruthy();
      expect(getByText('Report Issue')).toBeTruthy();
    });

    it('calls onRescan when Rescan button is pressed', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      fireEvent.press(getByText('Rescan'));
      expect(mockOnRescan).toHaveBeenCalledTimes(1);
    });

    it('calls onDone when Done button is pressed', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      fireEvent.press(getByText('Done'));
      expect(mockOnDone).toHaveBeenCalledTimes(1);
    });

    it('calls onReportIssue when Report Issue button is pressed', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
          onReportIssue={mockOnReportIssue}
        />
      );

      fireEvent.press(getByText('Report Issue'));
      expect(mockOnReportIssue).toHaveBeenCalledTimes(1);
    });

    it('shows alert when Report Issue is pressed without handler', () => {
      const { getByText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      fireEvent.press(getByText('Report Issue'));
      expect(Alert.alert).toHaveBeenCalledWith(
        'Report Issue',
        'This feature is not yet implemented.',
        [{ text: 'OK' }]
      );
    });
  });

  describe('Accessibility', () => {
    it('has proper accessibility labels for buttons', () => {
      const { getByLabelText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByLabelText('Scan another license')).toBeTruthy();
      expect(getByLabelText('Finish and return')).toBeTruthy();
      expect(getByLabelText('Report an issue with this scan')).toBeTruthy();
    });

    it('has accessibility label for collapsible section', () => {
      const { getByLabelText } = render(
        <ResultScreen
          scanResult={completeScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      expect(getByLabelText('Physical Description, collapsed')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('handles null/undefined data fields gracefully', () => {
      const emptyData: LicenseData = {};
      const emptyScanResult: ScanResult = {
        mode: 'ocr',
        data: emptyData,
        timestamp: Date.now(),
      };

      const { getByText } = render(
        <ResultScreen
          scanResult={emptyScanResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      // Should not crash and should show "Not provided" for empty fields
      expect(getByText('Not provided')).toBeTruthy();
    });

    it('handles invalid date formats gracefully', () => {
      const invalidDateData: LicenseData = {
        ...completeLicenseData,
        dateOfBirth: 'invalid-date',
        expiryDate: 'not-a-date',
      };

      const invalidDateResult: ScanResult = {
        mode: 'ocr',
        data: invalidDateData,
        timestamp: Date.now(),
      };

      const { getByText } = render(
        <ResultScreen
          scanResult={invalidDateResult}
          onRescan={mockOnRescan}
          onDone={mockOnDone}
        />
      );

      // Should display the original invalid date string instead of crashing
      expect(getByText('invalid-date')).toBeTruthy();
    });
  });
});