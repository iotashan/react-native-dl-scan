/* eslint-disable react-hooks/exhaustive-deps */
import React, { useImperativeHandle, forwardRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import {
  useAnimationConfig,
  AnimationTimings,
  useReducedMotion,
} from '../../utils/animations';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface ScanningOverlayAnimationsProps {
  isScanning: boolean;
  onDocumentDetected?: () => void;
  cornerBracketColor?: string;
  scanLineColor?: string;
}

export interface ScanningOverlayAnimationsRef {
  startScanning: () => void;
  stopScanning: () => void;
  showDocumentDetected: () => void;
  updateQualityIndicator: (quality: 'poor' | 'good' | 'excellent') => void;
  reset: () => void;
}

/**
 * Scanning Overlay Animations Component
 * Provides visual feedback during document scanning:
 * - Pulsing scan line for active scanning
 * - Animated corner brackets for document boundaries
 * - Quality indicator transitions
 * - Document detection feedback
 */
const ScanningOverlayAnimations = forwardRef<
  ScanningOverlayAnimationsRef,
  ScanningOverlayAnimationsProps
>(
  (
    {
      isScanning,
      onDocumentDetected,
      cornerBracketColor = '#00FF00',
      scanLineColor = '#FF4444',
    },
    ref
  ) => {
    const animationConfig = useAnimationConfig();
    const reducedMotion = useReducedMotion();

    // Scan line animation
    const scanLinePosition = useSharedValue(0);
    const scanLineOpacity = useSharedValue(0);

    // Corner brackets animation
    const cornerScale = useSharedValue(1);
    const cornerOpacity = useSharedValue(0.7);

    // Quality indicator animation
    const qualityIndicatorScale = useSharedValue(1);
    const qualityIndicatorColor = useSharedValue(0); // 0=poor, 1=good, 2=excellent

    // Document detection animation
    const detectionFlash = useSharedValue(0);
    const detectionScale = useSharedValue(1);

    // Animated styles
    const scanLineAnimatedStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY: interpolate(
            scanLinePosition.value,
            [0, 1],
            [0, screenHeight * 0.6], // Scan within reasonable bounds
            Extrapolate.CLAMP
          ),
        },
      ],
      opacity: scanLineOpacity.value,
    }));

    const cornerBracketAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: cornerScale.value }],
      opacity: cornerOpacity.value,
    }));

    const qualityIndicatorAnimatedStyle = useAnimatedStyle(() => {
      const colors = ['#FF4444', '#FFAA00', '#00FF00']; // poor, good, excellent
      const colorIndex = Math.round(qualityIndicatorColor.value);

      return {
        transform: [{ scale: qualityIndicatorScale.value }],
        backgroundColor: colors[colorIndex] || colors[0],
      };
    });

    const detectionFlashAnimatedStyle = useAnimatedStyle(() => ({
      opacity: detectionFlash.value,
      transform: [{ scale: detectionScale.value }],
    }));

    /**
     * Start scanning animations
     */
    const startScanning = React.useCallback(() => {
      if (reducedMotion) return;

      // Show scan line
      scanLineOpacity.value = withTiming(1, { duration: 200 });

      // Animate corner brackets
      cornerOpacity.value = withTiming(1, { duration: 300 });
      cornerScale.value = withRepeat(
        withSequence(
          withTiming(1.05, { duration: 800 }),
          withTiming(1, { duration: 800 })
        ),
        -1,
        true
      );

      // Start scan line movement
      scanLinePosition.value = withRepeat(
        withTiming(1, {
          duration: 2000,
          easing: animationConfig.easing.linear,
        }),
        -1,
        false
      );
    }, [reducedMotion, animationConfig]);

    /**
     * Stop scanning animations
     */
    const stopScanning = React.useCallback(() => {
      // Hide scan line
      scanLineOpacity.value = withTiming(0, { duration: 200 });
      scanLinePosition.value = 0;

      // Reset corner brackets
      cornerOpacity.value = withTiming(0.7, { duration: 300 });
      cornerScale.value = withTiming(1, { duration: 300 });
    }, []);

    /**
     * Show document detected animation
     */
    const showDocumentDetected = React.useCallback(() => {
      if (reducedMotion) {
        onDocumentDetected?.();
        return;
      }

      // Flash effect
      detectionFlash.value = withSequence(
        withTiming(0.3, { duration: 150 }),
        withTiming(0, { duration: 150 }),
        withTiming(0.2, { duration: 100 }),
        withTiming(0, { duration: 100 })
      );

      // Scale bounce
      detectionScale.value = withSequence(
        withTiming(1.1, {
          duration: 200,
          easing: animationConfig.easing.standard,
        }),
        withTiming(1, {
          duration: 200,
          easing: animationConfig.easing.standard,
        })
      );

      // Brighten corner brackets
      cornerOpacity.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(0.7, { duration: 400 })
      );

      // Callback after animation
      setTimeout(() => {
        onDocumentDetected?.();
      }, 400);
    }, [reducedMotion, animationConfig, onDocumentDetected]);

    /**
     * Update quality indicator
     */
    const updateQualityIndicator = React.useCallback(
      (quality: 'poor' | 'good' | 'excellent') => {
        const qualityMap = { poor: 0, good: 1, excellent: 2 };
        const targetValue = qualityMap[quality];

        qualityIndicatorColor.value = withTiming(targetValue, {
          duration: AnimationTimings.feedback.duration,
        });

        // Pulse animation for quality changes
        qualityIndicatorScale.value = withSequence(
          withTiming(1.2, { duration: 150 }),
          withTiming(1, { duration: 150 })
        );
      },
      []
    );

    /**
     * Reset all animations
     */
    const reset = React.useCallback(() => {
      scanLinePosition.value = 0;
      scanLineOpacity.value = 0;
      cornerScale.value = 1;
      cornerOpacity.value = 0.7;
      qualityIndicatorScale.value = 1;
      qualityIndicatorColor.value = 0;
      detectionFlash.value = 0;
      detectionScale.value = 1;
    }, []);

    // Auto-start/stop based on isScanning prop
    useEffect(() => {
      if (isScanning) {
        startScanning();
      } else {
        stopScanning();
      }
    }, [isScanning, startScanning, stopScanning]);

    useImperativeHandle(ref, () => ({
      startScanning,
      stopScanning,
      showDocumentDetected,
      updateQualityIndicator,
      reset,
    }));

    return (
      <View style={styles.container} pointerEvents="none">
        {/* Document detection flash overlay */}
        <Animated.View
          style={[styles.detectionFlash, detectionFlashAnimatedStyle]}
        />

        {/* Corner brackets */}
        <Animated.View
          style={[styles.cornerBrackets, cornerBracketAnimatedStyle]}
        >
          {/* Top-left corner */}
          <View
            style={[
              styles.corner,
              styles.topLeft,
              { borderColor: cornerBracketColor },
            ]}
          />

          {/* Top-right corner */}
          <View
            style={[
              styles.corner,
              styles.topRight,
              { borderColor: cornerBracketColor },
            ]}
          />

          {/* Bottom-left corner */}
          <View
            style={[
              styles.corner,
              styles.bottomLeft,
              { borderColor: cornerBracketColor },
            ]}
          />

          {/* Bottom-right corner */}
          <View
            style={[
              styles.corner,
              styles.bottomRight,
              { borderColor: cornerBracketColor },
            ]}
          />
        </Animated.View>

        {/* Scan line */}
        <Animated.View
          style={[
            styles.scanLine,
            { backgroundColor: scanLineColor },
            scanLineAnimatedStyle,
          ]}
        />

        {/* Quality indicator */}
        <Animated.View
          style={[styles.qualityIndicator, qualityIndicatorAnimatedStyle]}
        />
      </View>
    );
  }
);

const cornerSize = 20;
const cornerThickness = 3;
const scanAreaMargin = 40;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detectionFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
  },
  cornerBrackets: {
    width: screenWidth - scanAreaMargin * 2,
    height: screenHeight * 0.6,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: cornerSize,
    height: cornerSize,
    borderWidth: cornerThickness,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
  },
  scanLine: {
    position: 'absolute',
    width: screenWidth - scanAreaMargin * 2,
    height: 2,
    top: screenHeight * 0.2, // Starting position
    shadowColor: '#FF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 5,
  },
  qualityIndicator: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
});

ScanningOverlayAnimations.displayName = 'ScanningOverlayAnimations';

export default ScanningOverlayAnimations;
