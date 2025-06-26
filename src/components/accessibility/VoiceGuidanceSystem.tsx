import React, { useEffect, useCallback, useRef } from 'react';
import { useVoiceOver, AccessibilityConfig } from '../../utils/accessibility';
import type { ScanMode } from '../../types/license';

/**
 * Quality metrics interface for guidance
 */
interface QualityMetrics {
  overall: number;
  positioning: {
    distance: 'too_close' | 'too_far' | 'optimal';
    angle: 'tilted' | 'straight';
    documentDetected: boolean;
    inFrame: boolean;
  };
  lighting: {
    overall: number;
    uniformity: number;
    shadows: boolean;
    glare: boolean;
  };
  focus: {
    sharpness: number;
    blurDetected: boolean;
  };
}

interface VoiceGuidanceSystemProps {
  isScanning: boolean;
  currentMode: ScanMode;
  qualityMetrics?: QualityMetrics;
  scanningProgress?: number;
  documentDetected?: boolean;
  scanResult?: 'success' | 'error' | null;
  errorMessage?: string;
  onGuidanceComplete?: () => void;
}

/**
 * Voice Guidance System Component
 * Provides real-time audio feedback for scanning process
 * Helps users position their driver's license correctly
 */
const VoiceGuidanceSystem: React.FC<VoiceGuidanceSystemProps> = ({
  isScanning,
  currentMode,
  qualityMetrics,
  scanningProgress,
  documentDetected,
  scanResult,
  errorMessage,
  onGuidanceComplete,
}) => {
  const { isVoiceOverEnabled, announce, announceDelayed } = useVoiceOver();

  // Refs to track previous states and prevent spam
  const previousDocumentDetected = useRef<boolean | undefined>(undefined);
  const previousQualityLevel = useRef<string>('');
  const previousDistance = useRef<string>('');
  const lastGuidanceTime = useRef<number>(0);
  const guidanceIntervalRef = useRef<NodeJS.Timeout>();

  // Minimum time between guidance announcements (in milliseconds)
  const GUIDANCE_THROTTLE = 2000;

  /**
   * Provide positioning guidance based on quality metrics
   */
  const providePositioningGuidance = useCallback(
    (metrics: QualityMetrics) => {
      const now = Date.now();
      if (now - lastGuidanceTime.current < GUIDANCE_THROTTLE) return;

      const { positioning, lighting, focus } = metrics;
      let guidanceMessage = '';

      // Distance guidance (highest priority)
      if (positioning.distance !== previousDistance.current) {
        if (positioning.distance === 'too_close') {
          guidanceMessage = 'Move device farther from license';
        } else if (positioning.distance === 'too_far') {
          guidanceMessage = 'Move device closer to license';
        } else if (positioning.distance === 'optimal') {
          guidanceMessage = 'Good distance. Hold steady';
        }
        previousDistance.current = positioning.distance;
      }

      // Document positioning
      if (!positioning.documentDetected && positioning.inFrame) {
        guidanceMessage = 'Position license within camera frame';
      } else if (positioning.angle === 'tilted') {
        guidanceMessage = 'Straighten the license. Keep it flat';
      }

      // Lighting guidance
      if (lighting.shadows) {
        guidanceMessage = 'Move to better lighting. Avoid shadows';
      } else if (lighting.glare) {
        guidanceMessage = 'Reduce glare. Adjust angle or lighting';
      } else if (lighting.overall < 0.4) {
        guidanceMessage = 'Move to brighter lighting';
      }

      // Focus guidance
      if (focus.blurDetected) {
        guidanceMessage = 'Hold device steady to reduce blur';
      }

      if (guidanceMessage) {
        announce(guidanceMessage);
        lastGuidanceTime.current = now;
      }
    },
    [announce]
  );

  /**
   * Announce quality level changes
   */
  const announceQualityChange = useCallback(
    (quality: number) => {
      let qualityLevel = '';

      if (quality < 0.3) {
        qualityLevel = 'poor';
      } else if (quality < 0.7) {
        qualityLevel = 'good';
      } else {
        qualityLevel = 'excellent';
      }

      if (qualityLevel !== previousQualityLevel.current) {
        const message =
          AccessibilityConfig.announcements.scanningProgress(quality);
        announceDelayed(message, 500);
        previousQualityLevel.current = qualityLevel;
      }
    },
    [announceDelayed]
  );

  /**
   * Handle scanning mode changes
   */
  useEffect(() => {
    if (isVoiceOverEnabled) {
      const message =
        AccessibilityConfig.announcements.modeChanged(currentMode);
      announceDelayed(message, 300);
    }
  }, [currentMode, isVoiceOverEnabled, announceDelayed]);

  /**
   * Handle scanning state changes
   */
  useEffect(() => {
    if (!isVoiceOverEnabled) return;

    if (isScanning) {
      announce(AccessibilityConfig.announcements.scanningStarted);

      // Start periodic guidance
      guidanceIntervalRef.current = setInterval(() => {
        if (qualityMetrics) {
          providePositioningGuidance(qualityMetrics);
        }
      }, GUIDANCE_THROTTLE);
    } else {
      // Stop periodic guidance
      if (guidanceIntervalRef.current) {
        clearInterval(guidanceIntervalRef.current);
        guidanceIntervalRef.current = undefined;
      }
    }

    return () => {
      if (guidanceIntervalRef.current) {
        clearInterval(guidanceIntervalRef.current);
      }
    };
  }, [
    isScanning,
    isVoiceOverEnabled,
    announce,
    qualityMetrics,
    providePositioningGuidance,
  ]);

  /**
   * Handle document detection changes
   */
  useEffect(() => {
    if (!isVoiceOverEnabled) return;

    if (documentDetected !== previousDocumentDetected.current) {
      if (documentDetected === true) {
        announce(AccessibilityConfig.announcements.documentDetected);
      } else if (
        documentDetected === false &&
        previousDocumentDetected.current === true
      ) {
        announce(AccessibilityConfig.announcements.documentLost);
      }
      previousDocumentDetected.current = documentDetected;
    }
  }, [documentDetected, isVoiceOverEnabled, announce]);

  /**
   * Handle quality metrics changes
   */
  useEffect(() => {
    if (!isVoiceOverEnabled || !qualityMetrics || !isScanning) return;

    announceQualityChange(qualityMetrics.overall);
  }, [qualityMetrics, isVoiceOverEnabled, isScanning, announceQualityChange]);

  /**
   * Handle scan results
   */
  useEffect(() => {
    if (!isVoiceOverEnabled) return;

    if (scanResult === 'success') {
      announce(AccessibilityConfig.announcements.scanSuccess);
      onGuidanceComplete?.();
    } else if (scanResult === 'error') {
      const message = AccessibilityConfig.announcements.scanError(
        errorMessage || 'Unknown error'
      );
      announce(message);
    }
  }, [
    scanResult,
    errorMessage,
    isVoiceOverEnabled,
    announce,
    onGuidanceComplete,
  ]);

  /**
   * Handle scanning progress for longer scans
   */
  useEffect(() => {
    if (!isVoiceOverEnabled || !isScanning || scanningProgress === undefined)
      return;

    // Announce progress milestones
    if (scanningProgress >= 0.5 && scanningProgress < 0.6) {
      announceDelayed('Scanning in progress. Hold steady', 1000);
    } else if (scanningProgress >= 0.8) {
      announceDelayed('Almost complete. Keep license in position', 1000);
    }
  }, [scanningProgress, isScanning, isVoiceOverEnabled, announceDelayed]);

  // This component doesn't render anything visible
  return null;
};

/**
 * Hook for voice guidance integration
 * Provides easy integration with existing scanning components
 */
export const useVoiceGuidance = () => {
  const { isVoiceOverEnabled, announce } = useVoiceOver();

  const announceInstructions = useCallback(() => {
    if (isVoiceOverEnabled) {
      announce(AccessibilityConfig.hints.scanningInstructions);
    }
  }, [isVoiceOverEnabled, announce]);

  const announceCustomGestures = useCallback(() => {
    if (isVoiceOverEnabled) {
      announce(AccessibilityConfig.hints.customGestures);
    }
  }, [isVoiceOverEnabled, announce]);

  const announceError = useCallback(
    (error: string) => {
      if (isVoiceOverEnabled) {
        const message = AccessibilityConfig.announcements.scanError(error);
        announce(message);
      }
    },
    [isVoiceOverEnabled, announce]
  );

  const announceSuccess = useCallback(() => {
    if (isVoiceOverEnabled) {
      announce(AccessibilityConfig.announcements.scanSuccess);
    }
  }, [isVoiceOverEnabled, announce]);

  return {
    isVoiceOverEnabled,
    announceInstructions,
    announceCustomGestures,
    announceError,
    announceSuccess,
  };
};

/**
 * Voice guidance for specific scanning scenarios
 */
export const VoiceGuidanceScenarios = {
  /**
   * Initial setup guidance
   */
  initialSetup: (announce: (message: string) => void) => {
    announce(
      "Position your driver's license on a flat surface with good lighting. Make sure all text is clearly visible."
    );
  },

  /**
   * Auto mode guidance
   */
  autoMode: (announce: (message: string) => void) => {
    announce(
      'Automatic scanning mode active. Hold your device steady over the license. Scanning will begin automatically when positioning is optimal.'
    );
  },

  /**
   * Manual mode guidance
   */
  manualMode: (announce: (message: string) => void) => {
    announce(
      'Manual scanning mode active. Position the license in the camera frame and tap the scan button when ready.'
    );
  },

  /**
   * Batch mode guidance
   */
  batchMode: (announce: (message: string) => void) => {
    announce(
      'Batch scanning mode active. You can scan multiple licenses in sequence. Position the first license and begin scanning.'
    );
  },

  /**
   * Error recovery guidance
   */
  errorRecovery: (announce: (message: string) => void, error: string) => {
    let recoveryMessage = 'Scanning failed. ';

    if (error.includes('blur')) {
      recoveryMessage +=
        'Hold the device steadier and ensure the license is in focus.';
    } else if (error.includes('lighting')) {
      recoveryMessage +=
        'Move to better lighting or adjust the angle to reduce glare.';
    } else if (error.includes('position')) {
      recoveryMessage += 'Reposition the license within the camera frame.';
    } else {
      recoveryMessage +=
        'Check the license position and lighting, then try again.';
    }

    announce(recoveryMessage);
  },
};

export default VoiceGuidanceSystem;
