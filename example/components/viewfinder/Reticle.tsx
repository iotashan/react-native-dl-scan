// Viewfinder reticle — 4 corner brackets + animated scanning sweep
// line (Phase C of task #71).
//
// Lives over the cutout rect. The corner brackets are 4 absolute
// Views with selective borders; the sweep is a Reanimated translateY
// of a glowing horizontal bar between the top and bottom of the cutout
// during the 'scanning' phase. The 'captured' phase swaps the sweep
// for a one-shot success flash via opacity + scale animation.

import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import type { CutoutRect } from './geometry';

export type ScanPhase =
  | 'idle'
  | 'scanning'
  | 'captured'
  | 'pipeline'
  | 'result';

/** Stage descriptor produced by ocrProgressStage() in Viewfinder. */
export interface OcrStage {
  tag: 'idle' | 'searching' | 'detected' | 'reading' | 'locked';
  label: string;
  sub: string;
  fields: number;
}

export interface ReticleProps {
  cutout: CutoutRect;
  /** Color for the brackets + sweep (theme token: t.reticle). */
  color: string;
  /** Color for the successful-capture flash (theme token: t.tierCV). */
  successColor: string;
  phase: ScanPhase;
  /** When true, show FieldLockTally instead of the sweep line. */
  showFieldLock?: boolean;
  /** OCR progress [0,1] — drives the FieldLockTally fill width. */
  ocrProgress?: number;
  /** Computed OCR stage — drives FieldLockTally segment states. */
  ocrStage?: OcrStage | null;
}

const BRACKET_SIZE = 22;
const BRACKET_BORDER = 2.5;
const BRACKET_RADIUS = 14;

/**
 * One corner of the reticle. Renders only the two borders that face
 * outward from that corner, with the appropriate corner-radius set so
 * they form a clean L-shape that meets at the corner.
 */
function Bracket({
  corner,
  cutout,
  color,
}: {
  corner: 'tl' | 'tr' | 'bl' | 'br';
  cutout: CutoutRect;
  color: string;
}) {
  // Offset the bracket by half its border width OUTSIDE the cutout
  // edge so the visible inner edge of the bracket sits flush with the
  // edge of the cutout rectangle. -2 matches the design.
  const offset = -2;
  const style: Record<string, unknown> = {
    position: 'absolute',
    width: BRACKET_SIZE,
    height: BRACKET_SIZE,
    borderColor: color,
  };
  if (corner === 'tl') {
    style.top = cutout.y + offset;
    style.left = cutout.x + offset;
    style.borderTopWidth = BRACKET_BORDER;
    style.borderLeftWidth = BRACKET_BORDER;
    style.borderTopLeftRadius = BRACKET_RADIUS;
  } else if (corner === 'tr') {
    style.top = cutout.y + offset;
    style.left = cutout.x + cutout.w - BRACKET_SIZE - offset;
    style.borderTopWidth = BRACKET_BORDER;
    style.borderRightWidth = BRACKET_BORDER;
    style.borderTopRightRadius = BRACKET_RADIUS;
  } else if (corner === 'bl') {
    style.top = cutout.y + cutout.h - BRACKET_SIZE - offset;
    style.left = cutout.x + offset;
    style.borderBottomWidth = BRACKET_BORDER;
    style.borderLeftWidth = BRACKET_BORDER;
    style.borderBottomLeftRadius = BRACKET_RADIUS;
  } else {
    style.top = cutout.y + cutout.h - BRACKET_SIZE - offset;
    style.left = cutout.x + cutout.w - BRACKET_SIZE - offset;
    style.borderBottomWidth = BRACKET_BORDER;
    style.borderRightWidth = BRACKET_BORDER;
    style.borderBottomRightRadius = BRACKET_RADIUS;
  }
  // RN's box-shadow surface doesn't render glow the way CSS
  // `filter: drop-shadow` does in the design. Approximate by stacking
  // a translucent same-color "halo" View behind the bracket — Phase C
  // omits this for visual simplicity; will revisit if the brackets
  // look flat once the camera preview is wired in (Phase G).
  return <View pointerEvents="none" style={style} />;
}

/**
 * Animated scanning sweep — a thin glowing line that translates from
 * the top of the cutout to the bottom over 1.8s and loops while phase
 * is 'scanning'.
 */
function ScanningSweep({
  cutout,
  color,
}: {
  cutout: CutoutRect;
  color: string;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1, // infinite
      false
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);
  const sweepAnim = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * (cutout.h - 14) + 6 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: cutout.y,
          left: cutout.x + 6,
          width: cutout.w - 12,
          height: 2,
          backgroundColor: color,
          // Approximation of the design's box-shadow glow: an inflated
          // semi-transparent shadow rendered by RN's native shadow*
          // props on iOS and elevation on Android. Won't match CSS
          // box-shadow 1:1 but reads as a glow.
          shadowColor: color,
          shadowOpacity: 0.9,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        },
        sweepAnim,
      ]}
    />
  );
}

/**
 * One-shot success flash when phase transitions to 'captured'.
 * Opacity + scale celebrate animation, 650ms.
 */
function CaptureFlash({
  cutout,
  successColor,
  active,
}: {
  cutout: CutoutRect;
  successColor: string;
  active: boolean;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);
  useEffect(() => {
    if (!active) {
      opacity.value = 0;
      scale.value = 0.96;
      return;
    }
    opacity.value = withSequence(
      withTiming(1, { duration: 230, easing: Easing.out(Easing.cubic) }),
      withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })
    );
    scale.value = withSequence(
      withTiming(1.02, { duration: 230, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 420, easing: Easing.in(Easing.cubic) })
    );
  }, [active, opacity, scale]);
  const flashAnim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: cutout.y,
          left: cutout.x,
          width: cutout.w,
          height: cutout.h,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: successColor,
          backgroundColor: `${successColor}22`,
          shadowColor: successColor,
          shadowOpacity: 0.6,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 0 },
          elevation: 12,
        },
        flashAnim,
      ]}
    />
  );
}

const FIELD_COUNT = 14;
const SEGMENT_GAP = 3;

/**
 * Pulsing segment — the "next" field uses a Reanimated opacity loop
 * to draw the user's eye to the field currently being stabilized.
 */
function PulsingSegment({
  width,
  barColor,
}: {
  width: number;
  barColor: string;
}) {
  const opacity = useSharedValue(0.55);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.55, { duration: 500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const pulseAnim = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      style={[
        {
          width,
          height: 4,
          borderRadius: 2,
          backgroundColor: barColor,
        },
        pulseAnim,
      ]}
    />
  );
}

/**
 * FieldLockTally — 14 horizontal segments at the bottom of the card
 * cutout showing OCR field stabilization progress, plus a thin
 * continuous progress bar below.
 */
function FieldLockTally({
  cutout,
  barColor,
  progress,
  stage,
}: {
  cutout: CutoutRect;
  barColor: string;
  progress: number;
  stage: OcrStage;
}) {
  const totalGap = SEGMENT_GAP * (FIELD_COUNT - 1);
  const availableWidth = cutout.w - 16; // 8px padding each side
  const segW = (availableWidth - totalGap) / FIELD_COUNT;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cutout.x + 8,
        top: cutout.y + cutout.h - 8 - 4 - 6 - 4, // bottom:8, bar height, gap, segments
        width: availableWidth,
      }}
    >
      {/* Segment tally */}
      <View style={{ flexDirection: 'row', gap: SEGMENT_GAP }}>
        {Array.from({ length: FIELD_COUNT }, (_, i) => {
          const filled = i < stage.fields;
          const isNext = i === stage.fields && stage.tag === 'reading';
          if (isNext) {
            return <PulsingSegment key={i} width={segW} barColor={barColor} />;
          }
          return (
            <View
              key={i}
              style={{
                width: segW,
                height: 4,
                borderRadius: 2,
                backgroundColor: filled ? barColor : 'transparent',
                borderWidth: filled ? 0 : StyleSheet.hairlineWidth,
                borderColor: filled ? undefined : 'rgba(255,255,255,0.12)',
                // Glow on filled segments
                ...(filled
                  ? {
                      shadowColor: barColor,
                      shadowOpacity: 0.5,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 3,
                    }
                  : {}),
              }}
            />
          );
        })}
      </View>

    </View>
  );
}

export function Reticle({ cutout, color, successColor, phase, showFieldLock, ocrProgress = 0, ocrStage }: ReticleProps) {
  // When OCR fields are locked, transition brackets to the success color.
  const bracketColor = ocrStage?.tag === 'locked' ? successColor : color;
  // Bar color: green when locked, accent (reticle) during scanning.
  const barColor = ocrStage?.tag === 'locked' ? successColor : color;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Bracket corner="tl" cutout={cutout} color={bracketColor} />
      <Bracket corner="tr" cutout={cutout} color={bracketColor} />
      <Bracket corner="bl" cutout={cutout} color={bracketColor} />
      <Bracket corner="br" cutout={cutout} color={bracketColor} />
      {/* Sweep line only for barcode mode or before OCR progress starts.
       *  Hide when showFieldLock is true (OCR mode with active progress). */}
      {phase === 'scanning' && !showFieldLock && (
        <ScanningSweep cutout={cutout} color={color} />
      )}
      {/* FieldLockTally — 14-segment tally + progress bar during OCR. */}
      {showFieldLock && ocrStage != null && (
        <FieldLockTally
          cutout={cutout}
          barColor={barColor}
          progress={ocrProgress}
          stage={ocrStage}
        />
      )}
      <CaptureFlash
        cutout={cutout}
        successColor={successColor}
        active={phase === 'captured'}
      />
    </View>
  );
}
