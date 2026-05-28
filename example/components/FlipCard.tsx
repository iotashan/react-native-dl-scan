// 3D flip-card transition (Phase D of task #71).
//
// Wraps a `front` and `back` face. When `flipped` flips, the wrapper
// rotates 180° around the Y-axis using `perspective` to give a
// physical-feeling depth. Faces use `backfaceVisibility: 'hidden'` so
// only one face shows at a time. Driven by a Reanimated shared value
// for a single composited transform per frame.
//
// review Round 1 note: don't rotate a live native <Camera> view — the
// flip-card here wraps the SHELL containers, not the camera itself.
// In practice the parent uses FlipCard to flip between the viewfinder
// composition (which contains the camera) and the result face. On
// Android-only compositing flicker, the parent can fall back to
// `mode='slide'` which uses a translateX crossfade instead.

import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';

export interface FlipCardProps {
  /** When true, show the back face. */
  flipped: boolean;
  front: React.ReactNode;
  back: React.ReactNode;
  /** 'flip' = 3D rotateY (default). 'slide' = horizontal translate
   *  crossfade — use as the platform fallback if 'flip' flickers. */
  mode?: 'flip' | 'slide';
  /** Animation duration in ms. Default 900ms matches the design's
   *  cubic-bezier(.7,.05,.3,1) feel at 0.9s. */
  duration?: number;
  /** Perspective depth — larger = flatter rotation. Default 1400 from
   *  the design. */
  perspective?: number;
}

export function FlipCard({
  flipped,
  front,
  back,
  mode = 'flip',
  duration = 900,
  perspective = 1400,
}: FlipCardProps) {
  // 0 = front face up, 1 = back face up. Reanimated drives both faces
  // off the same shared value so they stay perfectly in sync.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(flipped ? 1 : 0, {
      duration,
      easing: Easing.bezier(0.7, 0.05, 0.3, 1),
    });
  }, [flipped, duration, progress]);

  // Front face: rotates 0° → -180°. Back face: rotates +180° → 0°.
  // Both anchored via `backfaceVisibility: 'hidden'` so the off-side
  // disappears at 90°.
  const frontAnim = useAnimatedStyle(() => {
    if (mode === 'slide') {
      return {
        opacity: 1 - progress.value,
        transform: [{ translateX: -progress.value * 60 }],
      };
    }
    const rot = interpolate(progress.value, [0, 1], [0, -180]);
    return {
      transform: [{ perspective }, { rotateY: `${rot}deg` }],
    };
  });
  const backAnim = useAnimatedStyle(() => {
    if (mode === 'slide') {
      return {
        opacity: progress.value,
        transform: [{ translateX: (1 - progress.value) * 60 }],
      };
    }
    const rot = interpolate(progress.value, [0, 1], [180, 0]);
    return {
      transform: [{ perspective }, { rotateY: `${rot}deg` }],
    };
  });

  // review P3 (Phase F-G review): in `slide` mode both faces remain
  // mounted at full size; the off-axis face would otherwise intercept
  // touches through transparent regions. Gate pointerEvents on the
  // current `flipped` state — only the visible face accepts input.
  // The `flip` mode is mostly safe because backfaceVisibility:'hidden'
  // hides the back, but we apply the same gate for consistency.
  return (
    <View style={styles.host}>
      <Animated.View
        pointerEvents={flipped ? 'none' : 'auto'}
        style={[styles.face, styles.front, frontAnim]}
      >
        {front}
      </Animated.View>
      <Animated.View
        pointerEvents={flipped ? 'auto' : 'none'}
        style={[styles.face, styles.back, backAnim]}
      >
        {back}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, position: 'relative' },
  face: {
    ...StyleSheet.absoluteFillObject,
    backfaceVisibility: 'hidden',
  },
  front: {},
  back: {},
});
