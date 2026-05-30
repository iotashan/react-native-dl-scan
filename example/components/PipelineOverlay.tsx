import { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import type { ThemeTokens, Direction } from '../theme/tokens';
import { IconBolt, IconCheck } from '../icons';

export type PipelineMode = 'barcode' | 'ocr';

interface Stage {
  k: string;
  nativeStage: number;
  label: string;
  sub: string;
}

const STAGES_BARCODE: Stage[] = [
  { k: 'cam', nativeStage: 0, label: 'Camera', sub: '1080p @ 30fps' },
  {
    k: 'pd',
    nativeStage: 0,
    label: 'PDF417',
    sub: 'vision-camera-barcode-scanner',
  },
  { k: 'nitro', nativeStage: 0, label: 'Nitro JNI', sub: 'JS ↔ C++ bridge' },
  { k: 'aamva', nativeStage: 0, label: 'AAMVA', sub: 'C++ field resolver' },
];

const STAGES_OCR: Stage[] = [
  {
    k: 'extract',
    nativeStage: 1,
    label: 'Extracting fields',
    sub: 'C++ extract_fields_from_candidates',
  },
  {
    k: 'normalize',
    nativeStage: 2,
    label: 'Normalizing data',
    sub: 'per-field shape gates + tier scoring',
  },
  {
    k: 'card',
    nativeStage: 3,
    label: 'Saving card image',
    sub:
      Platform.OS === 'ios'
        ? 'CIPerspectiveCorrection → JPEG'
        : 'Matrix.setPolyToPoly → JPEG',
  },
  {
    k: 'face',
    nativeStage: 4,
    label: 'Detecting headshot',
    sub:
      Platform.OS === 'ios' ? 'VNDetectFaceRectangles' : 'MLKit FaceDetection',
  },
  {
    k: 'done',
    nativeStage: 5,
    label: 'Result ready',
    sub: 'all fields + images delivered',
  },
];

const MIN_STAGE_DISPLAY_MS = 250;

export interface PipelineOverlayProps {
  mode: PipelineMode;
  t: ThemeTokens;
  direction: Direction;
  pipelineStage?: number;
  onDone: () => void;
}

export function PipelineOverlay({
  mode,
  t,
  direction,
  pipelineStage = 5,
  onDone,
}: PipelineOverlayProps) {
  const stages = mode === 'barcode' ? STAGES_BARCODE : STAGES_OCR;
  const isOcr = mode === 'ocr';

  const [visibleStep, setVisibleStep] = useState(-1);
  const doneRef = useRef(false);

  useEffect(() => {
    if (isOcr) {
      // Real signals: sequence through stages with minimum display time.
      // By the time this overlay mounts, pipelineStage is typically 5
      // (all native steps done). We pace the display so users can read
      // each label — each step is visible for MIN_STAGE_DISPLAY_MS.
      const timeouts: ReturnType<typeof setTimeout>[] = [];
      stages.forEach((s, i) => {
        const delay = 200 + i * MIN_STAGE_DISPLAY_MS;
        timeouts.push(setTimeout(() => setVisibleStep(i), delay));
      });
      const tail = setTimeout(
        () => {
          if (!doneRef.current) {
            doneRef.current = true;
            onDone();
          }
        },
        200 + stages.length * MIN_STAGE_DISPLAY_MS + 400
      );
      timeouts.push(tail);
      return () => timeouts.forEach(clearTimeout);
    } else {
      // Barcode: original fixed-interval animation
      const timeouts: ReturnType<typeof setTimeout>[] = [];
      stages.forEach((_, i) => {
        timeouts.push(setTimeout(() => setVisibleStep(i), 180 * i + 200));
      });
      const tail = setTimeout(
        () => {
          if (!doneRef.current) {
            doneRef.current = true;
            onDone();
          }
        },
        180 * stages.length + 700
      );
      timeouts.push(tail);
      return () => timeouts.forEach(clearTimeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages.length, isOcr]);

  const backdrop =
    direction === 'vellum' ? 'rgba(28,22,14,0.66)' : 'rgba(5,5,8,0.7)';

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        { backgroundColor: backdrop },
      ]}
    >
      <BlurView
        intensity={48}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={[StyleSheet.absoluteFill, styles.blur]}
      />
      <View style={styles.heading}>
        <IconBolt c={t.reticle} />
        <Text
          style={[
            styles.headingText,
            { fontFamily: t.mono, color: 'rgba(255,255,255,0.7)' },
          ]}
        >
          {isOcr ? 'processing' : 'pipeline'}
        </Text>
      </View>
      <View style={styles.stack}>
        {stages.map((s, i) => {
          const nativeDone = isOcr && pipelineStage >= s.nativeStage;
          return (
            <StageRow
              key={s.k}
              label={s.label}
              sub={s.sub}
              index={i}
              on={visibleStep >= i}
              active={visibleStep === i}
              done={nativeDone && visibleStep >= i}
              t={t}
            />
          );
        })}
      </View>
    </View>
  );
}

function StageRow({
  label,
  sub,
  index,
  on,
  active,
  done,
  t,
}: {
  label: string;
  sub: string;
  index: number;
  on: boolean;
  active: boolean;
  done: boolean;
  t: ThemeTokens;
}) {
  const x = useSharedValue(-8);
  const op = useSharedValue(0.45);
  useEffect(() => {
    if (on) {
      x.value = withTiming(0, {
        duration: 350,
        easing: Easing.out(Easing.cubic),
      });
      op.value = withTiming(1, {
        duration: 350,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      x.value = -8;
      op.value = 0.45;
    }
  }, [on, x, op]);
  const rowAnim = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateX: x.value }],
  }));

  const glow = useSharedValue(0);
  useEffect(() => {
    if (active && !done) {
      glow.value = 0;
      glow.value = withRepeat(
        withDelay(
          0,
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      );
    } else {
      cancelAnimation(glow);
      glow.value = 0;
    }
  }, [active, done, glow]);
  const glowAnim = useAnimatedStyle(() => ({
    borderColor:
      active && !done
        ? `rgba(255,255,255,${0.06 + glow.value * 0.08})`
        : 'rgba(255,255,255,0.06)',
  }));

  const color = done ? t.tierCV : t.reticle;

  return (
    <Animated.View style={[styles.row, { borderWidth: 1 }, rowAnim, glowAnim]}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: done
              ? `${t.tierCV}22`
              : on
                ? `${t.reticle}22`
                : 'rgba(255,255,255,0.06)',
          },
        ]}
      >
        {done ? (
          <IconCheck c={t.tierCV} />
        ) : on ? (
          <Spinner color={color} />
        ) : (
          <Text style={styles.badgeText}>{index + 1}</Text>
        )}
      </View>
      <View style={styles.labelCol}>
        <Text style={[styles.label, done && { color: t.tierCV }]}>{label}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
    </Animated.View>
  );
}

function Spinner({ color }: { color: string }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, { duration: 800, easing: Easing.linear }),
      -1,
      false
    );
  }, [spin]);
  const anim = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${spin.value}deg` }],
  }));
  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          borderColor: color,
          borderTopColor: 'transparent',
        },
        anim,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 24,
  },
  blur: { opacity: 0.95 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingText: {
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  stack: { width: '100%', maxWidth: 300, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
  },
  labelCol: { flex: 1 },
  label: { color: '#fff', fontSize: 13, fontWeight: '600' },
  sub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
  spinner: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1.5,
  },
});
