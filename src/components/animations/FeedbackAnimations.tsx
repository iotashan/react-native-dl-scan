import React, { useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import {
  useAnimationConfig,
  createSequence,
  AnimationValues,
} from '../../utils/animations';

interface FeedbackAnimationProps {
  children: React.ReactNode;
  onAnimationComplete?: () => void;
}

export interface FeedbackAnimationRef {
  playSuccess: () => void;
  playError: () => void;
  reset: () => void;
}

/**
 * Success Animation Component
 * Creates a bouncy, celebratory animation for successful scans
 */
export const SuccessAnimation = forwardRef<
  FeedbackAnimationRef,
  FeedbackAnimationProps
>(({ children, onAnimationComplete }, ref) => {
  const animationConfig = useAnimationConfig();

  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotation.value}deg` }],
    opacity: opacity.value,
  }));

  const playSuccess = React.useCallback(() => {
    // Skip animation if reduced motion is enabled
    if (animationConfig.duration === 0) {
      onAnimationComplete?.();
      return;
    }

    // Bouncy scale animation
    scale.value = withSequence(
      withTiming(0.8, { duration: 100 }), // Quick shrink
      withSpring(1.2, animationConfig.spring.bouncy), // Bounce up
      withSpring(1, animationConfig.spring.default) // Settle
    );

    // Gentle rotation for celebration
    rotation.value = withTiming(
      360,
      {
        duration: 600,
        easing: animationConfig.easing.standard,
      },
      (finished) => {
        if (finished && onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      }
    );
  }, [animationConfig, onAnimationComplete]);

  const playError = React.useCallback(() => {
    // Error animations handled by ErrorAnimation component
  }, []);

  const reset = React.useCallback(() => {
    scale.value = 1;
    rotation.value = 0;
    opacity.value = 1;
  }, []);

  useImperativeHandle(ref, () => ({
    playSuccess,
    playError,
    reset,
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.animatedContainer, animatedStyle]}>
        {children}
      </Animated.View>
    </View>
  );
});

/**
 * Error Animation Component
 * Creates a shake animation for errors and failed scans
 */
export const ErrorAnimation = forwardRef<
  FeedbackAnimationRef,
  FeedbackAnimationProps
>(({ children, onAnimationComplete }, ref) => {
  const animationConfig = useAnimationConfig();

  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const backgroundColor = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
    backgroundColor: `rgba(255, 0, 0, ${backgroundColor.value * 0.1})`, // Subtle red flash
  }));

  const playError = React.useCallback(() => {
    // Skip animation if reduced motion is enabled
    if (animationConfig.duration === 0) {
      onAnimationComplete?.();
      return;
    }

    // Shake animation
    const shakeDistance = AnimationValues.slideDistance.small;
    translateX.value = withSequence(
      withTiming(-shakeDistance, { duration: 50 }),
      withTiming(shakeDistance, { duration: 50 }),
      withTiming(-shakeDistance, { duration: 50 }),
      withTiming(0, { duration: 50 }, (finished) => {
        if (finished && onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      })
    );

    // Subtle scale pulse
    scale.value = withSequence(
      withTiming(1.02, { duration: 100 }),
      withTiming(1, { duration: 100 })
    );

    // Brief red background flash
    backgroundColor.value = withSequence(
      withTiming(1, { duration: 100 }),
      withTiming(0, { duration: 200 })
    );
  }, [animationConfig, onAnimationComplete]);

  const playSuccess = React.useCallback(() => {
    // Success animations handled by SuccessAnimation component
  }, []);

  const reset = React.useCallback(() => {
    translateX.value = 0;
    scale.value = 1;
    backgroundColor.value = 0;
  }, []);

  useImperativeHandle(ref, () => ({
    playSuccess,
    playError,
    reset,
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.animatedContainer, animatedStyle]}>
        {children}
      </Animated.View>
    </View>
  );
});

/**
 * Combined Feedback Animation Component
 * Provides both success and error animations in one component
 */
export const FeedbackAnimation = forwardRef<
  FeedbackAnimationRef,
  FeedbackAnimationProps
>(({ children, onAnimationComplete }, ref) => {
  const animationConfig = useAnimationConfig();

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const rotation = useSharedValue(0);
  const backgroundColor = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { rotate: `${rotation.value}deg` },
    ],
    backgroundColor: `rgba(255, 0, 0, ${backgroundColor.value * 0.1})`,
  }));

  const playSuccess = React.useCallback(() => {
    if (animationConfig.duration === 0) {
      onAnimationComplete?.();
      return;
    }

    // Reset any previous animations
    translateX.value = 0;
    backgroundColor.value = 0;

    // Success: bouncy scale + rotation
    scale.value = withSequence(
      withTiming(0.8, { duration: 100 }),
      withSpring(1.2, animationConfig.spring.bouncy),
      withSpring(1, animationConfig.spring.default)
    );

    rotation.value = withTiming(
      360,
      {
        duration: 600,
        easing: animationConfig.easing.standard,
      },
      (finished) => {
        if (finished && onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      }
    );
  }, [animationConfig, onAnimationComplete]);

  const playError = React.useCallback(() => {
    if (animationConfig.duration === 0) {
      onAnimationComplete?.();
      return;
    }

    // Reset any previous animations
    rotation.value = 0;
    scale.value = 1;

    // Error: shake + flash
    const shakeDistance = AnimationValues.slideDistance.small;
    translateX.value = withSequence(
      withTiming(-shakeDistance, { duration: 50 }),
      withTiming(shakeDistance, { duration: 50 }),
      withTiming(-shakeDistance, { duration: 50 }),
      withTiming(0, { duration: 50 }, (finished) => {
        if (finished && onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      })
    );

    backgroundColor.value = withSequence(
      withTiming(1, { duration: 100 }),
      withTiming(0, { duration: 200 })
    );
  }, [animationConfig, onAnimationComplete]);

  const reset = React.useCallback(() => {
    scale.value = 1;
    translateX.value = 0;
    rotation.value = 0;
    backgroundColor.value = 0;
  }, []);

  useImperativeHandle(ref, () => ({
    playSuccess,
    playError,
    reset,
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.animatedContainer, animatedStyle]}>
        {children}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  animatedContainer: {
    flex: 1,
  },
});

SuccessAnimation.displayName = 'SuccessAnimation';
ErrorAnimation.displayName = 'ErrorAnimation';
FeedbackAnimation.displayName = 'FeedbackAnimation';
