import React, { useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useVoiceOver, AccessibilityConfig } from '../../utils/accessibility';
import type { ScanMode } from '../../types/license';

export interface AccessibilityGesturesProps {
  children: React.ReactNode;
  onModeToggle?: () => void;
  onHelp?: () => void;
  onScanTrigger?: () => void;
  onReset?: () => void;
  currentMode?: ScanMode;
  isVoiceOverEnabled?: boolean;
  disabled?: boolean;
}

/**
 * Accessibility Gestures Component
 * Provides custom gestures that work alongside VoiceOver
 * - Two-finger double tap: Toggle scanning modes
 * - Three-finger swipe up: Show help
 * - Three-finger swipe down: Trigger scan
 * - Four-finger tap: Reset
 */
export const AccessibilityGestures: React.FC<AccessibilityGesturesProps> = ({
  children,
  onModeToggle,
  onHelp,
  onScanTrigger,
  onReset,
  currentMode,
  isVoiceOverEnabled = false,
  disabled = false,
}) => {
  const { announce } = useVoiceOver();
  const lastGestureTime = useRef<number>(0);

  // Minimum time between gestures to prevent accidental triggers
  const GESTURE_THROTTLE = 1000;

  /**
   * Check if gesture should be processed
   */
  const shouldProcessGesture = useCallback(() => {
    if (disabled || !isVoiceOverEnabled) return false;

    const now = Date.now();
    if (now - lastGestureTime.current < GESTURE_THROTTLE) return false;

    lastGestureTime.current = now;
    return true;
  }, [disabled, isVoiceOverEnabled]);

  /**
   * Two-finger double tap gesture - Toggle scanning modes
   */
  const toggleModeGesture = Gesture.Tap()
    .numberOfTaps(2)
    .numberOfPointers(2)
    .onEnd(() => {
      if (!shouldProcessGesture()) return;

      onModeToggle?.();

      // Announce the new mode
      if (currentMode) {
        const message =
          AccessibilityConfig.announcements.modeChanged(currentMode);
        announce(message);
      }
    });

  /**
   * Three-finger swipe up gesture - Show help
   */
  const helpGesture = Gesture.Pan()
    .numberOfPointers(3)
    .onEnd((event: any) => {
      if (!shouldProcessGesture()) return;

      // Check if it's an upward swipe
      if (event.translationY < -50) {
        onHelp?.();
        announce('Accessibility help activated');
      }
    });

  /**
   * Three-finger swipe down gesture - Trigger scan
   */
  const scanTriggerGesture = Gesture.Pan()
    .numberOfPointers(3)
    .onEnd((event: any) => {
      if (!shouldProcessGesture()) return;

      // Check if it's a downward swipe
      if (event.translationY > 50) {
        onScanTrigger?.();
        announce('Scanning triggered');
      }
    });

  /**
   * Four-finger tap gesture - Reset
   */
  const resetGesture = Gesture.Tap()
    .numberOfTaps(1)
    .numberOfPointers(4)
    .onEnd(() => {
      if (!shouldProcessGesture()) return;

      onReset?.();
      announce('Scanner reset');
    });

  /**
   * Combine all gestures
   */
  const combinedGesture = Gesture.Simultaneous(
    toggleModeGesture,
    helpGesture,
    scanTriggerGesture,
    resetGesture
  );

  return (
    <GestureDetector gesture={combinedGesture}>
      <View style={styles.container} accessible={false}>
        {children}
      </View>
    </GestureDetector>
  );
};

/**
 * Hook for accessibility gesture configuration
 */
export const useAccessibilityGestures = (config: {
  onModeToggle?: () => void;
  onHelp?: () => void;
  onScanTrigger?: () => void;
  onReset?: () => void;
  currentMode?: ScanMode;
}) => {
  const { isVoiceOverEnabled, announce } = useVoiceOver();
  const lastActionTime = useRef<number>(0);

  const executeAction = useCallback(
    (action: () => void, actionName: string) => {
      const now = Date.now();
      if (now - lastActionTime.current < 1000) return; // Throttle actions

      lastActionTime.current = now;
      action();
      announce(`${actionName} activated`);
    },
    [announce]
  );

  const gestureHandlers = {
    toggleMode: useCallback(() => {
      if (config.onModeToggle) {
        executeAction(config.onModeToggle, 'Mode toggle');
      }
    }, [config.onModeToggle, executeAction]),

    showHelp: useCallback(() => {
      if (config.onHelp) {
        executeAction(config.onHelp, 'Help');
      }
    }, [config.onHelp, executeAction]),

    triggerScan: useCallback(() => {
      if (config.onScanTrigger) {
        executeAction(config.onScanTrigger, 'Scan');
      }
    }, [config.onScanTrigger, executeAction]),

    reset: useCallback(() => {
      if (config.onReset) {
        executeAction(config.onReset, 'Reset');
      }
    }, [config.onReset, executeAction]),
  };

  return {
    isVoiceOverEnabled,
    gestureHandlers,
    announceGestureHelp: useCallback(() => {
      announce(AccessibilityConfig.hints.customGestures);
    }, [announce]),
  };
};

/**
 * Accessibility Gesture Help Component
 * Shows available gestures to users
 */
export const AccessibilityGestureHelp: React.FC<{
  visible: boolean;
  onDismiss: () => void;
}> = ({ visible, onDismiss }) => {
  const { announce } = useVoiceOver();

  React.useEffect(() => {
    if (visible) {
      const helpText = `
        Available accessibility gestures:
        Two-finger double tap to toggle scanning modes.
        Three-finger swipe up for help.
        Three-finger swipe down to trigger scanning.
        Four-finger tap to reset.
        Tap anywhere to dismiss this help.
      `;
      announce(helpText);
    }
  }, [visible, announce]);

  if (!visible) return null;

  return (
    <View
      style={styles.helpOverlay}
      accessible={true}
      accessibilityRole="none"
      accessibilityLabel="Accessibility gesture help"
      accessibilityViewIsModal={true}
      onTouchEnd={onDismiss}
    >
      <View style={styles.helpContent}>
        {/* Help content would go here if needed visually */}
      </View>
    </View>
  );
};

/**
 * Accessibility Actions for components
 * Provides custom accessibility actions that can be added to components
 */
export const getAccessibilityActions = (config: {
  onModeToggle?: () => void;
  onHelp?: () => void;
  onScanTrigger?: () => void;
  onReset?: () => void;
}) => {
  const actions = [];

  if (config.onModeToggle) {
    actions.push({
      name: 'toggle_mode',
      label: 'Toggle scanning mode',
    });
  }

  if (config.onScanTrigger) {
    actions.push({
      name: 'trigger_scan',
      label: 'Start scanning',
    });
  }

  if (config.onReset) {
    actions.push({
      name: 'reset',
      label: 'Reset scanner',
    });
  }

  if (config.onHelp) {
    actions.push({
      name: 'show_help',
      label: 'Show accessibility help',
    });
  }

  return actions;
};

/**
 * Handle accessibility action events
 */
export const handleAccessibilityAction = (
  event: { nativeEvent: { actionName: string } },
  config: {
    onModeToggle?: () => void;
    onHelp?: () => void;
    onScanTrigger?: () => void;
    onReset?: () => void;
  }
) => {
  const { actionName } = event.nativeEvent;

  switch (actionName) {
    case 'toggle_mode':
      config.onModeToggle?.();
      break;
    case 'trigger_scan':
      config.onScanTrigger?.();
      break;
    case 'reset':
      config.onReset?.();
      break;
    case 'show_help':
      config.onHelp?.();
      break;
  }
};

/**
 * Accessibility gesture utilities
 */
export const AccessibilityGestureUtils = {
  /**
   * Check if gesture conflicts with VoiceOver gestures
   */
  isGestureConflicting: (
    numberOfPointers: number,
    numberOfTaps: number
  ): boolean => {
    // VoiceOver uses single-finger gestures primarily
    // Two-finger and three-finger gestures are generally safe
    if (numberOfPointers === 1) {
      return true; // May conflict with VoiceOver navigation
    }

    // Specific VoiceOver gesture conflicts
    if (numberOfPointers === 2 && numberOfTaps === 1) {
      return true; // VoiceOver uses two-finger single tap for reading
    }

    return false;
  },

  /**
   * Get recommended gesture for action
   */
  getRecommendedGesture: (action: 'toggle' | 'scan' | 'help' | 'reset') => {
    const gestures = {
      toggle: { pointers: 2, taps: 2, description: 'Two-finger double tap' },
      scan: {
        pointers: 3,
        swipe: 'down',
        description: 'Three-finger swipe down',
      },
      help: { pointers: 3, swipe: 'up', description: 'Three-finger swipe up' },
      reset: { pointers: 4, taps: 1, description: 'Four-finger tap' },
    };

    return gestures[action];
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  helpOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  helpContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AccessibilityGestures;
