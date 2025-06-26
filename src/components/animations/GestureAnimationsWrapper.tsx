import React from 'react';
import type { GestureAnimationsProps, GestureAnimationsRef } from './GestureAnimations';

// Try to import the actual implementation
let GestureAnimationsImpl: React.ForwardRefExoticComponent<
  GestureAnimationsProps & React.RefAttributes<GestureAnimationsRef>
> | null = null;

try {
  // This will only work if react-native-gesture-handler is installed
  GestureAnimationsImpl = require('./GestureAnimations').GestureAnimations;
} catch (error) {
  // Gesture handler not available
  console.warn(
    'react-native-gesture-handler not installed. Gesture animations will be disabled.'
  );
}

// Fallback component when gesture handler is not available
const GestureAnimationsFallback = React.forwardRef<
  GestureAnimationsRef,
  GestureAnimationsProps
>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    resetTransform: () => {},
    zoomTo: () => {},
    panTo: () => {},
    getCurrentTransform: () => ({ scale: 1, translateX: 0, translateY: 0 }),
  }));

  return <>{props.children}</>;
});

GestureAnimationsFallback.displayName = 'GestureAnimationsFallback';

// Export the wrapper that conditionally uses the real implementation
export const GestureAnimations = GestureAnimationsImpl || GestureAnimationsFallback;
export type { GestureAnimationsProps, GestureAnimationsRef };