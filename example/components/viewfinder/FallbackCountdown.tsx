// Auto-fallback countdown ring (Phase C of task #71).
//
// Renders a small circular progress ring with the remaining seconds in
// the center. Drops into the top-right of the viewfinder when auto-
// fallback is enabled (tw.autoFallback) and we're in barcode mode
// mid-scan. The ring turns red and pulses in the final 5 seconds to
// signal imminent mode-flip.
//
// The ring itself is SVG (deterministic stroke-dasharray math); the
// pulse uses Reanimated.

import { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import type { ThemeTokens } from '../../theme/tokens';

export interface FallbackCountdownProps {
  /** Seconds left before the auto-fallback fires. App-level timer
   *  owns the decrement; this component just draws what it's given. */
  remaining: number;
  /** Total seconds the countdown started at — used to compute the
   *  progress fraction. */
  total: number;
  /** Right offset in pixels — lets the parent place this clear of
   *  other chrome (e.g. the source-status pill at top-left). */
  right?: number;
  /** Top offset in pixels. */
  top?: number;
  t: ThemeTokens;
}

const URGENT_THRESHOLD = 5;
const SIZE = 36;
const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const STROKE = 2.4;
const URGENT_COLOR = '#ff6b6b';

export function FallbackCountdown({
  remaining,
  total,
  right = 80,
  top = 14,
  t,
}: FallbackCountdownProps) {
  const urgent = remaining <= URGENT_THRESHOLD;
  const color = urgent ? URGENT_COLOR : t.reticle;

  // Pulse the WHOLE ring (alpha + slight scale) when urgent. The pulse
  // keyframes from the design map to scale 1.0 → 0.78 + opacity 1 → 0.5
  // at 50% of the cycle, returning at 100% — a 800ms loop.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!urgent) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
      -1, // infinite
      true // reverse so 1 → 0 plays as the back-half of the breath
    );
    return () => cancelAnimation(pulse);
  }, [urgent, pulse]);
  const pulseAnim = useAnimatedStyle(() => {
    // pulse.value goes 0 → 1 → 0 each cycle. Map to scale 1 → 0.78
    // and opacity 1 → 0.5 (50% of the design's scale travel applied
    // at each end of the breath; back-half of the symmetric reverse
    // handles the return).
    const s = 1 - pulse.value * 0.22;
    const o = 1 - pulse.value * 0.5;
    return { transform: [{ scale: s }], opacity: o };
  });

  // Stroke offset = (1 - fraction) × circumference. fraction = remaining / total.
  // Clamped because remaining can briefly overshoot due to the animation frame
  // racing the timer decrement.
  const fraction = Math.max(0, Math.min(1, remaining / Math.max(1, total)));
  const offset = CIRCUMFERENCE * (1 - fraction);
  // Phase C review review: clamp displayed seconds too. The progress
  // fraction was clamped (above), but Math.ceil() of a negative
  // `remaining` produces 0 or -0 only by coincidence; explicit max(0)
  // is safer if the timer briefly reports a negative.
  const seconds = Math.max(0, Math.ceil(remaining));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top,
          right,
          width: SIZE,
          height: SIZE,
        },
        pulseAnim,
      ]}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track ring — translucent dark pill mimicking the design's
         *  rgba(10,10,14,0.55) chrome backdrop with a faint inner
         *  border. */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="rgba(10,10,14,0.55)"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
        />
        {/* Progress arc — rotated -90° so 12-o'clock is the start. */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE},${CIRCUMFERENCE}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: t.mono,
            fontSize: 11,
            fontWeight: '700',
            color: urgent ? URGENT_COLOR : '#ffffff',
            fontVariant: ['tabular-nums'],
            letterSpacing: -0.2,
          }}
        >
          {seconds}
        </Text>
      </View>
    </Animated.View>
  );
}
