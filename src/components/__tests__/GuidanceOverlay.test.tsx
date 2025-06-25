import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GuidanceOverlay } from '../GuidanceOverlay';
import type { RealTimeQualityMetrics } from '../../types/license';

describe('GuidanceOverlay', () => {
  const goodMetrics: RealTimeQualityMetrics = {
    blur: {
      value: 0.1,
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

  describe('Message prioritization', () => {
    it('should show document detection message when no document detected', () => {
      const noDocMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.2,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.2,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={noDocMetrics} mode="pdf417" />
      );

      expect(
        getByText('Position the back of your license in the frame')
      ).toBeTruthy();
    });

    it('should show different message for OCR mode when no document detected', () => {
      const noDocMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.2,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.2,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={noDocMetrics} mode="ocr" />
      );

      expect(
        getByText('Position the front of your license in the frame')
      ).toBeTruthy();
    });

    it('should prioritize positioning issues over blur', () => {
      const poorPositionMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        blur: {
          value: 0.8,
          status: 'poor',
        },
        positioning: {
          documentDetected: true,
          alignment: 0.3,
          distance: 'too_close',
          status: 'poor',
        },
        overall: {
          score: 0.3,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={poorPositionMetrics} mode="pdf417" />
      );

      expect(getByText('Move device farther away')).toBeTruthy();
    });

    it('should show blur guidance when positioning is good', () => {
      const poorBlurMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        blur: {
          value: 0.8,
          status: 'poor',
        },
        overall: {
          score: 0.5,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={poorBlurMetrics} mode="pdf417" />
      );

      expect(getByText('Hold device steady')).toBeTruthy();
    });

    it('should show lighting guidance when blur and positioning are good', () => {
      const poorLightingMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
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
        <GuidanceOverlay metrics={poorLightingMetrics} mode="ocr" />
      );

      expect(getByText('Find better lighting')).toBeTruthy();
    });

    it('should show ready message when all metrics are good', () => {
      const { getByText } = render(
        <GuidanceOverlay metrics={goodMetrics} mode="pdf417" />
      );

      expect(getByText('Ready to scan')).toBeTruthy();
    });
  });

  describe('Visual styling', () => {
    it('should use red styling for high priority messages', () => {
      const criticalMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.1,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.1,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={criticalMetrics} mode="pdf417" />
      );

      const messageElement = getByText(
        'Position the back of your license in the frame'
      );
      expect(messageElement.props.style).toEqual(
        expect.objectContaining({
          color: '#F44336', // Red
        })
      );
    });

    it('should use green styling for ready state', () => {
      const { getByText } = render(
        <GuidanceOverlay metrics={goodMetrics} mode="pdf417" />
      );

      const messageElement = getByText('Ready to scan');
      expect(messageElement.props.style).toEqual(
        expect.objectContaining({
          color: '#4CAF50', // Green
        })
      );
    });

    it('should show appropriate icons for different states', () => {
      const noDocMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.2,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.2,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={noDocMetrics} mode="pdf417" />
      );

      expect(getByText('📱')).toBeTruthy(); // Phone icon for positioning
    });
  });

  describe('Dismiss functionality', () => {
    it('should show dismiss button when enabled', () => {
      const { getByText } = render(
        <GuidanceOverlay
          metrics={goodMetrics}
          mode="pdf417"
          showDismissButton={true}
        />
      );

      expect(getByText('×')).toBeTruthy();
    });

    it('should call onDismiss when dismiss button is pressed', () => {
      const onDismiss = jest.fn();

      const { getByText } = render(
        <GuidanceOverlay
          metrics={goodMetrics}
          mode="pdf417"
          showDismissButton={true}
          onDismiss={onDismiss}
        />
      );

      fireEvent.press(getByText('×'));
      expect(onDismiss).toHaveBeenCalled();
    });

    it('should not show dismiss button by default', () => {
      const { queryByText } = render(
        <GuidanceOverlay metrics={goodMetrics} mode="pdf417" />
      );

      expect(queryByText('×')).toBeNull();
    });
  });

  describe('Additional context', () => {
    it('should show additional context for PDF417 mode when no document detected', () => {
      const noDocMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.2,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.2,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={noDocMetrics} mode="pdf417" />
      );

      expect(getByText('Look for the barcode on the back')).toBeTruthy();
    });

    it('should show additional context for OCR mode when no document detected', () => {
      const noDocMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: false,
          alignment: 0.2,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.2,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={noDocMetrics} mode="ocr" />
      );

      expect(getByText('Ensure all corners are visible')).toBeTruthy();
    });
  });

  describe('Distance-specific messaging', () => {
    it('should show move closer message for too_far distance', () => {
      const tooFarMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: true,
          alignment: 0.4,
          distance: 'too_far',
          status: 'poor',
        },
        overall: {
          score: 0.4,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={tooFarMetrics} mode="pdf417" />
      );

      expect(getByText('Move device closer')).toBeTruthy();
    });

    it('should show move away message for too_close distance', () => {
      const tooCloseMetrics: RealTimeQualityMetrics = {
        ...goodMetrics,
        positioning: {
          documentDetected: true,
          alignment: 0.4,
          distance: 'too_close',
          status: 'poor',
        },
        overall: {
          score: 0.4,
          readyToScan: false,
        },
      };

      const { getByText } = render(
        <GuidanceOverlay metrics={tooCloseMetrics} mode="pdf417" />
      );

      expect(getByText('Move device farther away')).toBeTruthy();
    });
  });
});
