// Result view — design-aligned rewrite (Phase F of task #71).
//
// Composes: LicenseHero (silhouette card mimicking a real DL) +
// ConfidenceRail (tier distribution + mean score) + scrolling
// FieldChip grid + footer actions (Scan-again primary, Debug
// secondary). The dropped-field treatment is derived in the UI from
// `minTier`, never by mutating `dataConfidence` (Phase B review
// guidance).
//
// All three inner components (LicenseHero, ConfidenceRail, FieldChip)
// are co-located in this file to keep the result-screen related code
// in one place. They aren't exported individually — there's no
// reuse case outside ResultView.

import { useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';

const OCR_LABEL = Platform.OS === 'ios' ? 'VisionKit' : 'MLKit';
import { LinearGradient } from 'expo-linear-gradient';
import type {
  LicenseData,
  ConfidenceEntry,
  OcrObservation,
} from 'react-native-dl-scan';
import { formatTypedValue } from 'react-native-dl-scan';
import {
  TIER_LABEL,
  TIER_RANK,
  tierColor,
  type ThemeTokens,
  type Direction,
  type ConfidenceTier,
} from '../theme/tokens';
import { IconCheck, IconBeaker, IconChevronRight } from '../icons';

export type ResultMode = 'barcode' | 'ocr';

export interface ResultViewProps {
  data: LicenseData;
  mode: ResultMode;
  t: ThemeTokens;
  direction: Direction;
  /** Drop fields whose tier rank is below this. UI-only. */
  minTier: ConfidenceTier;
  onScanAgain: () => void;
  onShowDebug: () => void;
  /** When true, suppress the footer actions (e.g. iPad host renders
   *  its own action bar). */
  hideActions?: boolean;
}

interface FieldDef {
  k: keyof LicenseData;
  label: string;
  span: 1 | 2;
}

// Required fields — always rendered in this order. Missing values get a
// "Not detected" placeholder so the user knows the scanner tried and
// failed (rather than wondering if the field was skipped). Address is
// broken into its constituent parts so each one gets its own
// detection-status chip.
const REQUIRED_FIELDS: FieldDef[] = [
  { k: 'firstName', label: 'First', span: 1 },
  { k: 'middleName', label: 'Middle', span: 1 },
  { k: 'lastName', label: 'Last', span: 1 },
  { k: 'street', label: 'Street', span: 2 },
  { k: 'city', label: 'City', span: 1 },
  { k: 'state', label: 'State', span: 1 },
  { k: 'postalCode', label: 'ZIP', span: 1 },
  { k: 'sex', label: 'Sex', span: 1 },
  { k: 'eyeColor', label: 'Eyes', span: 1 },
  { k: 'hairColor', label: 'Hair', span: 1 },
  { k: 'height', label: 'Height', span: 1 },
  { k: 'vehicleClass', label: 'Class', span: 1 },
  { k: 'expirationDate', label: 'Expires', span: 1 },
  { k: 'issueDate', label: 'Issued', span: 1 },
];

// Extra fields — rendered after REQUIRED_FIELDS, but only if a value
// was actually extracted (no "Not detected" for these).
const ADDITIONAL_FIELDS: FieldDef[] = [
  { k: 'dateOfBirth', label: 'DOB', span: 1 },
  { k: 'weight', label: 'Weight', span: 1 },
  { k: 'licenseNumber', label: 'License №', span: 2 },
  { k: 'restrictions', label: 'Restr.', span: 1 },
  { k: 'country', label: 'Country', span: 1 },
];

const DROP_COLOR = '#ef4444';

// The typed value-set fields (task #52) — their values are
// `{ code } | { code: 'other', raw }` unions rather than plain strings.
const TYPED_VALUE_FIELDS = new Set<keyof LicenseData>([
  'sex',
  'eyeColor',
  'hairColor',
]);

// Render any LicenseData field for display. Plain string fields pass through;
// the typed value-set fields format to their code, or "Other (raw)" so the
// off-spec value the card carried is still visible to the user.
function displayField(data: LicenseData, k: keyof LicenseData): string | null {
  const v = data[k];
  if (v == null) return null;
  if (TYPED_VALUE_FIELDS.has(k)) {
    const tv = v as Parameters<typeof formatTypedValue>[0];
    if (tv != null && typeof tv === 'object' && 'code' in tv) {
      // 'raw' is present only on the 'other' branch — show the original card
      // value so an off-spec value is never silently hidden.
      return 'raw' in tv ? `Other (${tv.raw})` : tv.code;
    }
  }
  return typeof v === 'string' ? v : String(v);
}

export function ResultView({
  data,
  mode,
  t,
  direction,
  minTier,
  onScanAgain,
  onShowDebug,
  hideActions = false,
}: ResultViewProps) {
  const conf = (data.dataConfidence ?? {}) as Record<string, ConfidenceEntry>;
  const minRank = TIER_RANK[minTier];

  return (
    <View style={styles.host}>
      <LicenseHero data={data} t={t} direction={direction} mode={mode} />
      <ConfidenceRail conf={conf} t={t} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel t={t}>All fields</SectionLabel>
        <View style={styles.grid}>
          {REQUIRED_FIELDS.map((f) => {
            const value = displayField(data, f.k);
            const c = conf[f.k as string] ?? null;
            const belowMin = c != null && TIER_RANK[c.tier] < minRank;
            return (
              <FieldChip
                key={String(f.k)}
                label={f.label}
                value={value}
                conf={c}
                belowMin={belowMin}
                span={f.span}
                t={t}
              />
            );
          })}
          {ADDITIONAL_FIELDS.map((f) => {
            const value = displayField(data, f.k as keyof LicenseData);
            if (value == null || value === '') return null;
            const c = conf[f.k as string] ?? null;
            const belowMin = c != null && TIER_RANK[c.tier] < minRank;
            return (
              <FieldChip
                key={String(f.k)}
                label={f.label}
                value={value}
                conf={c}
                belowMin={belowMin}
                span={f.span}
                t={t}
              />
            );
          })}
        </View>

        {data.cardImagePath != null && (
          <ScannedCardSection
            // Keyed by path so the toggle/measure state resets per new scan.
            key={data.cardImagePath}
            uri={data.cardImagePath}
            observations={data.ocrObservations ?? []}
            t={t}
          />
        )}
      </ScrollView>

      {!hideActions && (
        <View
          style={[
            styles.footer,
            {
              backgroundColor:
                direction === 'lumen' ? 'transparent' : t.surface,
              borderTopColor: t.hairline,
            },
          ]}
        >
          <Pressable
            onPress={onShowDebug}
            accessibilityLabel="Open debug drawer"
            style={[
              styles.debugBtn,
              { backgroundColor: t.surface2, borderColor: t.ink4 },
            ]}
          >
            <IconBeaker c={t.ink2} />
          </Pressable>
          <Pressable
            onPress={onScanAgain}
            style={[
              styles.scanAgainBtn,
              { backgroundColor: t.ink },
              direction === 'lumen' && styles.scanAgainBtnGlow,
            ]}
          >
            <Text style={[styles.scanAgainLabel, { color: t.bg }]}>
              Scan next license
            </Text>
            <IconChevronRight c={t.bg} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── License hero card ─────────────────────────────────────────────────────

function LicenseHero({
  data,
  t,
  direction,
  mode,
}: {
  data: LicenseData;
  t: ThemeTokens;
  direction: Direction;
  mode: ResultMode;
}) {
  // Parse the design's CSS gradient string into expo-linear-gradient
  // stops. For Phase F we keep this lightweight — Lumen uses a 3-color
  // diagonal gradient; the other directions use a 2-color 160deg
  // gradient. Hardcoding the resolved stops per direction is simpler
  // than running a CSS parser at runtime.
  const gradient = pickGradient(direction, t);
  const isOnyx = direction === 'onyx';
  // Card sizing, per design review on real devices:
  //   Phone (narrow column): full width, height hugs the content rows.
  //   Tablet (wide column): keep a REAL card's CR-80 aspect (1.586:1) but
  //   size it to the content — measure the content-driven height ONCE (at
  //   the initial maxWidth) and latch width = height x 1.586. The latch is
  //   deliberate: re-measuring after the resize oscillates (narrower card ->
  //   text wraps -> taller content -> wider card -> un-wraps -> ...), which
  //   showed up on the iPad as the card pulsing between wide and card-ratio.
  //   The latch re-arms only when the scanned data changes.
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 700;
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [measuredFor, setMeasuredFor] = useState<LicenseData | null>(null);
  if (measuredFor !== data) {
    // Render-phase reset (the React-sanctioned alternative to a
    // derived-state effect): new result -> re-measure once.
    setMeasuredFor(data);
    setCardHeight(null);
  }
  const cardWidth =
    wide && cardHeight != null ? Math.round(cardHeight * 1.586) : null;
  return (
    <View style={styles.heroWrap}>
      <View
        onLayout={
          wide
            ? (e) => {
                const h = e.nativeEvent.layout.height;
                // Latch: only the FIRST measurement (full-width layout)
                // drives the card-ratio width; see comment above.
                setCardHeight((prev) => (prev != null ? prev : h));
              }
            : undefined
        }
        style={[
          styles.heroCard,
          cardWidth != null ? { width: cardWidth } : null,
          {
            borderColor: t.hairline,
            shadowColor: '#000',
            shadowOpacity: isOnyx ? 0.4 : 0.12,
            shadowRadius: isOnyx ? 36 : 30,
            shadowOffset: { width: 0, height: isOnyx ? 18 : 12 },
            elevation: 8,
          },
        ]}
      >
        <LinearGradient
          colors={gradient.colors}
          locations={gradient.locations}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFill}
        />
        {/* Header strip */}
        <View style={styles.heroHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[
                styles.heroEyebrow,
                {
                  fontFamily: t.mono,
                  color: isOnyx ? 'rgba(255,255,255,0.55)' : t.ink3,
                },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {(data.state ?? 'OR') + ' · Driver License'}
            </Text>
            <Text
              style={[
                styles.heroName,
                {
                  fontFamily: t.display,
                  color: isOnyx ? '#fff' : t.ink,
                },
              ]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {[data.firstName, data.middleName, data.lastName]
                .filter(Boolean)
                .join(' ')}
            </Text>
          </View>
          <View style={styles.heroHeaderRight}>
            <Text
              style={[
                styles.heroEyebrow,
                {
                  fontFamily: t.mono,
                  color: isOnyx ? 'rgba(255,255,255,0.6)' : t.ink3,
                  textAlign: 'right',
                },
              ]}
            >
              {`CLASS ${data.vehicleClass ?? '-'}\nEXP ${data.expirationDate ?? ''}`}
            </Text>
          </View>
        </View>

        {/* Body: portrait (headshot or placeholder) + facts */}
        <View style={styles.heroBody}>
          {data.headshotImagePath ? (
            <Image
              source={{ uri: data.headshotImagePath }}
              style={[styles.heroPortrait, { borderColor: t.hairline }]}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.heroPortrait,
                {
                  backgroundColor: isOnyx
                    ? 'rgba(255,255,255,0.1)'
                    : 'rgba(0,0,0,0.06)',
                  borderColor: t.hairline,
                },
              ]}
            />
          )}
          <View style={styles.heroStats}>
            <Stat
              t={t}
              isOnyx={isOnyx}
              label="DLN"
              v={data.licenseNumber}
              colSpan={2}
            />
            <Stat
              t={t}
              isOnyx={isOnyx}
              label="ADDRESS"
              v={formatAddress(data)}
              colSpan={2}
            />
            <View style={styles.heroStatRow}>
              <Stat
                t={t}
                isOnyx={isOnyx}
                label="SEX"
                v={displayField(data, 'sex')}
                inline={!wide}
              />
              <Stat
                t={t}
                isOnyx={isOnyx}
                label="EYE"
                v={displayField(data, 'eyeColor')}
                inline={!wide}
              />
            </View>
            <View style={styles.heroStatRow}>
              <Stat
                t={t}
                isOnyx={isOnyx}
                label="DOB"
                v={data.dateOfBirth}
                inline={!wide}
              />
              <Stat
                t={t}
                isOnyx={isOnyx}
                label="HGT"
                v={data.height}
                inline={!wide}
              />
            </View>
          </View>
        </View>

        {/* PDF417 strip at bottom of card */}
        <View style={styles.heroBarcodeStrip}>
          <Text
            style={{
              fontFamily: t.mono,
              fontSize: 6,
              letterSpacing: 0.6,
              color: isOnyx ? '#fff' : '#000',
              opacity: 0.4,
            }}
            numberOfLines={1}
          >
            {'|||||||||||||||||||||||||||||||||||||||||||||||||||||||'}
          </Text>
        </View>
      </View>

      {/* Under-card meta */}
      <View
        style={[
          styles.heroMeta,
          cardWidth != null ? { width: cardWidth } : null,
        ]}
      >
        <View style={styles.heroMetaLeft}>
          <IconCheck c={t.tierCV} />
          <Text
            style={[
              styles.heroMetaParsed,
              { color: t.ink, fontFamily: t.mono },
            ]}
          >
            Parsed
          </Text>
          <Text style={[styles.heroMetaDot, { color: t.ink3 }]}>·</Text>
          <Text
            style={[
              styles.heroMetaSource,
              { color: t.ink2, fontFamily: t.mono },
            ]}
          >
            {mode === 'barcode' ? 'PDF417 → AAMVA' : `${OCR_LABEL} → extractor`}
          </Text>
        </View>
      </View>
    </View>
  );
}

function formatAddress(d: LicenseData): string | null {
  // Standard US-mail two-line layout: street on one line, then
  // "City, ST ZIP" on the next. Falls back gracefully if some
  // fragments are missing — the renderer just shows whatever
  // is present.
  const cityStateZip = [
    d.city,
    [d.state, d.postalCode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  const lines = [d.street, cityStateZip].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}

function Stat({
  t,
  isOnyx,
  label,
  v,
  colSpan,
  inline,
}: {
  t: ThemeTokens;
  isOnyx: boolean;
  label: string;
  v: string | number | null | undefined;
  colSpan?: number;
  /** Label and value on ONE line (narrow/phone cards) — used for the short
   *  facts (SEX/EYE/DOB/HGT). DLN and ADDRESS keep the stacked layout. */
  inline?: boolean;
}) {
  if (v == null || v === '') return null;
  if (inline) {
    return (
      <View
        style={{
          flex: colSpan === 2 ? undefined : 1,
          width: colSpan === 2 ? '100%' : undefined,
          paddingVertical: 1,
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        <Text
          style={{
            fontSize: 9,
            letterSpacing: 1.1,
            opacity: 0.55,
            fontFamily: t.mono,
            color: isOnyx ? '#fff' : t.ink,
          }}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontWeight: '600',
            fontSize: 11.5,
            fontFamily: t.mono,
            color: isOnyx ? '#fff' : t.ink,
            flexShrink: 1,
          }}
        >
          {String(v)}
        </Text>
      </View>
    );
  }
  return (
    <View
      style={{
        flex: colSpan === 2 ? undefined : 1,
        width: colSpan === 2 ? '100%' : undefined,
        paddingVertical: 1,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          letterSpacing: 1.1,
          opacity: 0.55,
          fontFamily: t.mono,
          color: isOnyx ? '#fff' : t.ink,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontWeight: '600',
          fontSize: 11.5,
          fontFamily: t.mono,
          color: isOnyx ? '#fff' : t.ink,
        }}
      >
        {String(v)}
      </Text>
    </View>
  );
}

interface GradientSpec {
  colors: readonly [string, string, ...string[]];
  locations?: readonly [number, number, ...number[]];
  start: { x: number; y: number };
  end: { x: number; y: number };
}

function pickGradient(direction: Direction, t: ThemeTokens): GradientSpec {
  if (direction === 'lumen') {
    // The mode-resolved tokens.ts cardGrad has Lumen's full 3-color
    // diagonal gradient. We don't parse the string at runtime —
    // hardcode the resolved RGBA stops per mode.
    const isDark =
      t.bg === '#07080d' || t.bg === '#050507' || t.bg === '#1b1812';
    return {
      colors: isDark
        ? [
            'rgba(183,148,255,0.28)',
            'rgba(110,167,255,0.18)',
            'rgba(110,231,183,0.22)',
          ]
        : [
            'rgba(183,148,255,0.5)',
            'rgba(110,167,255,0.35)',
            'rgba(110,231,183,0.4)',
          ],
      locations: [0, 0.5, 1],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    } as GradientSpec;
  }
  if (direction === 'vellum') {
    const isDark = t.bg === '#1b1812';
    return {
      colors: isDark ? ['#2d2820', '#1a1712'] : ['#fbf8f1', '#ece4d0'],
      start: { x: 0, y: 0 },
      end: { x: 0.8, y: 1 },
    } as GradientSpec;
  }
  // onyx
  const isDark = t.bg === '#050507';
  return {
    colors: isDark ? ['#1c1f27', '#0d0f14'] : ['#fdfdfd', '#eef0f4'],
    start: { x: 0, y: 0 },
    end: { x: 0.8, y: 1 },
  } as GradientSpec;
}

// ─── Scanned-card preview (Overlay | Original) ─────────────────────────────

/**
 * SCANNED CARD section (#82): the saved card image with an Overlay|Original
 * segmented toggle. Overlay (the default) dims the card behind a translucent
 * scrim and draws every OCR observation at roughly the position/size it was
 * recognized. Observation coordinates are normalized to the card image, so
 * they're mapped through the MEASURED rendered box (onLayout), with the
 * box's aspect driven by the image's intrinsic size (Image.getSize) — never
 * an assumed CR-80 ratio. When observations are absent (barcode mode, or
 * the native OCR pass failed) the toggle is disabled and the plain image
 * renders.
 */
function ScannedCardSection({
  uri,
  observations,
  t,
}: {
  uri: string;
  observations: OcrObservation[];
  t: ThemeTokens;
}) {
  const [view, setView] = useState<'overlay' | 'original'>('overlay');
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setAspect(w / h);
      },
      () => {
        // Intrinsic size unavailable → keep the CR-80 fallback frame and
        // leave the overlay disabled (it needs the true aspect to align).
        if (!cancelled) setAspect(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const overlayReady = observations.length > 0 && aspect != null;
  const showOverlay = overlayReady && view === 'overlay';

  return (
    <View style={styles.cardPreview}>
      <View style={styles.cardPreviewHeader}>
        <Text
          style={[styles.sectionLabel, { fontFamily: t.mono, color: t.ink2 }]}
        >
          SCANNED CARD
        </Text>
        <View
          pointerEvents={overlayReady ? 'auto' : 'none'}
          style={[
            styles.segmentHost,
            {
              backgroundColor: t.surface2,
              borderColor: t.hairline,
              opacity: overlayReady ? 1 : 0.4,
            },
          ]}
        >
          {(['overlay', 'original'] as const).map((k) => {
            const on = (showOverlay ? 'overlay' : 'original') === k;
            return (
              <Pressable
                key={k}
                onPress={() => setView(k)}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !overlayReady }}
                accessibilityLabel={`${k} card view`}
                style={[
                  styles.segmentBtn,
                  on && {
                    backgroundColor: t.surface,
                    borderColor: t.hairline,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { fontFamily: t.mono, color: on ? t.ink : t.ink3 },
                  ]}
                >
                  {k === 'overlay' ? 'Overlay' : 'Original'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View
        onLayout={(e) =>
          setBox({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
        style={[styles.cardPreviewFrame, { aspectRatio: aspect ?? 1.585 }]}
      >
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          // With the frame at the image's intrinsic aspect the image fills
          // it edge-to-edge (cover == contain there). Until getSize
          // resolves, contain inside the CR-80 fallback frame — the
          // overlay is off in that state anyway.
          resizeMode={aspect != null ? 'cover' : 'contain'}
        />
        {showOverlay && box != null && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {/* Scrim between the card and the text: theme bg at 0.6 keeps
                the card identifiable while giving the ink-colored text
                enough contrast in both light and dark themes. */}
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: t.bg, opacity: 0.6 },
              ]}
            />
            {observations.map((o, i) => (
              <Text
                key={`${i}-${o.text}`}
                numberOfLines={1}
                style={{
                  position: 'absolute',
                  left: o.x * box.w,
                  top: o.y * box.h,
                  width: Math.max(o.width * box.w, 2),
                  // ~0.72 of the bbox height ≈ cap height of the line;
                  // floor keeps degenerate boxes from rendering at 0.
                  fontSize: Math.max(o.height * box.h * 0.72, 4),
                  lineHeight: Math.max(o.height * box.h, 5),
                  fontFamily: t.mono,
                  color: t.ink,
                }}
              >
                {o.text}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Confidence rail ───────────────────────────────────────────────────────

function ConfidenceRail({
  conf,
  t,
}: {
  conf: Record<string, ConfidenceEntry>;
  t: ThemeTokens;
}) {
  const entries = Object.values(conf);
  if (entries.length === 0) return null;
  const counts: Record<ConfidenceTier, number> = {
    cross_validated: 0,
    all_gates_passed: 0,
    marker_located: 0,
    shape_matched: 0,
    extracted_raw: 0,
  };
  let scoreSum = 0;
  entries.forEach((e) => {
    counts[e.tier] = (counts[e.tier] ?? 0) + 1;
    scoreSum += e.score;
  });
  const total = entries.length;
  const avg = scoreSum / total;

  const order: ConfidenceTier[] = [
    'cross_validated',
    'all_gates_passed',
    'marker_located',
    'shape_matched',
    'extracted_raw',
  ];

  return (
    <View style={styles.railWrap}>
      <Text
        style={[
          styles.sectionLabel,
          {
            fontFamily: t.mono,
            color: t.ink3,
            paddingTop: 8,
            paddingBottom: 6,
          },
        ]}
      >
        {`Confidence · ${Math.round(avg * 100)}%`}
      </Text>
      <View
        style={[
          styles.railBar,
          { backgroundColor: t.surface2, borderColor: t.hairline },
        ]}
      >
        {order.map((tier) => {
          const c = counts[tier];
          if (!c) return null;
          const [fg] = tierColor(t, tier);
          return (
            <View
              key={tier}
              style={{
                flex: c,
                backgroundColor: fg,
              }}
            />
          );
        })}
      </View>
      <View style={styles.railLegend}>
        {order.map((tier) => {
          const c = counts[tier];
          const [fg] = tierColor(t, tier);
          return (
            <View key={tier} style={styles.railLegendItem}>
              <View
                style={[
                  styles.railLegendDot,
                  { backgroundColor: fg, opacity: c ? 1 : 0.3 },
                ]}
              />
              <Text
                style={{
                  fontSize: 10.5,
                  fontFamily: t.mono,
                  color: c ? t.ink2 : t.ink4,
                  textTransform: 'lowercase',
                }}
              >
                {TIER_LABEL[tier]}
              </Text>
              <Text
                style={{
                  fontSize: 10.5,
                  fontFamily: t.mono,
                  color: t.ink3,
                }}
              >
                {c}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Field chip ────────────────────────────────────────────────────────────

function FieldChip({
  label,
  value,
  conf,
  belowMin,
  span,
  t,
}: {
  label: string;
  /** When null, the chip renders a "Not detected" placeholder. */
  value: string | null;
  conf: ConfidenceEntry | null;
  /** True when the field IS populated but its tier sits below the user's
   *  minTier filter. Renders muted/neutral — NEVER red. */
  belowMin: boolean;
  span: 1 | 2;
  t: ThemeTokens;
}) {
  const isMissing = value == null || value === '';
  // Suppress any leftover confidence entry when the value itself is missing —
  // a 95% chip next to "Not detected" is contradictory.
  const effectiveConf = isMissing ? null : conf;
  const tier = effectiveConf?.tier;
  const [fg] = tier ? tierColor(t, tier) : [t.ink3, t.surface2];
  // RED is reserved for genuinely MISSING fields only — the one case the user
  // must act on. A populated field, whatever its confidence band, is never
  // painted red: a below-minTier populated field is merely DIMMED (the
  // tier-tracking color still shows through at reduced emphasis), and an
  // at/above-threshold field renders at full tier color. extracted_raw (amber)
  // is informational, not an error.
  const accent = isMissing ? DROP_COLOR : fg;
  return (
    <View
      style={[
        styles.chip,
        {
          flexBasis: span === 2 ? '100%' : '48%',
          backgroundColor: t.surface,
          borderColor: isMissing ? DROP_COLOR + '66' : t.hairline,
          // Missing → strong dim; populated-below-min → soft dim; else full.
          opacity: isMissing ? 0.55 : belowMin ? 0.72 : 1,
        },
      ]}
    >
      {/* halo line on top edge */}
      {tier && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: fg,
            // Below-min or the lowest band reads at reduced emphasis; a
            // full-trust field gets a solid halo.
            opacity: belowMin || tier === 'extracted_raw' ? 0.45 : 1,
          }}
        />
      )}
      <View style={styles.chipHeader}>
        <Text
          style={{
            fontFamily: t.mono,
            fontSize: 9.5,
            letterSpacing: 1.1,
            textTransform: 'uppercase',
            fontWeight: '600',
            color: isMissing ? DROP_COLOR : t.ink3,
          }}
        >
          {label}
        </Text>
        {effectiveConf && (
          <Text
            style={{
              fontFamily: t.mono,
              fontSize: 9.5,
              fontWeight: '700',
              color: accent,
            }}
          >
            {`${Math.round(effectiveConf.score * 100)}%`}
          </Text>
        )}
      </View>
      <Text
        style={{
          marginTop: 3,
          fontSize: 14,
          fontWeight: isMissing ? '500' : '600',
          fontStyle: isMissing ? 'italic' : 'normal',
          color: isMissing ? t.ink3 : t.ink,
          lineHeight: 17.5,
        }}
      >
        {value ?? 'Not detected'}
      </Text>
    </View>
  );
}

function SectionLabel({
  t,
  children,
}: {
  t: ThemeTokens;
  children: React.ReactNode;
}) {
  return (
    <Text style={[styles.sectionLabel, { fontFamily: t.mono, color: t.ink3 }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: 18, paddingBottom: 16 },
  sectionLabel: {
    fontSize: 10.5,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontWeight: '600',
    paddingTop: 14,
    paddingBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  debugBtn: {
    height: 48,
    width: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  scanAgainBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanAgainBtnGlow: {
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  scanAgainLabel: { fontSize: 15.5, fontWeight: '600', letterSpacing: -0.15 },

  // hero
  heroWrap: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  heroCard: {
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
    // Height is CONTENT-driven, not aspect-driven. A fixed CR-80 aspect
    // (1.586:1) inflated the card on wide layouts (iPad: huge empty gradient
    // below ~6 rows of content) and clipped it on narrow ones (Pixel: the
    // DOB/HGT row collided with the absolutely-pinned barcode strip). The
    // card now hugs its rows; maxWidth keeps it card-shaped instead of
    // banner-shaped inside the wide tablet column.
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    minHeight: 200,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroHeaderRight: { alignItems: 'flex-end', flexShrink: 0 },
  heroEyebrow: {
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  heroName: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: -0.4,
    lineHeight: 22,
  },
  heroBody: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 12,
    alignItems: 'flex-start',
  },
  heroPortrait: {
    width: 64,
    height: 84,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroStats: {
    flex: 1,
    rowGap: 4,
  },
  heroStatRow: {
    flexDirection: 'row',
    gap: 12,
  },
  heroBarcodeStrip: {
    // In normal flow as the card's footer (was absolutely pinned to the
    // bottom edge, which overlapped the last stat row on narrow screens).
    marginTop: 14,
    height: 14,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    // Track the card's width cap so the meta line stays visually attached
    // to the card on wide layouts instead of spanning the full column.
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  heroMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroMetaParsed: { fontSize: 11.5, fontWeight: '600' },
  heroMetaDot: { fontSize: 11.5 },
  heroMetaSource: { fontSize: 11.5 },

  // rail
  railWrap: { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 4 },
  railBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  railLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 8,
  },
  railLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  railLegendDot: { width: 6, height: 6, borderRadius: 999 },

  // chip
  chip: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
  },
  chipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },

  // card image preview
  cardPreview: {
    marginTop: 8,
    marginBottom: 16,
  },
  cardPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardPreviewFrame: {
    position: 'relative',
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  segmentHost: {
    flexDirection: 'row',
    padding: 2,
    gap: 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  segmentLabel: {
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
});
