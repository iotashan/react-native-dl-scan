import React, { useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import type { ScanMode } from '../../types/license';
import { useAnimationConfig, AnimationTimings } from '../../utils/animations';

interface ModeTransitionAnimationProps {
  children: React.ReactNode;
  onTransitionComplete?: (mode: ScanMode) => void;
}

export interface ModeTransitionAnimationRef {
  transitionToMode: (mode: ScanMode) => void;
  getCurrentMode: () => ScanMode | null;
}

const ModeTransitionAnimation = forwardRef<
  ModeTransitionAnimationRef,
  ModeTransitionAnimationProps
>(({ children, onTransitionComplete }, ref) => {
  const animationConfig = useAnimationConfig();

  // Animation shared values
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  // Track current mode
  const currentMode = React.useRef<ScanMode | null>(null);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  /**
   * Smooth transition animation between scanning modes
   * Uses a sequence of out -> in animations for clear visual feedback
   */
  const transitionToMode = React.useCallback(
    (newMode: ScanMode) => {
      const previousMode = currentMode.current;
      currentMode.current = newMode;

      // Skip animation if reduced motion is enabled
      if (animationConfig.duration === 0) {
        onTransitionComplete?.(newMode);
        return;
      }

      // Exit animation - slide up and fade out
      const exitDuration = AnimationTimings.transition.duration / 2;
      const enterDuration = AnimationTimings.transition.duration / 2;

      translateY.value = withSequence(
        // Exit: slide up slightly
        withTiming(-20, {
          duration: exitDuration,
          easing: animationConfig.easing.accelerate,
        }),
        // Enter: slide back to position
        withTiming(0, {
          duration: enterDuration,
          easing: animationConfig.easing.decelerate,
        })
      );

      opacity.value = withSequence(
        // Exit: fade out partially
        withTiming(0.3, {
          duration: exitDuration,
          easing: animationConfig.easing.accelerate,
        }),
        // Enter: fade back in
        withTiming(1, {
          duration: enterDuration,
          easing: animationConfig.easing.decelerate,
        })
      );

      scale.value = withSequence(
        // Exit: scale down slightly
        withTiming(0.95, {
          duration: exitDuration,
          easing: animationConfig.easing.accelerate,
        }),
        // Enter: scale back to normal
        withTiming(
          1,
          {
            duration: enterDuration,
            easing: animationConfig.easing.decelerate,
          },
          (finished) => {
            // Notify completion when animation finishes
            if (finished && onTransitionComplete) {
              runOnJS(onTransitionComplete)(newMode);
            }
          }
        )
      );
    },
    [animationConfig, onTransitionComplete]
  );

  const getCurrentMode = React.useCallback(() => {
    return currentMode.current;
  }, []);

  useImperativeHandle(ref, () => ({
    transitionToMode,
    getCurrentMode,
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

ModeTransitionAnimation.displayName = 'ModeTransitionAnimation';

export default ModeTransitionAnimation;
