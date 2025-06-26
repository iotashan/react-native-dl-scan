import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing } from 'react-native-reanimated';

/**
 * Shared animation configuration following Material Design principles
 */
export const AnimationConfig = {
  duration: {
    fast: 200,
    normal: 300,
    slow: 500,
  },
  easing: {
    standard: Easing.bezier(0.4, 0.0, 0.2, 1), // Material Design standard
    decelerate: Easing.bezier(0.0, 0.0, 0.2, 1), // Entering
    accelerate: Easing.bezier(0.4, 0.0, 1, 1), // Exiting
    linear: Easing.linear,
  },
  spring: {
    default: {
      damping: 15,
      stiffness: 150,
      mass: 1,
    },
    gentle: {
      damping: 20,
      stiffness: 100,
      mass: 1,
    },
    bouncy: {
      damping: 10,
      stiffness: 200,
      mass: 1,
    },
  },
} as const;

/**
 * Hook to check if user prefers reduced motion
 * Respects system accessibility preferences
 */
export const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check initial preference
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);

    // Listen for changes
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion
    );

    return () => subscription.remove();
  }, []);

  return reducedMotion;
};

/**
 * Get animation configuration that respects reduced motion preference
 */
export const useAnimationConfig = () => {
  const reducedMotion = useReducedMotion();

  return reducedMotion
    ? {
        duration: 0,
        easing: {
          standard: Easing.linear,
          decelerate: Easing.linear,
          accelerate: Easing.linear,
          linear: Easing.linear,
        },
        spring: { damping: 100, stiffness: 100, mass: 1 },
      }
    : AnimationConfig;
};

/**
 * Animation timing presets for common use cases
 */
export const AnimationTimings = {
  // Quick feedback animations
  feedback: {
    duration: AnimationConfig.duration.fast,
    easing: AnimationConfig.easing.standard,
  },
  // Mode transitions
  transition: {
    duration: AnimationConfig.duration.normal,
    easing: AnimationConfig.easing.decelerate,
  },
  // Success/completion animations
  success: {
    duration: AnimationConfig.duration.slow,
    easing: AnimationConfig.easing.standard,
  },
  // Error/failure animations
  error: {
    duration: AnimationConfig.duration.fast,
    easing: AnimationConfig.easing.accelerate,
  },
} as const;

/**
 * Common animation values for consistent spacing and sizing
 */
export const AnimationValues = {
  // Spacing for slide animations
  slideDistance: {
    small: 10,
    medium: 20,
    large: 40,
  },
  // Scale values for emphasis
  scale: {
    subtle: 1.05,
    medium: 1.1,
    large: 1.2,
  },
  // Opacity values for fade animations
  opacity: {
    hidden: 0,
    semi: 0.5,
    visible: 1,
  },
} as const;

/**
 * Animation sequence helpers
 */
export const createSequence = {
  /**
   * Bounce effect for success feedback
   */
  bounce: (scale: number) => [
    { value: scale * 1.2, config: AnimationTimings.feedback },
    { value: scale * 0.95, config: AnimationTimings.feedback },
    { value: scale, config: AnimationTimings.feedback },
  ],

  /**
   * Shake effect for error feedback
   */
  shake: (distance: number) => [
    { value: -distance, config: { duration: 50, easing: Easing.linear } },
    { value: distance, config: { duration: 50, easing: Easing.linear } },
    { value: -distance, config: { duration: 50, easing: Easing.linear } },
    { value: 0, config: { duration: 50, easing: Easing.linear } },
  ],

  /**
   * Fade in/out sequence
   */
  fade: (fromOpacity: number, toOpacity: number) => [
    { value: fromOpacity, config: { duration: 0 } },
    { value: toOpacity, config: AnimationTimings.transition },
  ],
} as const;

/**
 * Performance monitoring utilities
 */
export const AnimationPerformance = {
  /**
   * Frame budget monitoring (target: 16.67ms per frame for 60fps)
   */
  targetFrameTime: 16.67,

  /**
   * Check if animation should be simplified based on device performance
   */
  shouldSimplifyAnimations: () => {
    // On lower-end devices, we might want to disable complex animations
    // This is a placeholder - in real implementation, you'd check device specs
    return false;
  },

  /**
   * Preload animation assets to prevent jank
   */
  preloadAssets: async () => {
    // Placeholder for preloading Lottie files or other animation assets
    return Promise.resolve();
  },
} as const;

/**
 * Type definitions for animation configurations
 */
export type AnimationDuration = keyof typeof AnimationConfig.duration;
export type AnimationEasing = keyof typeof AnimationConfig.easing;
export type SpringConfig = typeof AnimationConfig.spring.default;
export type AnimationTiming = typeof AnimationTimings.feedback;
