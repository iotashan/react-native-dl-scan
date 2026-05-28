// Mode flip-card toggle — sliding pill thumb + Barcode/OCR options
// (Phase F-G of task #71; compact variant added Phase H Wave 2A).
//
// Animated thumb position via Reanimated. The thumb is a single View
// at the height of the row and ~50% of the width, translating between
// 0% (Barcode) and 50%+1 (OCR) using `withTiming`.
//
// `compact` (Phase H Wave 2A):
//   - Stacks icon over label (column layout per button) instead of
//     icon-row-label
//   - Drops the secondary subtitle line
//   - Smaller font sizes, tighter padding
//   - Used by the phone-landscape rail (narrow) and the tablet shell's
//     left column header (vertical density helps the eye scan).
//
// The thumb math stays percentage-based (not measured via onLayout),
// so toggling `compact` doesn't require any remeasure — the thumb's
// width tracks the container's flex layout automatically.

import { useEffect } from 'react';
import { View, Pressable, Text, StyleSheet, Platform } from 'react-native';

const OCR_BACKEND = Platform.OS === 'ios' ? 'VisionKit text' : 'MLKit text';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { ThemeTokens, Direction } from '../theme/tokens';
import { IconBarcode, IconCard } from '../icons';

export function ModeFlip({
  mode,
  onChange,
  t,
  direction,
  dim = false,
  compact = false,
}: {
  mode: 'barcode' | 'ocr';
  onChange: (m: 'barcode' | 'ocr') => void;
  t: ThemeTokens;
  direction: Direction;
  /** When true (result phase) reduce opacity + disable touch. */
  dim?: boolean;
  /** Compact variant: stacked icon-over-label, no subtitle, smaller
   *  font + padding. Used by phone-landscape rail and tablet shell. */
  compact?: boolean;
}) {
  const isBarcode = mode === 'barcode';
  const slide = useSharedValue(isBarcode ? 0 : 1);
  useEffect(() => {
    slide.value = withTiming(isBarcode ? 0 : 1, {
      duration: 550,
      easing: Easing.bezier(0.65, 0.05, 0.36, 1),
    });
  }, [isBarcode, slide]);
  const thumbAnim = useAnimatedStyle(() => ({
    left: `${slide.value * 50 + (slide.value === 0 ? 0 : 1) / 100}%`,
  }));

  // Compact label set drops the sub-label entirely. The primary label
  // shrinks ("Back · PDF417" → "Back / PDF417") so it still fits in
  // a single line under the icon at narrower widths.
  const options = compact
    ? [
        {
          k: 'barcode' as const,
          label: 'Back',
          sub: 'PDF417',
          Icon: IconBarcode,
        },
        {
          k: 'ocr' as const,
          label: 'Front',
          sub: 'OCR',
          Icon: IconCard,
        },
      ]
    : [
        {
          k: 'barcode' as const,
          label: 'Back · PDF417',
          sub: '1D/2D barcode',
          Icon: IconBarcode,
        },
        {
          k: 'ocr' as const,
          label: 'Front · OCR',
          sub: OCR_BACKEND,
          Icon: IconCard,
        },
      ];

  return (
    <View
      pointerEvents={dim ? 'none' : 'auto'}
      style={[
        styles.host,
        compact && styles.hostCompact,
        {
          backgroundColor: direction === 'lumen' ? t.surface : t.surface2,
          borderColor: t.hairline,
          opacity: dim ? 0.5 : 1,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          compact && styles.thumbCompact,
          {
            backgroundColor: t.surface,
            borderColor: t.hairline,
            shadowColor: '#000',
            shadowOpacity: direction === 'onyx' ? 0.3 : 0.1,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
          },
          thumbAnim,
        ]}
      />
      {options.map((o) => {
        const on = mode === o.k;
        return (
          <Pressable
            key={o.k}
            onPress={() => onChange(o.k)}
            style={[styles.btn, compact && styles.btnCompact]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${o.label} mode`}
          >
            <View
              style={[
                styles.iconWrap,
                compact && styles.iconWrapCompact,
                {
                  backgroundColor: on ? t.accentSoft : 'transparent',
                },
              ]}
            >
              <o.Icon c={on ? t.accent : t.ink2} />
            </View>
            <View style={[styles.labelCol, compact && styles.labelColCompact]}>
              <Text
                style={[
                  styles.label,
                  compact && styles.labelCompact,
                  { color: on ? t.ink : t.ink2 },
                ]}
                numberOfLines={1}
              >
                {o.label}
              </Text>
              {/* Compact mode shows the short sub label below; the
               *  default mode shows the longer descriptive sub. */}
              <Text
                style={[
                  styles.sub,
                  compact && styles.subCompact,
                  { fontFamily: t.mono, color: t.ink3 },
                ]}
                numberOfLines={1}
              >
                {o.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
    overflow: 'hidden',
  },
  hostCompact: {
    gap: 4,
    padding: 3,
    borderRadius: 12,
  },
  thumb: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: '49%',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbCompact: {
    top: 3,
    bottom: 3,
    // Slightly narrower thumb (49% → 48.5%) to give a hair more
    // breathing room around the centered icon+label column on the
    // narrow rail. Reanimated `left` still drives motion.
    width: '48.5%',
    borderRadius: 9,
  },
  btn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  btnCompact: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'column',
    gap: 4,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapCompact: {
    width: 26,
    height: 26,
    borderRadius: 7,
  },
  labelCol: { flex: 1, minWidth: 0 },
  labelColCompact: {
    flex: 0,
    alignItems: 'center',
  },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: -0.13 },
  labelCompact: {
    fontSize: 11.5,
    letterSpacing: -0.1,
    lineHeight: 13,
  },
  sub: {
    fontSize: 10.5,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  subCompact: {
    fontSize: 9,
    letterSpacing: 0.6,
    lineHeight: 11,
  },
});
