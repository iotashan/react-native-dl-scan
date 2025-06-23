import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolateColor,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

interface QualityMetrics {
  blur: number; // 0-1, where 1 is very blurry
  lighting: number; // 0-1, where 1 is good lighting
  positioning: number; // 0-1, where 1 is well positioned
  overall: 'good' | 'fair' | 'poor';
}

interface QualityIndicatorProps {
  metrics: QualityMetrics;
  showDetails?: boolean;
  compact?: boolean;
}

export const QualityIndicator: React.FC<QualityIndicatorProps> = ({
  metrics,
  showDetails = true,
  compact = false,
}) => {
  const animatedProgress = useSharedValue(0);

  // Calculate overall quality score
  const overallScore = (metrics.lighting + metrics.positioning + (1 - metrics.blur)) / 3;

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
    switch (metrics.overall) {
      case 'good':
        return '✓';
      case 'fair':
        return '⚠';
      case 'poor':
        return '✗';
      default:
        return '?';
    }
  };

  const getQualityMessage = () => {
    if (metrics.blur > 0.7) return 'Hold camera steady';
    if (metrics.lighting < 0.3) return 'Improve lighting';
    if (metrics.positioning < 0.5) return 'Center license in frame';
    if (metrics.overall === 'good') return 'Good quality';
    return 'Adjust positioning';
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
        </View>
      )}
    </Animated.View>
  );
};

interface QualityBarProps {
  label: string;
  value: number;
  color: string;
}

const QualityBar: React.FC<QualityBarProps> = ({ label, value, color }) => {
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