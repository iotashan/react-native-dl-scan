import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  interpolate,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import type { ScanMode } from '../types/license';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// License card dimensions (3.375" × 2.125" = 1.588:1 ratio)
const LICENSE_ASPECT_RATIO = 1.588;
const FRAME_WIDTH = SCREEN_WIDTH * 0.85;
const FRAME_HEIGHT = FRAME_WIDTH / LICENSE_ASPECT_RATIO;
const SAFE_MARGIN = SCREEN_WIDTH * 0.1;

// Barcode zone dimensions (bottom 30% of card)
const BARCODE_HEIGHT_RATIO = 0.3;
const BARCODE_FRAME_HEIGHT = FRAME_HEIGHT * BARCODE_HEIGHT_RATIO;

export interface ScanningOverlayProps {
  mode: ScanMode;
  isScanning: boolean;
  detectionState: 'idle' | 'detecting' | 'success' | 'error';
  orientation: 'portrait' | 'landscape';
  onOverlayPress?: () => void;
  showGuides?: boolean;
  instructionText?: string;
  animateSuccess?: boolean;
  animateError?: boolean;
}

export const ScanningOverlay: React.FC<ScanningOverlayProps> = ({
  mode,
  isScanning,
  detectionState,
  orientation,
  onOverlayPress,
  showGuides = true,
  instructionText,
  animateSuccess = true,
  animateError = true,
}) => {
  // Animation values
  const pulseOpacity = useSharedValue(0.5);
  const sweepPosition = useSharedValue(0);
  const cornerScale = useSharedValue(1);
  const frameScale = useSharedValue(1);
  const successScale = useSharedValue(0);
  const errorShake = useSharedValue(0);

  // Pulse animation for scanning state
  useEffect(() => {
    if (isScanning) {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.8, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1
      );
    } else {
      pulseOpacity.value = withTiming(0.5, { duration: 300 });
    }
  }, [isScanning, pulseOpacity]);

  // Sweep line animation for barcode mode
  useEffect(() => {
    if (mode === 'barcode' && isScanning) {
      sweepPosition.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.linear }),
        -1
      );
    } else {
      sweepPosition.value = 0;
    }
  }, [mode, isScanning, sweepPosition]);

  // Detection state animations
  useEffect(() => {
    switch (detectionState) {
      case 'detecting':
        cornerScale.value = withRepeat(
          withSequence(
            withSpring(1.1, { damping: 15, stiffness: 200 }),
            withSpring(1, { damping: 15, stiffness: 200 })
          ),
          -1
        );
        break;
      case 'success':
        if (animateSuccess) {
          frameScale.value = withSequence(
            withSpring(1.05, { damping: 10, stiffness: 300 }),
            withSpring(1, { damping: 10, stiffness: 300 })
          );
          successScale.value = withSequence(
            withSpring(1.2, { damping: 10, stiffness: 300 }),
            withTiming(0, { duration: 500, easing: Easing.out(Easing.ease) })
          );
        }
        AccessibilityInfo.announceForAccessibility('License detected successfully');
        break;
      case 'error':
        if (animateError) {
          errorShake.value = withSequence(
            withTiming(10, { duration: 50 }),
            withTiming(-10, { duration: 100 }),
            withTiming(10, { duration: 100 }),
            withTiming(0, { duration: 50 })
          );
        }
        AccessibilityInfo.announceForAccessibility('Detection error, please try again');
        break;
      default:
        cornerScale.value = withTiming(1, { duration: 300 });
        frameScale.value = withTiming(1, { duration: 300 });
        break;
    }
  }, [detectionState, cornerScale, frameScale, successScale, errorShake, animateSuccess, animateError]);

  // Calculate frame dimensions based on orientation
  const frameWidth = orientation === 'portrait' ? FRAME_WIDTH : FRAME_HEIGHT;
  const frameHeight = orientation === 'portrait' ? FRAME_HEIGHT : FRAME_WIDTH;

  // Get frame style based on mode
  const getFrameStyle = () => {
    switch (mode) {
      case 'barcode':
        return {
          width: frameWidth,
          height: BARCODE_FRAME_HEIGHT,
          marginBottom: frameHeight - BARCODE_FRAME_HEIGHT,
        };
      case 'ocr':
      case 'auto':
      default:
        return {
          width: frameWidth,
          height: frameHeight,
        };
    }
  };

  // Animated styles
  const frameAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: frameScale.value },
      { translateX: errorShake.value },
    ],
  }));

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const sweepAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          sweepPosition.value,
          [0, 1],
          [0, BARCODE_FRAME_HEIGHT - 2]
        ),
      },
    ],
  }));

  const cornerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cornerScale.value }],
  }));

  const successAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: successScale.value,
  }));

  // Get color based on detection state
  const getOverlayColor = () => {
    switch (detectionState) {
      case 'detecting':
        return '#FFD700'; // Gold
      case 'success':
        return '#4CAF50'; // Green
      case 'error':
        return '#F44336'; // Red
      default:
        return '#FFFFFF'; // White
    }
  };

  const overlayColor = getOverlayColor();

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Dark overlay with cutout */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop} />
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={[styles.cutout, getFrameStyle()]} />
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom} />
      </View>

      {/* Scanning frame */}
      <Animated.View
        style={[
          styles.frameContainer,
          getFrameStyle(),
          frameAnimatedStyle,
        ]}
        pointerEvents="none"
      >
        {/* Corner guides */}
        {showGuides && (
          <>
            <Animated.View
              style={[
                styles.corner,
                styles.cornerTopLeft,
                { borderColor: overlayColor },
                cornerAnimatedStyle,
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerTopRight,
                { borderColor: overlayColor },
                cornerAnimatedStyle,
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerBottomLeft,
                { borderColor: overlayColor },
                cornerAnimatedStyle,
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerBottomRight,
                { borderColor: overlayColor },
                cornerAnimatedStyle,
              ]}
            />
          </>
        )}

        {/* Pulse effect */}
        {isScanning && (
          <Animated.View
            style={[
              styles.pulseFrame,
              { borderColor: overlayColor },
              pulseAnimatedStyle,
            ]}
          />
        )}

        {/* Sweep line for barcode mode */}
        {mode === 'barcode' && isScanning && (
          <Animated.View
            style={[
              styles.sweepLine,
              { backgroundColor: overlayColor },
              sweepAnimatedStyle,
            ]}
          />
        )}

        {/* Success indicator */}
        {detectionState === 'success' && animateSuccess && (
          <Animated.View
            style={[styles.successIndicator, successAnimatedStyle]}
          >
            <View style={styles.successCheckmark}>
              <Text style={styles.successText}>✓</Text>
            </View>
          </Animated.View>
        )}
      </Animated.View>

      {/* Instruction text */}
      {instructionText && (
        <Animated.View
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(300)}
          style={styles.instructionContainer}
        >
          <Text style={styles.instructionText}>{instructionText}</Text>
        </Animated.View>
      )}

      {/* Mode-specific hints */}
      {mode === 'barcode' && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>
            Position the barcode on the back of your license
          </Text>
        </View>
      )}
      {mode === 'ocr' && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>
            Position the front of your license within the frame
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: FRAME_HEIGHT,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  cutout: {
    backgroundColor: 'transparent',
  },
  frameContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderWidth: 3,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 8,
  },
  pulseFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderRadius: 12,
  },
  sweepLine: {
    position: 'absolute',
    width: '90%',
    height: 2,
    opacity: 0.8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 5,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  successIndicator: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successCheckmark: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  successText: {
    color: 'white',
    fontSize: 40,
    fontWeight: 'bold',
  },
  instructionContainer: {
    position: 'absolute',
    bottom: SAFE_MARGIN + 100,
    paddingHorizontal: 40,
  },
  instructionText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  hintContainer: {
    position: 'absolute',
    top: SAFE_MARGIN + 50,
    paddingHorizontal: 40,
  },
  hintText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});