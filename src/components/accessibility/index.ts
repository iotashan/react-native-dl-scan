// Core Accessibility Components
export {
  default as VoiceGuidanceSystem,
  useVoiceGuidance,
  VoiceGuidanceScenarios,
} from './VoiceGuidanceSystem';
export { AccessibilityGestures } from './AccessibilityGesturesWrapper';
export type { AccessibilityGesturesProps } from './AccessibilityGesturesWrapper';
export {
  useAccessibilityGestures,
  AccessibilityGestureHelp,
  getAccessibilityActions,
  handleAccessibilityAction,
  AccessibilityGestureUtils,
} from './AccessibilityGestures';
export {
  AccessibleButton,
  AccessibleCameraView,
  AccessibleModeSelector,
  AccessibleResultField,
  AccessibleQualityIndicator,
  AccessibleModal,
} from './AccessibleComponents';

// Accessibility Utilities
export {
  AccessibilityConfig,
  useVoiceOver,
  useFocusManagement,
  useFocusTrap,
  useHighContrast,
  useDynamicType,
  useReducedMotion,
  useBoldText,
  getHighContrastColors,
  getAccessibilityProps,
  AccessibilityTestUtils,
} from '../../utils/accessibility';

export type {
  AccessibilityRole,
  AccessibilityLiveRegion,
  AccessibilityState,
  AccessibilityValue,
  AccessibilityAction,
} from '../../utils/accessibility';

// Testing Utilities
export {
  AccessibilityTestSuite,
  AccessibilityTestHelpers,
  AccessibilityPerformanceMonitor,
  AccessibilityDebugUtils,
  accessibilityTestSuite,
  accessibilityPerformanceMonitor,
} from '../../utils/accessibilityTesting';

export type {
  AccessibilityIssue,
  AccessibilityReport,
} from '../../utils/accessibilityTesting';
