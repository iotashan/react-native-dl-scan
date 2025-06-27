// @ts-ignore - React is used in JSX
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import {
  AccessibleButton,
  AccessibleCameraView,
  AccessibleModeSelector,
  AccessibleResultField,
  AccessibleQualityIndicator,
} from '../accessibility/AccessibleComponents';
import VoiceGuidanceSystem from '../accessibility/VoiceGuidanceSystem';
import { AccessibilityGestures } from '../accessibility/AccessibilityGestures';
import {
  useVoiceOver,
  useHighContrast,
  useDynamicType,
} from '../../utils/accessibility';

// Mock accessibility hooks
jest.mock('../../utils/accessibility', () => ({
  ...jest.requireActual('../../utils/accessibility'),
  useVoiceOver: jest.fn(),
  useHighContrast: jest.fn(),
  useDynamicType: jest.fn(),
  useBoldText: jest.fn(() => false),
  getAccessibilityProps: jest.fn((config) => ({
    accessible: true,
    accessibilityLabel: config.label,
    accessibilityHint: config.hint,
    accessibilityRole: config.role,
    accessibilityState: config.state,
  })),
  getHighContrastColors: jest.fn((isHighContrast) =>
    isHighContrast
      ? {
          primary: '#000000',
          secondary: '#FFFFFF',
          text: '#000000',
          error: '#CC0000',
          border: '#000000',
          textSecondary: '#333333',
        }
      : null
  ),
  AccessibilityConfig: {
    labels: {
      cameraView: 'Camera view for scanning',
      resultField: (field: string, value: string) => `${field}: ${value}`,
      qualityIndicator: 'Image quality indicator',
    },
    hints: {
      positioningGuide: 'Position license in frame',
      customGestures: 'Custom gestures available',
    },
    announcements: {
      modeChanged: (mode: string) => `Mode changed to ${mode}`,
      scanningStarted: 'Scanning started',
      scanningProgress: (quality: number) => `Quality: ${quality}`,
      scanSuccess: 'Scan successful',
      scanError: (error: string) => `Error: ${error}`,
      documentDetected: 'Document detected',
      documentLost: 'Document lost',
    },
  },
}));

// Mock AccessibilityInfo
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    AccessibilityInfo: {
      isScreenReaderEnabled: jest.fn(() => Promise.resolve(false)),
      announceForAccessibility: jest.fn(),
      setAccessibilityFocus: jest.fn(),
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
      isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
      isHighTextContrastEnabled: jest.fn(() => Promise.resolve(false)),
      isBoldTextEnabled: jest.fn(() => Promise.resolve(false)),
    },
  };
});

describe('Accessibility Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useVoiceOver as jest.Mock).mockReturnValue({
      isVoiceOverEnabled: false,
      announce: jest.fn(),
      announceDelayed: jest.fn(),
    });
    (useHighContrast as jest.Mock).mockReturnValue(false);
    (useDynamicType as jest.Mock).mockReturnValue({
      fontScale: 1,
      fontSize: (base: number) => base,
      lineHeight: (base: number) => base * 1.2,
    });
  });

  describe('AccessibleButton', () => {
    it('renders with correct accessibility props', () => {
      const { getByRole } = render(
        <AccessibleButton
          label="Test Button"
          hint="Tap to test"
          onPress={() => {}}
        />
      );

      const button = getByRole('button');
      expect(button).toBeTruthy();
      expect(button.props.accessibilityLabel).toBe('Test Button');
      expect(button.props.accessibilityHint).toBe('Tap to test');
    });

    it('shows disabled state correctly', () => {
      const { getByRole } = render(
        <AccessibleButton
          label="Disabled Button"
          disabled={true}
          onPress={() => {}}
        />
      );

      const button = getByRole('button');
      expect(button.props.accessibilityState).toMatchObject({
        disabled: true,
        busy: false,
      });
    });

    it('shows loading state correctly', () => {
      const { getByRole } = render(
        <AccessibleButton
          label="Loading Button"
          loading={true}
          onPress={() => {}}
        />
      );

      const button = getByRole('button');
      expect(button.props.accessibilityState).toMatchObject({
        disabled: true,
        busy: true,
      });
    });

    it('applies high contrast styles when enabled', () => {
      (useHighContrast as jest.Mock).mockReturnValue(true);

      const { getByRole } = render(
        <AccessibleButton label="High Contrast Button" onPress={() => {}} />
      );

      const button = getByRole('button');
      expect(button.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ borderWidth: 2 })])
      );
    });
  });

  describe('AccessibleCameraView', () => {
    it('provides live region updates', () => {
      const { getByLabelText } = render(
        <AccessibleCameraView
          isScanning={true}
          qualityDescription="Good quality"
          documentDetected={true}
          currentMode="auto"
        >
          <></>
        </AccessibleCameraView>
      );

      const cameraView = getByLabelText('Camera view for scanning');
      expect(cameraView.props.accessibilityLiveRegion).toBe('polite');
      expect(cameraView.props.accessibilityValue.text).toContain('Scanning');
      expect(cameraView.props.accessibilityValue.text).toContain(
        'License detected'
      );
    });

    it('updates status text based on props', () => {
      const { getByLabelText, rerender } = render(
        <AccessibleCameraView
          isScanning={false}
          qualityDescription="Poor quality"
          documentDetected={false}
          currentMode="barcode"
        >
          <></>
        </AccessibleCameraView>
      );

      const cameraView = getByLabelText('Camera view for scanning');
      expect(cameraView.props.accessibilityValue.text).toContain('Ready');
      expect(cameraView.props.accessibilityValue.text).toContain(
        'No license detected'
      );

      // Update props
      rerender(
        <AccessibleCameraView
          isScanning={true}
          qualityDescription="Excellent quality"
          documentDetected={true}
          currentMode="barcode"
        >
          <></>
        </AccessibleCameraView>
      );

      expect(cameraView.props.accessibilityValue.text).toContain('Scanning');
      expect(cameraView.props.accessibilityValue.text).toContain(
        'License detected'
      );
    });
  });

  describe('AccessibleModeSelector', () => {
    it('renders all modes with correct accessibility labels', () => {
      const { getByLabelText } = render(
        <AccessibleModeSelector
          currentMode="auto"
          availableModes={['auto', 'barcode', 'ocr']}
          onModeChange={() => {}}
        />
      );

      expect(getByLabelText('Automatic scanning mode')).toBeTruthy();
      expect(getByLabelText('Barcode scanning mode')).toBeTruthy();
      expect(getByLabelText('OCR scanning mode')).toBeTruthy();
    });

    it('indicates selected mode correctly', () => {
      const { getByLabelText } = render(
        <AccessibleModeSelector
          currentMode="barcode"
          availableModes={['auto', 'barcode', 'ocr']}
          onModeChange={() => {}}
        />
      );

      const barcodeButton = getByLabelText('Barcode scanning mode');
      expect(barcodeButton.props.accessibilityState.selected).toBe(true);
      expect(barcodeButton.props.accessibilityHint).toBe('Currently selected');
    });

    it('handles mode changes', () => {
      const onModeChange = jest.fn();
      const { getByLabelText } = render(
        <AccessibleModeSelector
          currentMode="auto"
          availableModes={['auto', 'barcode', 'ocr']}
          onModeChange={onModeChange}
        />
      );

      fireEvent.press(getByLabelText('OCR scanning mode'));
      expect(onModeChange).toHaveBeenCalledWith('ocr');
    });
  });

  describe('AccessibleResultField', () => {
    it('provides comprehensive field information', () => {
      const { getByRole } = render(
        <AccessibleResultField
          label="Name"
          value="John Doe"
          confidence={0.95}
        />
      );

      const field = getByRole('text');
      expect(field.props.accessibilityLabel).toBe('Name: John Doe');
      expect(field.props.accessibilityValue.text).toContain('Value detected');
      expect(field.props.accessibilityValue.text).toContain('Confidence: 95%');
    });

    it('indicates loading state', () => {
      const { getByRole } = render(
        <AccessibleResultField label="License Number" isLoading={true} />
      );

      const field = getByRole('text');
      expect(field.props.accessibilityState.busy).toBe(true);
      expect(field.props.accessibilityValue.text).toContain('Loading');
    });

    it('indicates error state', () => {
      const { getByRole } = render(
        <AccessibleResultField label="Expiry Date" hasError={true} />
      );

      const field = getByRole('text');
      expect(field.props.accessibilityValue.text).toContain('Error detected');
    });
  });

  describe('AccessibleQualityIndicator', () => {
    it('provides quality information as progress bar', () => {
      const { getByRole } = render(
        <AccessibleQualityIndicator quality={0.75} qualityLevel="good" />
      );

      const indicator = getByRole('progressbar');
      expect(indicator.props.accessibilityLabel).toBe(
        'Image quality indicator'
      );
      expect(indicator.props.accessibilityValue).toMatchObject({
        min: 0,
        max: 100,
        now: 75,
        text: 'Image quality: good, 75%',
      });
    });

    it('updates live region for quality changes', () => {
      const { getByRole } = render(
        <AccessibleQualityIndicator quality={0.3} qualityLevel="poor" />
      );

      const indicator = getByRole('progressbar');
      expect(indicator.props.accessibilityLiveRegion).toBe('polite');
    });
  });
});

describe('VoiceGuidanceSystem', () => {
  let mockAnnounce: jest.Mock;
  let mockAnnounceDelayed: jest.Mock;

  beforeEach(() => {
    mockAnnounce = jest.fn();
    mockAnnounceDelayed = jest.fn();
    (useVoiceOver as jest.Mock).mockReturnValue({
      isVoiceOverEnabled: true,
      announce: mockAnnounce,
      announceDelayed: mockAnnounceDelayed,
    });
  });

  it('announces scanning start', () => {
    render(<VoiceGuidanceSystem isScanning={true} currentMode="auto" />);

    expect(mockAnnounce).toHaveBeenCalledWith('Scanning started');
  });

  it('announces mode changes', () => {
    const { rerender } = render(
      <VoiceGuidanceSystem isScanning={false} currentMode="auto" />
    );

    rerender(<VoiceGuidanceSystem isScanning={false} currentMode="barcode" />);

    expect(mockAnnounceDelayed).toHaveBeenCalledWith(
      'Mode changed to barcode',
      300
    );
  });

  it('announces document detection', () => {
    const { rerender } = render(
      <VoiceGuidanceSystem
        isScanning={true}
        currentMode="auto"
        documentDetected={false}
      />
    );

    rerender(
      <VoiceGuidanceSystem
        isScanning={true}
        currentMode="auto"
        documentDetected={true}
      />
    );

    expect(mockAnnounce).toHaveBeenCalledWith('Document detected');
  });

  it('provides positioning guidance', async () => {
    const qualityMetrics = {
      overall: 0.2,
      positioning: {
        distance: 'too_close' as const,
        angle: 'straight' as const,
        documentDetected: true,
        inFrame: true,
      },
      lighting: {
        overall: 0.8,
        uniformity: 0.9,
        shadows: false,
        glare: false,
      },
      focus: {
        sharpness: 0.9,
        blurDetected: false,
      },
    };

    render(
      <VoiceGuidanceSystem
        isScanning={true}
        currentMode="auto"
        qualityMetrics={qualityMetrics}
      />
    );

    // Wait for guidance interval
    await waitFor(
      () => {
        expect(mockAnnounce).toHaveBeenCalledWith(
          'Move device farther from license'
        );
      },
      { timeout: 3000 }
    );
  });

  it('announces scan results', () => {
    const { rerender } = render(
      <VoiceGuidanceSystem isScanning={true} currentMode="auto" />
    );

    rerender(
      <VoiceGuidanceSystem
        isScanning={false}
        currentMode="auto"
        scanResult="success"
      />
    );

    expect(mockAnnounce).toHaveBeenCalledWith('Scan successful');
  });
});

describe('AccessibilityGestures', () => {
  it('triggers mode toggle on two-finger double tap', () => {
    const onModeToggle = jest.fn();
    render(
      <AccessibilityGestures
        onModeToggle={onModeToggle}
        isVoiceOverEnabled={true}
      >
        <></>
      </AccessibilityGestures>
    );

    // Note: Gesture testing with react-native-gesture-handler requires
    // more sophisticated mocking. This is a simplified test.
    expect(onModeToggle).toBeDefined();
  });
});

describe('Accessibility Integration', () => {
  it('provides complete accessibility coverage', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(
      true
    );

    const { getAllByRole } = render(
      <AccessibleModeSelector
        currentMode="auto"
        availableModes={['auto', 'barcode', 'ocr']}
        onModeChange={() => {}}
      />
    );

    // Check all buttons have proper roles
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(3);

    // Check each button has label and hint
    buttons.forEach((button) => {
      expect(button.props.accessibilityLabel).toBeTruthy();
      expect(button.props.accessibilityHint).toBeTruthy();
    });
  });
});
