// TabletShell — split-pane composition for iPad-class devices
// (Phase H Wave 2A). Used in BOTH tablet orientations; the
// difference is just `fillPct` on the Viewfinder.
//
// Layout:
//   ┌───────────────────────────────┬────────────────────────┐
//   │ Inline title (eyebrow + h1)   │                        │
//   ├───────────────────────────────┤                        │
//   │ ModeFlip (compact)            │   TelemetryRail        │
//   ├───────────────────────────────┤   (session count +     │
//   │                               │    scrollable recent   │
//   │     ViewfinderWithPipeline    │    scans list)         │
//   │     (or ResultView on flip)   │                        │
//   │                               │                        │
//   ├───────────────────────────────┤                        │
//   │ ActionBar (always left col)   │                        │
//   └───────────────────────────────┴────────────────────────┘
//
// Critical semantic decisions from the spec:
//   - Actions ALWAYS in viewfinder column footer (left side). The
//     TelemetryRail is purely display-only. One scanner-control
//     locus tied to live scanner state.
//   - When `phase === 'result'`, the LEFT column swaps from
//     ViewfinderWithPipeline → ResultView. ResultView is invoked
//     with `hideActions={true}` so it doesn't render its own
//     footer (the column footer is the canonical action locus).
//   - `fillPct` for the viewfinder: 0.5 in landscape (cropped wider),
//     0.8 in portrait (matches phone density). Comes from the spec's
//     review-locked decisions.
//   - Corner overlay (Viewfinder's `detectedCorners` polygon) is
//     disabled here — existing mapping assumes portrait 4:3 sensor
//     and rework is v2 polish per spec.

import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LicenseData } from 'react-native-dl-scan';
import { useTokens } from '../../theme/useTokens';
import type { Tweaks } from '../../hooks/useTweaks';
import type { ScannerInternals } from '../../hooks/useScannerInternals';
import type { Phase } from '../ScannerScreen';
import type { RecentScanSummary } from '../DebugDrawer';
import { ModeFlip } from '../ModeFlip';
import { ActionBar } from '../ActionBar';
import { ResultView } from '../ResultView';
import { ViewfinderWithPipeline } from '../viewfinder/ViewfinderWithPipeline';
import { TelemetryRail } from '../TelemetryRail';

export interface TabletShellProps {
  session: ScannerInternals;
  mode: 'barcode' | 'ocr';
  onModeChange: (m: 'barcode' | 'ocr') => void;
  phase: Phase;
  setPhase: (p: Phase) => void;
  licenseData: LicenseData | null;
  onStart: () => void;
  onStop: () => void;
  onScanAgain: () => void;
  onShowDebug: () => void;
  scanCount: number;
  tweaks: Tweaks;
  fallbackRemaining: number | null;
  /** Current orientation. Wave 1 stub already accepted this; we use
   *  it to drive Viewfinder fillPct (0.5 landscape / 0.8 portrait). */
  orientation: 'portrait' | 'landscape';
  /** Last-50 ring buffer of completed scans, surfaced in the
   *  TelemetryRail. May be `undefined` if App.tsx hasn't been
   *  updated yet to forward it (Wave 2B); we default to []. */
  recentScans?: RecentScanSummary[];
}

export function TabletShell({
  session,
  mode,
  onModeChange,
  phase,
  setPhase,
  licenseData,
  onStart,
  onStop,
  onScanAgain,
  onShowDebug,
  scanCount,
  tweaks,
  fallbackRemaining,
  orientation,
  recentScans = [],
}: TabletShellProps) {
  const { t, direction } = useTokens(tweaks.direction, tweaks.theme);
  const insets = useSafeAreaInsets();
  const { scanner, cameraSlot, showFixture, runFixture } = session;
  const isLandscape = orientation === 'landscape';
  const inResult = phase === 'result';

  // Inline title. The phone shells use TopBar; tablet has more room
  // so we surface an inline eyebrow + display title that adapts to
  // mode + phase. Mirrors the design reference (tablet.jsx).
  const titleText = inResult
    ? 'Parsed'
    : phase === 'captured' || phase === 'pipeline'
      ? 'Processing'
      : mode === 'barcode'
        ? 'Scan the back'
        : 'Scan the front';

  return (
    <View
      style={[
        styles.host,
        {
          paddingTop: Math.max(insets.top, 8),
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      {/* LEFT column — viewfinder host. Contains:
       *    1. Inline title (eyebrow + h1)
       *    2. ModeFlip (compact)
       *    3. ViewfinderWithPipeline OR ResultView (phase === 'result')
       *    4. ActionBar (canonical action locus across phases) */}
      <View style={styles.leftColumn}>
        <View style={styles.titleBlock}>
          <Text style={[styles.eyebrow, { fontFamily: t.mono, color: t.ink3 }]}>
            react-native-dl-scan · example
          </Text>
          <Text style={[styles.title, { fontFamily: t.display, color: t.ink }]}>
            {titleText}
          </Text>
        </View>

        <ModeFlip
          mode={mode}
          onChange={onModeChange}
          t={t}
          direction={direction}
          dim={inResult}
          compact
        />

        {/* Body — viewfinder (front) or result view (back). The tablet
         *  shell uses a SWAP rather than a FlipCard: per spec, the
         *  result swap on tablet is a "sibling pane crossfade" and the
         *  flip-card delay should NOT block tablet (Wave 2B owns the
         *  delay split in App.tsx). For Wave 2A we render the simple
         *  conditional swap. */}
        <View style={styles.bodyHost}>
          {inResult && licenseData != null ? (
            <ResultView
              data={licenseData}
              mode={mode}
              t={t}
              direction={direction}
              minTier={tweaks.minTier}
              onScanAgain={onScanAgain}
              onShowDebug={onShowDebug}
              // Actions live in the column footer (ActionBar below) —
              // hide ResultView's own footer to avoid duplication.
              hideActions
            />
          ) : (
            <ViewfinderWithPipeline
              mode={mode}
              phase={phase}
              t={t}
              direction={direction}
              cameraSlot={cameraSlot}
              fillPct={isLandscape ? 0.5 : 0.8}
              scanProgress={scanner.progress}
              // Tablet (both orientations): disable detected-corner
              // overlay. The existing mapping assumes a portrait 4:3
              // sensor and the tablet container is wider — overlay
              // would render mis-aligned. spec constraint;
              // re-enable in v2.
              detectedCorners={undefined}
              licenseData={scanner.licenseData}
              fallbackRemaining={fallbackRemaining}
              fallbackTotal={tweaks.fallbackSec}
              showPipeline={phase === 'pipeline'}
              pipelineStage={scanner.pipelineStage}
              onPipelineDone={() => setPhase('result')}
            />
          )}
        </View>

        <ActionBar
          t={t}
          phase={phase}
          onStart={onStart}
          onStop={onStop}
          onScanAgain={onScanAgain}
          showFixture={showFixture}
          onRunFixture={runFixture}
        />

        {scanner.error != null && (
          <Text style={[styles.errorText, { color: '#ef4444' }]}>
            {scanner.error}
          </Text>
        )}
      </View>

      {/* RIGHT column — TelemetryRail (display-only). */}
      <View style={styles.rightColumn}>
        <TelemetryRail t={t} scanCount={scanCount} recentScans={recentScans} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    flexDirection: 'row',
    gap: 20,
  },
  // ~58% : 42% split. Using flex ratios so the columns respond
  // smoothly to iPad split-view / multitasking width changes.
  leftColumn: {
    flex: 58,
    minWidth: 0,
    flexDirection: 'column',
    gap: 14,
  },
  rightColumn: {
    flex: 42,
    minWidth: 0,
    flexDirection: 'column',
    paddingTop: 8,
  },
  titleBlock: {
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.7,
    marginTop: 4,
    lineHeight: 33,
  },
  bodyHost: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  errorText: {
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
  },
});
