/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo, Vibration, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolateColor,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

// Quality guidance messages as per task specification
const qualityMessages = {
  blur: {
    poor: 'Hold device steady',
    warning: 'Slight movement detected',
    good: 'Image is sharp',
  },
  lighting: {
    poor: 'Find better lighting',
    warning: 'Lighting could be better',
    good: 'Good lighting',
  },
  positioning: {
    too_close: 'Move device farther away',
    too_far: 'Move device closer',
    optimal: 'Good distance',
  },
};

// Helper function to get appropriate quality message
const getQualityMessages = (
  metrics: RealTimeQualityMetrics,
  mode: 'pdf417' | 'ocr'
): string => {
  // Check positioning first as it's most critical
  if (metrics.positioning.status === 'poor') {
    return qualityMessages.positioning[metrics.positioning.distance];
  }

  // Then check blur (camera stability)
  if (metrics.blur.status === 'poor') {
    return qualityMessages.blur.poor;
  }

  // Then check lighting
  if (metrics.lighting.status === 'poor') {
    return qualityMessages.lighting.poor;
  }

  // If only warnings, prioritize based on mode
  if (mode === 'ocr' && metrics.lighting.status === 'warning') {
    return qualityMessages.lighting.warning;
  }

  if (metrics.blur.status === 'warning') {
    return qualityMessages.blur.warning;
  }

  // All good
  if (metrics.overall.readyToScan) {
    return 'Ready to scan';
  }

  return 'Adjust positioning';
};

// Helper function to get color based on status
const getStatusColor = (status: 'good' | 'warning' | 'poor'): string => {
  switch (status) {
    case 'good':
      return '#4CAF50'; // Green
    case 'warning':
      return '#FFD700'; // Gold/Yellow
    case 'poor':
      return '#F44336'; // Red
    default:
      return '#808080'; // Gray
  }
};

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

// Legacy interface for backward compatibility
interface QualityMetrics {
  blur: number; // 0-1, where 1 is very blurry
  lighting: number; // 0-1, where 1 is good lighting
  positioning: number; // 0-1, where 1 is well positioned
  overall: 'good' | 'fair' | 'poor';
}

interface QualityIndicatorProps {
  metrics: QualityMetrics | RealTimeQualityMetrics;
  showDetails?: boolean;
  compact?: boolean;
  mode?: 'pdf417' | 'ocr';
  onDismiss?: () => void;
  enableHapticFeedback?: boolean;
  enableAccessibilityAnnouncements?: boolean;
}

export const QualityIndicator: React.FC<QualityIndicatorProps> = ({
  metrics,
  showDetails = true,
  compact = false,
  mode = 'pdf417',
  onDismiss: _onDismiss,
  enableHapticFeedback = true,
  enableAccessibilityAnnouncements = true,
}) => {
  const animatedProgress = useSharedValue(0);
  const previousStatusRef = useRef<string>('');

  // Helper function to check if metrics is the new interface
  const isRealTimeMetrics = (m: any): m is RealTimeQualityMetrics => {
    return m.blur && typeof m.blur === 'object' && 'value' in m.blur;
  };

  // Calculate overall quality score and status
  let overallScore: number;
  let overallStatus: 'good' | 'warning' | 'poor';
  let readyToScan: boolean;

  if (isRealTimeMetrics(metrics)) {
    overallScore = metrics.overall.score;
    readyToScan = metrics.overall.readyToScan;
    overallStatus =
      overallScore > 0.7 ? 'good' : overallScore > 0.4 ? 'warning' : 'poor';
  } else {
    // Legacy interface conversion
    overallScore =
      (metrics.lighting + metrics.positioning + (1 - metrics.blur)) / 3;
    overallStatus =
      metrics.overall === 'good'
        ? 'good'
        : metrics.overall === 'fair'
          ? 'warning'
          : 'poor';
    readyToScan = overallStatus === 'good';
  }

  // Handle haptic feedback and accessibility announcements
  useEffect(() => {
    const currentStatus = overallStatus;

    if (
      previousStatusRef.current &&
      previousStatusRef.current !== currentStatus
    ) {
      // Provide haptic feedback on status change
      if (enableHapticFeedback && Platform.OS !== 'web') {
        switch (currentStatus) {
          case 'good':
            // Light vibration for success
            Vibration.vibrate(10);
            break;
          case 'warning':
            // Medium vibration for warning
            Vibration.vibrate(20);
            break;
          case 'poor':
            // Stronger vibration for error
            Vibration.vibrate([0, 30, 50, 30]);
            break;
        }
      }

      // Announce status change for accessibility
      if (enableAccessibilityAnnouncements) {
        const message = getQualityMessage();
        AccessibilityInfo.announceForAccessibility(message);
      }
    }

    previousStatusRef.current = currentStatus;
  }, [overallStatus, enableHapticFeedback, enableAccessibilityAnnouncements]);

  useEffect(() => {
    animatedProgress.value = withSpring(overallScore, {
      damping: 15,
      stiffness: 100,
    });
  }, [overallScore, animatedProgress]);

  const containerAnimatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      animatedProgress.value,
      [0, 0.5, 1],
      ['#F44336', '#FFD700', '#4CAF50'] // Red -> Gold -> Green
    );

    return {
      backgroundColor,
    };
  });

  const getQualityIcon = () => {
    switch (overallStatus) {
      case 'good':
        return '✓';
      case 'warning':
        return '⚠';
      case 'poor':
        return '✗';
      default:
        return '?';
    }
  };

  const getQualityMessage = () => {
    if (isRealTimeMetrics(metrics)) {
      return getQualityMessages(metrics, mode);
    } else {
      // Legacy logic
      if (metrics.blur > 0.7) return 'Hold camera steady';
      if (metrics.lighting < 0.3) return 'Improve lighting';
      if (metrics.positioning < 0.5) return 'Center license in frame';
      if (metrics.overall === 'good') return 'Good quality';
      return 'Adjust positioning';
    }
  };

  if (compact) {
    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(300)}
        style={[styles.compactContainer, containerAnimatedStyle]}
      >
        <Text style={styles.compactIcon}>{getQualityIcon()}</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={styles.container}
    >
      <Animated.View style={[styles.header, containerAnimatedStyle]}>
        <Text style={styles.icon}>{getQualityIcon()}</Text>
        <Text style={styles.message}>{getQualityMessage()}</Text>
      </Animated.View>

      {showDetails && (
        <View style={styles.details}>
          {isRealTimeMetrics(metrics) ? (
            <>
              <QualityBar
                label="Sharpness"
                value={1 - metrics.blur.value}
                color={getStatusColor(metrics.blur.status)}
                status={metrics.blur.status}
              />
              <QualityBar
                label="Lighting"
                value={metrics.lighting.brightness}
                color={getStatusColor(metrics.lighting.status)}
                status={metrics.lighting.status}
              />
              <QualityBar
                label="Position"
                value={metrics.positioning.alignment}
                color={getStatusColor(metrics.positioning.status)}
                status={metrics.positioning.status}
              />
            </>
          ) : (
            <>
              <QualityBar
                label="Sharpness"
                value={1 - metrics.blur}
                color={metrics.blur > 0.5 ? '#F44336' : '#4CAF50'}
              />
              <QualityBar
                label="Lighting"
                value={metrics.lighting}
                color={metrics.lighting < 0.5 ? '#F44336' : '#4CAF50'}
              />
              <QualityBar
                label="Position"
                value={metrics.positioning}
                color={metrics.positioning < 0.5 ? '#F44336' : '#4CAF50'}
              />
            </>
          )}
        </View>
      )}
    </Animated.View>
  );
};

interface QualityBarProps {
  label: string;
  value: number;
  color: string;
  status?: 'good' | 'warning' | 'poor';
}

const QualityBar: React.FC<QualityBarProps> = ({
  label,
  value,
  color,
  status,
}) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(value, {
      damping: 20,
      stiffness: 100,
    });
  }, [value, progress]);

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View style={styles.barContainer}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barBackground}>
        <Animated.View
          style={[
            styles.barFill,
            { backgroundColor: color },
            progressAnimatedStyle,
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 12,
    padding: 12,
    minWidth: 200,
  },
  compactContainer: {
    position: 'absolute',
    top: 100,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  icon: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginRight: 8,
  },
  compactIcon: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  message: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    flex: 1,
  },
  details: {
    paddingTop: 4,
  },
  barContainer: {
    marginBottom: 8,
  },
  barLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 4,
  },
  barBackground: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
});
