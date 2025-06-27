import { useEffect, useCallback } from 'react';
import {
  useVoiceOver,
  useFocusManagement,
  useHighContrast,
  useDynamicType,
  useReducedMotion,
  AccessibilityConfig,
} from '../utils/accessibility';
import { useVoiceGuidance } from '../components/accessibility/VoiceGuidanceSystem';
import type { ScanMode, QualityMetrics } from '../types/license';

/**
 * Comprehensive accessibility hook that combines all accessibility features
 * This is the main hook to use in scanning components
 */
export const useAccessibilityFeatures = () => {
  const voiceOver = useVoiceOver();
  const focusManagement = useFocusManagement();
  const highContrast = useHighContrast();
  const dynamicType = useDynamicType();
  const reducedMotion = useReducedMotion();
  const voiceGuidance = useVoiceGuidance();

  return {
    // Voice Over features
    ...voiceOver,

    // Focus management
    ...focusManagement,

    // Visual adaptations
    isHighContrast: highContrast,
    dynamicType,
    isReducedMotion: reducedMotion,

    // Voice guidance
    ...voiceGuidance,
  };
};

/**
 * Hook for scanning-specific accessibility features
 */
export const useScanningAccessibility = (config: {
  isScanning: boolean;
  currentMode: ScanMode;
  qualityMetrics?: QualityMetrics;
  documentDetected?: boolean;
}) => {
  const { announce, isVoiceOverEnabled } = useVoiceOver();

  // Announce mode changes
  useEffect(() => {
    if (isVoiceOverEnabled) {
      const message = AccessibilityConfig.announcements.modeChanged(
        config.currentMode
      );
      announce(message);
    }
  }, [config.currentMode, isVoiceOverEnabled, announce]);

  // Announce scanning state changes
  useEffect(() => {
    if (isVoiceOverEnabled && config.isScanning) {
      announce(AccessibilityConfig.announcements.scanningStarted);
    }
  }, [config.isScanning, isVoiceOverEnabled, announce]);

  // Announce document detection
  useEffect(() => {
    if (isVoiceOverEnabled && config.documentDetected !== undefined) {
      const message = config.documentDetected
        ? AccessibilityConfig.announcements.documentDetected
        : AccessibilityConfig.announcements.documentLost;
      announce(message);
    }
  }, [config.documentDetected, isVoiceOverEnabled, announce]);

  // Quality announcements
  const announceQuality = useCallback(
    (metrics: QualityMetrics) => {
      if (isVoiceOverEnabled && metrics) {
        const message = AccessibilityConfig.announcements.scanningProgress(
          metrics.overall
        );
        announce(message);
      }
    },
    [isVoiceOverEnabled, announce]
  );

  return {
    announceQuality,
    isAccessibilityEnabled: isVoiceOverEnabled,
  };
};

/**
 * Hook for result screen accessibility
 */
export const useResultAccessibility = () => {
  const { focusElement } = useFocusManagement();
  const { announce } = useVoiceOver();

  const announceResults = useCallback(
    (fieldCount: number) => {
      announce(
        `Scan complete. ${fieldCount} fields detected. Swipe to navigate through results.`
      );
    },
    [announce]
  );

  const focusFirstResult = useCallback(
    (ref: React.RefObject<any>) => {
      setTimeout(() => {
        focusElement(ref);
      }, 500);
    },
    [focusElement]
  );

  return {
    announceResults,
    focusFirstResult,
  };
};
