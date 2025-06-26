import React from 'react';
import { View } from 'react-native';
import type { AccessibilityGesturesProps } from './AccessibilityGestures';

// Try to import the actual implementation
let AccessibilityGesturesImpl: React.FC<AccessibilityGesturesProps> | null =
  null;

try {
  // This will only work if react-native-gesture-handler is installed
  AccessibilityGesturesImpl =
    require('./AccessibilityGestures').AccessibilityGestures;
} catch (error) {
  // Gesture handler not available
  console.warn(
    'react-native-gesture-handler not installed. Accessibility gestures will be disabled.'
  );
}

// Fallback component when gesture handler is not available
const AccessibilityGesturesFallback: React.FC<AccessibilityGesturesProps> = ({
  children,
  ...props
}) => {
  return <View {...props}>{children}</View>;
};

// Export the wrapper that conditionally uses the real implementation
export const AccessibilityGestures =
  AccessibilityGesturesImpl || AccessibilityGesturesFallback;
export type { AccessibilityGesturesProps };
