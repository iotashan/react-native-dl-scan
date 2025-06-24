import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

interface RealTimeQualityMetrics {
  blur: {
    value: number; // 0-1, lower is better
    status: 'good' | 'warning' | 'poor';
  };
  lighting: {
    brightness: number; // 0-1
    uniformity: number; // 0-1
    status: 'good' | 'warning' | 'poor';
  };
  positioning: {
    documentDetected: boolean;
    alignment: number; // 0-1
    distance: 'too_close' | 'optimal' | 'too_far';
    status: 'good' | 'warning' | 'poor';
  };
  overall: {
    score: number; // 0-1
    readyToScan: boolean;
  };
}

interface GuidanceOverlayProps {
  metrics: RealTimeQualityMetrics;
  mode: 'pdf417' | 'ocr';
  onDismiss?: () => void;
  showDismissButton?: boolean;
  pulseAnimation?: boolean;
}

export const GuidanceOverlay: React.FC<GuidanceOverlayProps> = ({
  metrics,
  mode,
  onDismiss,
  showDismissButton = false,
  pulseAnimation = true,
}) => {
  const pulseScale = useSharedValue(1);
  const opacity = useSharedValue(1);

  // Get primary guidance message
  const getPrimaryGuidance = (): { message: string; priority: 'high' | 'medium' | 'low' } => {
    // Critical positioning issues
    if (!metrics.positioning.documentDetected) {
      return {
        message: mode === 'pdf417' 
          ? 'Position the back of your license in the frame'
          : 'Position the front of your license in the frame',
        priority: 'high'
      };
    }

    if (metrics.positioning.status === 'poor') {
      const distanceMessage = metrics.positioning.distance === 'too_close' 
        ? 'Move device farther away'
        : metrics.positioning.distance === 'too_far'
        ? 'Move device closer'
        : 'Center license in frame';
      return { message: distanceMessage, priority: 'high' };
    }

    // Camera stability issues
    if (metrics.blur.status === 'poor') {
      return { message: 'Hold device steady', priority: 'high' };
    }

    // Lighting issues
    if (metrics.lighting.status === 'poor') {
      return { message: 'Find better lighting', priority: 'medium' };
    }

    // Warning level issues
    if (metrics.blur.status === 'warning') {
      return { message: 'Slight movement detected', priority: 'low' };
    }

    if (metrics.lighting.status === 'warning' && mode === 'ocr') {
      return { message: 'Lighting could be better', priority: 'low' };
    }

    // All good
    if (metrics.overall.readyToScan) {
      return { message: 'Ready to scan', priority: 'low' };
    }

    return { message: 'Adjust positioning', priority: 'medium' };
  };

  const guidance = getPrimaryGuidance();

  // Pulse animation for critical messages
  useEffect(() => {
    if (pulseAnimation && guidance.priority === 'high') {
      pulseScale.value = withSequence(
        withTiming(1.05, { duration: 800 }),
        withTiming(1, { duration: 800 })
      );
    } else {
      pulseScale.value = withSpring(1);
    }
  }, [guidance.priority, pulseAnimation, pulseScale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: opacity.value,
  }));

  const getGuidanceColor = () => {
    switch (guidance.priority) {
      case 'high':
        return '#F44336'; // Red
      case 'medium':
        return '#FFD700'; // Gold
      case 'low':
        return '#4CAF50'; // Green
      default:
        return '#808080'; // Gray
    }
  };

  const getGuidanceIcon = () => {
    if (!metrics.positioning.documentDetected) {
      return '📱';
    }
    
    switch (guidance.priority) {
      case 'high':
        return '⚠️';
      case 'medium':
        return '💡';
      case 'low':
        return metrics.overall.readyToScan ? '✅' : '👌';
      default:
        return '📋';
    }
  };

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={[
        styles.container,
        {
          backgroundColor: `${getGuidanceColor()}15`, // 15% opacity
          borderColor: getGuidanceColor(),
        }
      ]}
    >
      <Animated.View style={[styles.content, animatedStyle]}>
        <Text style={styles.icon}>{getGuidanceIcon()}</Text>
        <Text style={[styles.message, { color: getGuidanceColor() }]}>
          {guidance.message}
        </Text>
        
        {showDismissButton && onDismiss && (
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={onDismiss}
            activeOpacity={0.7}
          >
            <Text style={styles.dismissText}>×</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Additional context for specific situations */}
      {!metrics.positioning.documentDetected && (
        <Text style={styles.subMessage}>
          {mode === 'pdf417' 
            ? 'Look for the barcode on the back'
            : 'Ensure all corners are visible'
          }
        </Text>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    zIndex: 100,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  message: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  dismissButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  subMessage: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 8,
    textAlign: 'center',
  },
});