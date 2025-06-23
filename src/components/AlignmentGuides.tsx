import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AlignmentGuidesProps {
  showGrid?: boolean;
  showCenterCross?: boolean;
  showEdgeIndicators?: boolean;
  edgeDetected?: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  animated?: boolean;
  color?: string;
}

export const AlignmentGuides: React.FC<AlignmentGuidesProps> = ({
  showGrid = false,
  showCenterCross = true,
  showEdgeIndicators = true,
  edgeDetected = { top: false, right: false, bottom: false, left: false },
  animated = true,
  color = '#FFD700',
}) => {
  const opacity = useSharedValue(0.3);
  const dashOffset = useSharedValue(0);

  useEffect(() => {
    if (animated) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 1500, easing: Easing.inOut(Easing.ease) })
        ),
        -1
      );

      dashOffset.value = withRepeat(
        withTiming(20, { duration: 1000, easing: Easing.linear }),
        -1
      );
    }
  }, [animated, opacity, dashOffset]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const renderGrid = () => {
    const gridLines = [];
    const gridSize = SCREEN_WIDTH / 12;

    // Vertical lines
    for (let i = 1; i < 12; i++) {
      gridLines.push(
        <AnimatedLine
          key={`v-${i}`}
          x1={i * gridSize}
          y1="0"
          x2={i * gridSize}
          y2="100%"
          stroke={color}
          strokeWidth="0.5"
          strokeDasharray="5,5"
          opacity={animated ? opacity.value : 0.3}
        />
      );
    }

    // Horizontal lines
    for (let i = 1; i < 8; i++) {
      gridLines.push(
        <AnimatedLine
          key={`h-${i}`}
          x1="0"
          y1={i * gridSize * 1.5}
          x2="100%"
          y2={i * gridSize * 1.5}
          stroke={color}
          strokeWidth="0.5"
          strokeDasharray="5,5"
          opacity={animated ? opacity.value : 0.3}
        />
      );
    }

    return gridLines;
  };

  const renderCenterCross = () => (
    <>
      <AnimatedLine
        x1="50%"
        y1="45%"
        x2="50%"
        y2="55%"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        opacity={animated ? opacity.value : 0.5}
      />
      <AnimatedLine
        x1="45%"
        y1="50%"
        x2="55%"
        y2="50%"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        opacity={animated ? opacity.value : 0.5}
      />
    </>
  );

  const renderEdgeIndicator = (edge: 'top' | 'right' | 'bottom' | 'left', detected: boolean) => {
    const indicatorColor = detected ? '#4CAF50' : color;
    const indicatorOpacity = detected ? 0.8 : 0.4;

    const paths = {
      top: 'M 40 20 L 50 10 L 60 20',
      right: 'M 80 40 L 90 50 L 80 60',
      bottom: 'M 40 80 L 50 90 L 60 80',
      left: 'M 20 40 L 10 50 L 20 60',
    };

    return (
      <AnimatedPath
        key={edge}
        d={paths[edge]}
        stroke={indicatorColor}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={animated && !detected ? opacity.value : indicatorOpacity}
      />
    );
  };

  return (
    <Animated.View
      entering={FadeIn.duration(500)}
      exiting={FadeOut.duration(300)}
      style={[styles.container, animated && animatedStyle]}
      pointerEvents="none"
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {showGrid && renderGrid()}
        {showCenterCross && renderCenterCross()}
        {showEdgeIndicators && (
          <>
            {renderEdgeIndicator('top', edgeDetected.top)}
            {renderEdgeIndicator('right', edgeDetected.right)}
            {renderEdgeIndicator('bottom', edgeDetected.bottom)}
            {renderEdgeIndicator('left', edgeDetected.left)}
          </>
        )}
      </Svg>
    </Animated.View>
  );
};

interface GridPatternProps {
  spacing?: number;
  color?: string;
  opacity?: number;
}

export const GridPattern: React.FC<GridPatternProps> = ({
  spacing = 30,
  color = '#FFFFFF',
  opacity = 0.1,
}) => {
  return (
    <View style={[styles.gridContainer, { opacity }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <pattern
            id="grid"
            width={spacing}
            height={spacing}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${spacing} 0 L 0 0 0 ${spacing}`}
              fill="none"
              stroke={color}
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  gridContainer: {
    ...StyleSheet.absoluteFillObject,
  },
});