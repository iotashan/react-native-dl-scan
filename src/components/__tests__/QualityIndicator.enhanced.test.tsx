import { render, act } from '@testing-library/react-native';
import { QualityIndicator } from '../QualityIndicator';
import type { RealTimeQualityMetrics } from '../../types/license';

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

// Mock AccessibilityInfo
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    AccessibilityInfo: {
      announceForAccessibility: jest.fn(),
    },
  };
});

describe('QualityIndicator Enhanced Features', () => {
  const mockRealTimeMetrics: RealTimeQualityMetrics = {
    blur: {
      value: 0.2,
      status: 'good',
    },
    lighting: {
      brightness: 0.8,
      uniformity: 0.9,
      status: 'good',
    },
    positioning: {
      documentDetected: true,
      alignment: 0.85,
      distance: 'optimal',
      status: 'good',
    },
    overall: {
      score: 0.85,
      readyToScan: true,
    },
  };

  const legacyMetrics = {
    blur: 0.2,
    lighting: 0.8,
    positioning: 0.85,
    overall: 'good' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Real-time metrics interface', () => {
    it('should render with real-time metrics', () => {
      const { getByText } = render(
        <QualityIndicator metrics={mockRealTimeMetrics} />
      );

      expect(getByText('Ready to scan')).toBeTruthy();
    });

    it('should show proper guidance for poor positioning', () => {
      const poorPositioningMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.3,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.3,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <QualityIndicator metrics={poorPositioningMetrics} mode="pdf417" />
      );

      expect(getByText('Move device closer')).toBeTruthy();
    });

    it('should show different guidance for OCR mode', () => {
      const poorLightingMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        lighting: {
          brightness: 0.2,
          uniformity: 0.3,
          status: 'poor',
        },
        overall: {
          score: 0.4,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <QualityIndicator metrics={poorLightingMetrics} mode="ocr" />
      );

      expect(getByText('Find better lighting')).toBeTruthy();
    });
  });

  describe('Legacy metrics interface', () => {
    it('should render with legacy metrics', () => {
      const { getByText } = render(
        <QualityIndicator metrics={legacyMetrics} />
      );

      expect(getByText('Good quality')).toBeTruthy();
    });

    it('should show proper guidance for poor legacy metrics', () => {
      const poorLegacyMetrics = {
        ...legacyMetrics,
        blur: 0.8,
        overall: 'poor' as const,
      };

      const { getByText } = render(
        <QualityIndicator metrics={poorLegacyMetrics} />
      );

      expect(getByText('Hold camera steady')).toBeTruthy();
    });
  });

  describe('Haptic feedback', () => {
    it('should trigger haptic feedback on status change', async () => {
      const { rerender } = render(
        <QualityIndicator
          metrics={mockRealTimeMetrics}
          enableHapticFeedback={true}
        />
      );

      const poorMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        blur: {
          value: 0.8,
          status: 'poor',
        },
        overall: {
          score: 0.3,
          readyToScan: false,
        },
      };

      await act(async () => {
        rerender(
          <QualityIndicator metrics={poorMetrics} enableHapticFeedback={true} />
        );
      });

      const Haptics = require('expo-haptics');
      expect(Haptics.notificationAsync).toHaveBeenCalled();
    });

    it('should not trigger haptic feedback when disabled', async () => {
      const { rerender } = render(
        <QualityIndicator
          metrics={mockRealTimeMetrics}
          enableHapticFeedback={false}
        />
      );

      const poorMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        blur: {
          value: 0.8,
          status: 'poor',
        },
        overall: {
          score: 0.3,
          readyToScan: false,
        },
      };

      await act(async () => {
        rerender(
          <QualityIndicator
            metrics={poorMetrics}
            enableHapticFeedback={false}
          />
        );
      });

      const Haptics = require('expo-haptics');
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility announcements', () => {
    it('should announce status changes for accessibility', async () => {
      const { rerender } = render(
        <QualityIndicator
          metrics={mockRealTimeMetrics}
          enableAccessibilityAnnouncements={true}
        />
      );

      const poorMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        blur: {
          value: 0.8,
          status: 'poor',
        },
        overall: {
          score: 0.3,
          readyToScan: false,
        },
      };

      await act(async () => {
        rerender(
          <QualityIndicator
            metrics={poorMetrics}
            enableAccessibilityAnnouncements={true}
          />
        );
      });

      const { AccessibilityInfo } = require('react-native');
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalled();
    });
  });

  describe('Visual feedback', () => {
    it('should render quality bars for detailed view', () => {
      const { getByText } = render(
        <QualityIndicator
          metrics={mockRealTimeMetrics}
          showDetails={true}
          compact={false}
        />
      );

      expect(getByText('Sharpness')).toBeTruthy();
      expect(getByText('Lighting')).toBeTruthy();
      expect(getByText('Position')).toBeTruthy();
    });

    it('should render compact view when specified', () => {
      const { queryByText } = render(
        <QualityIndicator metrics={mockRealTimeMetrics} compact={true} />
      );

      expect(queryByText('Sharpness')).toBeNull();
      expect(queryByText('Lighting')).toBeNull();
      expect(queryByText('Position')).toBeNull();
    });
  });

  describe('Mode-specific behavior', () => {
    it('should prioritize lighting warnings for OCR mode', () => {
      const warningMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        lighting: {
          brightness: 0.5,
          uniformity: 0.6,
          status: 'warning',
        },
        blur: {
          value: 0.4,
          status: 'warning',
        },
        overall: {
          score: 0.6,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <QualityIndicator metrics={warningMetrics} mode="ocr" />
      );

      expect(getByText('Lighting could be better')).toBeTruthy();
    });

    it('should prioritize blur warnings for PDF417 mode', () => {
      const warningMetrics: RealTimeQualityMetrics = {
        ...mockRealTimeMetrics,
        lighting: {
          brightness: 0.5,
          uniformity: 0.6,
          status: 'warning',
        },
        blur: {
          value: 0.4,
          status: 'warning',
        },
        overall: {
          score: 0.6,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <QualityIndicator metrics={warningMetrics} mode="pdf417" />
      );

      expect(getByText('Slight movement detected')).toBeTruthy();
    });
  });
});
