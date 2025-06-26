import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Dimensions,
  PixelRatio,
} from 'react-native';
import type { ScanMode } from '../types/license';

/**
 * Accessibility Configuration
 * Centralized configuration for all accessibility strings and settings
 */
export const AccessibilityConfig = {
  // Screen reader announcements
  announcements: {
    modeChanged: (mode: ScanMode): string => {
      const modeNames: Record<ScanMode, string> = {
        auto: 'Automatic scanning mode',
        barcode: 'Barcode scanning mode',
        ocr: 'OCR scanning mode',
      };
      return `Switched to ${modeNames[mode] || 'Unknown mode'}`;
    },
    scanningStarted:
      "Scanning started. Position your driver's license within the camera frame.",
    scanningProgress: (quality: number): string => {
      if (quality < 0.3)
        return 'Poor image quality. Adjust positioning for better results.';
      if (quality < 0.7) return 'Good image quality. Hold steady for scanning.';
      return 'Excellent image quality. Scanning in progress.';
    },
    scanSuccess: "Driver's license scanned successfully.",
    scanError: (error: string): string =>
      `Scanning failed: ${error}. Please try again.`,
    documentDetected: "Driver's license detected in frame.",
    documentLost:
      "Driver's license no longer detected. Reposition within camera frame.",
    qualityImproved: 'Image quality improved.',
    qualityDegraded: 'Image quality decreased. Adjust positioning.',
  },

  // Component labels
  labels: {
    cameraView: "Camera view for scanning driver's license",
    modeSelector: 'Scanning mode selector',
    scanButton: 'Start scanning',
    stopButton: 'Stop scanning',
    retryButton: 'Retry scanning',
    resetButton: 'Reset and start over',
    resultField: (field: string, value: string): string =>
      `${field}: ${value || 'Not detected'}`,
    qualityIndicator: 'Image quality indicator',
    scanningOverlay: 'Scanning overlay with positioning guides',
  },

  // Navigation hints
  hints: {
    positioningGuide:
      "Use audio guidance to position your driver's license correctly",
    qualityImprovement: 'Move closer or farther to improve image quality',
    modeSelection: 'Swipe up or down to change scanning mode',
    customGestures:
      'Use two-finger double tap to toggle modes, three-finger swipe for help',
    scanningInstructions:
      'Position license flat, well-lit, and within camera frame',
  },

  // Roles and traits
  roles: {
    camera: 'none' as const,
    button: 'button' as const,
    text: 'text' as const,
    image: 'image' as const,
    adjustable: 'adjustable' as const,
    header: 'header' as const,
    summary: 'summary' as const,
  },

  // Live region settings
  liveRegions: {
    polite: 'polite' as const,
    assertive: 'assertive' as const,
    none: 'none' as const,
  },
} as const;

/**
 * Hook for VoiceOver support and announcements
 */
export const useVoiceOver = () => {
  const [isVoiceOverEnabled, setIsVoiceOverEnabled] = useState(false);
  const lastAnnouncementRef = useRef<string>('');
  const announcementTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check initial VoiceOver state
    AccessibilityInfo.isScreenReaderEnabled().then(setIsVoiceOverEnabled);

    // Listen for VoiceOver changes
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setIsVoiceOverEnabled
    );

    return () => {
      subscription?.remove();
      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current);
      }
    };
  }, []);

  const announce = useCallback(
    (message: string, priority: 'polite' | 'assertive' = 'polite') => {
      // Prevent duplicate announcements
      if (message === lastAnnouncementRef.current) return;

      lastAnnouncementRef.current = message;

      // Clear previous timeout
      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current);
      }

      // Delay announcement slightly to avoid overwhelming
      announcementTimeoutRef.current = setTimeout(
        () => {
          AccessibilityInfo.announceForAccessibility(message);
        },
        priority === 'assertive' ? 0 : 100
      );
    },
    []
  );

  const announceDelayed = useCallback(
    (message: string, delay: number = 500) => {
      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current);
      }

      announcementTimeoutRef.current = setTimeout(() => {
        announce(message);
      }, delay);
    },
    [announce]
  );

  return {
    isVoiceOverEnabled,
    announce,
    announceDelayed,
  };
};

/**
 * Hook for focus management
 */
export const useFocusManagement = () => {
  const focusElement = useCallback((elementRef: React.RefObject<any>) => {
    if (elementRef.current) {
      const node = findNodeHandle(elementRef.current);
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }
  }, []);

  const focusElementById = useCallback((element: any) => {
    if (element) {
      const node = findNodeHandle(element);
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }
  }, []);

  return {
    focusElement,
    focusElementById,
  };
};

/**
 * Hook for focus trap in modal screens
 */
export const useFocusTrap = (isActive: boolean) => {
  const firstElementRef = useRef<any>(null);
  const lastElementRef = useRef<any>(null);
  const { focusElement } = useFocusManagement();

  useEffect(() => {
    if (isActive && firstElementRef.current) {
      // Small delay to ensure element is rendered
      setTimeout(() => {
        focusElement(firstElementRef);
      }, 100);
    }
  }, [isActive, focusElement]);

  return { firstElementRef, lastElementRef };
};

/**
 * Hook for high contrast support
 */
export const useHighContrast = () => {
  const [isHighContrast, setIsHighContrast] = useState(false);

  useEffect(() => {
    // iOS specific high contrast detection
    if (AccessibilityInfo.isHighTextContrastEnabled) {
      AccessibilityInfo.isHighTextContrastEnabled().then(setIsHighContrast);

      // Note: Event listener for high contrast changes may not be available
      // This is a simplified implementation
    }
  }, []);

  return isHighContrast;
};

/**
 * Hook for Dynamic Type support
 */
export const useDynamicType = () => {
  const [fontScale, setFontScale] = useState(1);

  useEffect(() => {
    const updateFontScale = () => {
      setFontScale(PixelRatio.getFontScale());
    };

    const subscription = Dimensions.addEventListener('change', updateFontScale);
    updateFontScale();

    return () => subscription?.remove();
  }, []);

  const fontSize = useCallback((base: number) => base * fontScale, [fontScale]);
  const lineHeight = useCallback(
    (base: number) => base * fontScale * 1.2,
    [fontScale]
  );

  return {
    fontScale,
    fontSize,
    lineHeight,
  };
};

/**
 * Hook for reduced motion support (extends animation utilities)
 */
export const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion
    );

    return () => subscription.remove();
  }, []);

  return reducedMotion;
};

/**
 * Hook for bold text support
 */
export const useBoldText = () => {
  const [isBoldTextEnabled, setIsBoldTextEnabled] = useState(false);

  useEffect(() => {
    if (AccessibilityInfo.isBoldTextEnabled) {
      AccessibilityInfo.isBoldTextEnabled().then(setIsBoldTextEnabled);

      // Note: Bold text change events may not be available on all platforms
      // This is a simplified implementation
    }
  }, []);

  return isBoldTextEnabled;
};

/**
 * High contrast color scheme
 */
export const getHighContrastColors = (isHighContrast: boolean) => {
  if (!isHighContrast) return null;

  return {
    primary: '#000000',
    secondary: '#FFFFFF',
    success: '#007700',
    error: '#CC0000',
    warning: '#996600',
    border: '#000000',
    text: '#000000',
    textSecondary: '#333333',
    background: '#FFFFFF',
    backgroundSecondary: '#F0F0F0',
    surface: '#FFFFFF',
    overlay: 'rgba(0, 0, 0, 0.8)',
  };
};

/**
 * Accessibility testing utilities
 */
export const AccessibilityTestUtils = {
  /**
   * Check if element has proper accessibility label
   */
  hasAccessibilityLabel: (element: any): boolean => {
    return !!(
      element?.props?.accessibilityLabel ||
      element?.props?.accessibilityLabelledBy
    );
  },

  /**
   * Check if interactive element has proper role
   */
  hasAccessibilityRole: (element: any): boolean => {
    return !!element?.props?.accessibilityRole;
  },

  /**
   * Check if element has proper accessibility state
   */
  hasAccessibilityState: (element: any): boolean => {
    return !!element?.props?.accessibilityState;
  },

  /**
   * Generate accessibility report for component tree
   */
  generateAccessibilityReport: (
    _componentTree: any
  ): {
    warnings: string[];
    errors: string[];
    suggestions: string[];
  } => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const suggestions: string[] = [];

    // This would be expanded with actual accessibility validation logic
    // For now, it's a placeholder for the structure

    return { warnings, errors, suggestions };
  },
};

/**
 * Common accessibility props generator
 */
export const getAccessibilityProps = (config: {
  label: string;
  hint?: string;
  role?: keyof typeof AccessibilityConfig.roles;
  state?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean;
    expanded?: boolean;
    busy?: boolean;
  };
  value?: {
    min?: number;
    max?: number;
    now?: number;
    text?: string;
  };
  liveRegion?: keyof typeof AccessibilityConfig.liveRegions;
  actions?: Array<{
    name: string;
    label: string;
  }>;
}) => {
  const props: any = {
    accessible: true,
    accessibilityLabel: config.label,
  };

  if (config.hint) {
    props.accessibilityHint = config.hint;
  }

  if (config.role) {
    props.accessibilityRole = AccessibilityConfig.roles[config.role];
  }

  if (config.state) {
    props.accessibilityState = config.state;
  }

  if (config.value) {
    props.accessibilityValue = config.value;
  }

  if (config.liveRegion) {
    props.accessibilityLiveRegion =
      AccessibilityConfig.liveRegions[config.liveRegion];
  }

  if (config.actions) {
    props.accessibilityActions = config.actions;
  }

  return props;
};

/**
 * Type definitions
 */
export type AccessibilityRole = keyof typeof AccessibilityConfig.roles;
export type AccessibilityLiveRegion =
  keyof typeof AccessibilityConfig.liveRegions;

export interface AccessibilityState {
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean;
  expanded?: boolean;
  busy?: boolean;
}

export interface AccessibilityValue {
  min?: number;
  max?: number;
  now?: number;
  text?: string;
}

export interface AccessibilityAction {
  name: string;
  label: string;
}
