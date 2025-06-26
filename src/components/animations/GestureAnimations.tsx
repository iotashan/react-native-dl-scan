/* eslint-disable react-hooks/exhaustive-deps */
import React, { useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  withSpring,
  withDecay,
  runOnJS,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import {
  PanGestureHandler,
  PinchGestureHandler,
  TapGestureHandler,
} from 'react-native-gesture-handler';
import { useAnimationConfig } from '../../utils/animations';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export interface GestureAnimationsProps {
  children: React.ReactNode;
  onZoomChange?: (scale: number) => void;
  onPanChange?: (x: number, y: number) => void;
  onTap?: () => void;
  onDoubleTap?: () => void;
  minZoom?: number;
  maxZoom?: number;
  enablePan?: boolean;
  enableZoom?: boolean;
  enableTap?: boolean;
}

export interface GestureAnimationsRef {
  resetTransform: () => void;
  zoomTo: (scale: number, x?: number, y?: number) => void;
  panTo: (x: number, y: number) => void;
  getCurrentTransform: () => {
    scale: number;
    translateX: number;
    translateY: number;
  };
}

/**
 * Gesture Animations Component
 * Provides smooth gesture-based interactions:
 * - Pinch-to-zoom with momentum
 * - Pan gesture with boundary constraints
 * - Tap and double-tap gestures
 * - Smooth spring animations for gesture completion
 */
export const GestureAnimations = forwardRef<
  GestureAnimationsRef,
  GestureAnimationsProps
>(
  (
    {
      children,
      onZoomChange,
      onPanChange,
      onTap,
      onDoubleTap,
      minZoom = 0.5,
      maxZoom = 3,
      enablePan = true,
      enableZoom = true,
      enableTap = true,
    },
    ref
  ) => {
    const animationConfig = useAnimationConfig();

    // Helper to safely access spring configurations
    const getSpringConfig = (
      type: 'default' | 'gentle' | 'bouncy' = 'default'
    ) => {
      return 'default' in animationConfig.spring
        ? animationConfig.spring[type]
        : animationConfig.spring;
    };

    // Gesture state
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);

    // Pan gesture state
    const panStartX = useSharedValue(0);
    const panStartY = useSharedValue(0);

    // Pinch gesture state
    const pinchScale = useSharedValue(1);
    const pinchStartScale = useSharedValue(1);
    const focalX = useSharedValue(0);
    const focalY = useSharedValue(0);

    // Tap gesture state
    const lastTapTime = useSharedValue(0);

    /**
     * Calculate boundary constraints for panning
     */
    const getConstrainedTranslation = (
      x: number,
      y: number,
      currentScale: number
    ) => {
      'worklet';

      const scaledWidth = screenWidth * currentScale;
      const scaledHeight = screenHeight * currentScale;

      const maxTranslateX = Math.max(0, (scaledWidth - screenWidth) / 2);
      const maxTranslateY = Math.max(0, (scaledHeight - screenHeight) / 2);

      return {
        x: interpolate(
          x,
          [-maxTranslateX, maxTranslateX],
          [-maxTranslateX, maxTranslateX],
          Extrapolate.CLAMP
        ),
        y: interpolate(
          y,
          [-maxTranslateY, maxTranslateY],
          [-maxTranslateY, maxTranslateY],
          Extrapolate.CLAMP
        ),
      };
    };

    /**
     * Pan gesture handler
     */
    const panGestureHandler = useAnimatedGestureHandler({
      onStart: (_, context) => {
        context.startX = translateX.value;
        context.startY = translateY.value;
        panStartX.value = translateX.value;
        panStartY.value = translateY.value;
      },
      onActive: (event, context) => {
        if (!enablePan) return;

        const newX = context.startX + event.translationX;
        const newY = context.startY + event.translationY;

        const constrained = getConstrainedTranslation(newX, newY, scale.value);

        translateX.value = constrained.x;
        translateY.value = constrained.y;

        if (onPanChange) {
          runOnJS(onPanChange)(translateX.value, translateY.value);
        }
      },
      onEnd: (event) => {
        if (!enablePan) return;

        // Add momentum to pan gesture
        translateX.value = withDecay({
          velocity: event.velocityX * 0.5,
          clamp: [
            -Math.max(0, (screenWidth * scale.value - screenWidth) / 2),
            Math.max(0, (screenWidth * scale.value - screenWidth) / 2),
          ],
        });

        translateY.value = withDecay({
          velocity: event.velocityY * 0.5,
          clamp: [
            -Math.max(0, (screenHeight * scale.value - screenHeight) / 2),
            Math.max(0, (screenHeight * scale.value - screenHeight) / 2),
          ],
        });
      },
    });

    /**
     * Pinch gesture handler
     */
    const pinchGestureHandler = useAnimatedGestureHandler({
      onStart: (event, context) => {
        context.startScale = scale.value;
        pinchStartScale.value = scale.value;
        focalX.value = event.focalX;
        focalY.value = event.focalY;
      },
      onActive: (event, context) => {
        if (!enableZoom) return;

        const newScale = interpolate(
          context.startScale * event.scale,
          [minZoom, maxZoom],
          [minZoom, maxZoom],
          Extrapolate.CLAMP
        );

        scale.value = newScale;
        pinchScale.value = newScale;

        // Adjust translation to keep focal point centered
        const deltaScale = newScale - context.startScale;
        const focalPointX = event.focalX - screenWidth / 2;
        const focalPointY = event.focalY - screenHeight / 2;

        const deltaX = focalPointX * deltaScale;
        const deltaY = focalPointY * deltaScale;

        const constrained = getConstrainedTranslation(
          translateX.value - deltaX,
          translateY.value - deltaY,
          newScale
        );

        translateX.value = constrained.x;
        translateY.value = constrained.y;

        if (onZoomChange) {
          runOnJS(onZoomChange)(scale.value);
        }
      },
      onEnd: () => {
        if (!enableZoom) return;

        // Smooth spring animation back to bounds if needed
        if (scale.value < minZoom) {
          scale.value = withSpring(minZoom, getSpringConfig('default'));
          if (onZoomChange) {
            runOnJS(onZoomChange)(minZoom);
          }
        } else if (scale.value > maxZoom) {
          scale.value = withSpring(maxZoom, getSpringConfig('default'));
          if (onZoomChange) {
            runOnJS(onZoomChange)(maxZoom);
          }
        }

        // Ensure translations are within bounds
        const constrained = getConstrainedTranslation(
          translateX.value,
          translateY.value,
          scale.value
        );
        translateX.value = withSpring(
          constrained.x,
          getSpringConfig('default')
        );
        translateY.value = withSpring(
          constrained.y,
          getSpringConfig('default')
        );
      },
    });

    /**
     * Tap gesture handler
     */
    const tapGestureHandler = useAnimatedGestureHandler({
      onStart: () => {
        if (!enableTap) return;

        const now = Date.now();
        const timeDiff = now - lastTapTime.value;

        if (timeDiff < 300) {
          // Double tap detected
          if (onDoubleTap) {
            runOnJS(onDoubleTap)();
          }

          // Reset zoom on double tap
          scale.value = withSpring(1, getSpringConfig('bouncy'));
          translateX.value = withSpring(0, getSpringConfig('bouncy'));
          translateY.value = withSpring(0, getSpringConfig('bouncy'));

          if (onZoomChange) {
            runOnJS(onZoomChange)(1);
          }
          if (onPanChange) {
            runOnJS(onPanChange)(0, 0);
          }
        } else {
          // Single tap
          if (onTap) {
            runOnJS(onTap)();
          }
        }

        lastTapTime.value = now;
      },
    });

    /**
     * Combined animated style
     */
    const animatedStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    }));

    /**
     * Reset transform to initial state
     */
    const resetTransform = React.useCallback(() => {
      scale.value = withSpring(1, getSpringConfig('gentle'));
      translateX.value = withSpring(0, getSpringConfig('gentle'));
      translateY.value = withSpring(0, getSpringConfig('gentle'));

      onZoomChange?.(1);
      onPanChange?.(0, 0);
    }, [animationConfig, onZoomChange, onPanChange]);

    /**
     * Zoom to specific scale and position
     */
    const zoomTo = React.useCallback(
      (targetScale: number, x: number = 0, y: number = 0) => {
        const clampedScale = Math.max(minZoom, Math.min(maxZoom, targetScale));

        scale.value = withSpring(clampedScale, getSpringConfig('default'));

        const constrained = getConstrainedTranslation(x, y, clampedScale);
        translateX.value = withSpring(
          constrained.x,
          getSpringConfig('default')
        );
        translateY.value = withSpring(
          constrained.y,
          getSpringConfig('default')
        );

        onZoomChange?.(clampedScale);
        onPanChange?.(constrained.x, constrained.y);
      },
      [minZoom, maxZoom, animationConfig, onZoomChange, onPanChange]
    );

    /**
     * Pan to specific position
     */
    const panTo = React.useCallback(
      (x: number, y: number) => {
        const constrained = getConstrainedTranslation(x, y, scale.value);

        translateX.value = withSpring(
          constrained.x,
          getSpringConfig('default')
        );
        translateY.value = withSpring(
          constrained.y,
          getSpringConfig('default')
        );

        onPanChange?.(constrained.x, constrained.y);
      },
      [animationConfig, onPanChange]
    );

    /**
     * Get current transform values
     */
    const getCurrentTransform = React.useCallback(() => {
      return {
        scale: scale.value,
        translateX: translateX.value,
        translateY: translateY.value,
      };
    }, []);

    useImperativeHandle(ref, () => ({
      resetTransform,
      zoomTo,
      panTo,
      getCurrentTransform,
    }));

    return (
      <View style={styles.container}>
        <PanGestureHandler
          onGestureEvent={panGestureHandler}
          enabled={enablePan}
          minPointers={1}
          maxPointers={1}
          avgTouches
          simultaneousHandlers={[]}
        >
          <Animated.View style={styles.panContainer}>
            <PinchGestureHandler
              onGestureEvent={pinchGestureHandler}
              enabled={enableZoom}
              simultaneousHandlers={[]}
            >
              <Animated.View style={styles.pinchContainer}>
                <TapGestureHandler
                  onGestureEvent={tapGestureHandler}
                  enabled={enableTap}
                  numberOfTaps={1}
                  maxDelayMs={300}
                >
                  <Animated.View
                    style={[styles.animatedContainer, animatedStyle]}
                  >
                    {children}
                  </Animated.View>
                </TapGestureHandler>
              </Animated.View>
            </PinchGestureHandler>
          </Animated.View>
        </PanGestureHandler>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  panContainer: {
    flex: 1,
  },
  pinchContainer: {
    flex: 1,
  },
  animatedContainer: {
    flex: 1,
  },
});

GestureAnimations.displayName = 'GestureAnimations';

export default GestureAnimations;
