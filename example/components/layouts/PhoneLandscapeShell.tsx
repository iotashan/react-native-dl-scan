// PhoneLandscapeShell — phone-in-landscape composition (Phase H Wave 2A).
//
// Layout:
//   ┌──────────────────────────────────────┬──────────────────┐
//   │                                      │ TopBar (compact) │
//   │                                      ├──────────────────┤
//   │         ViewfinderWithPipeline       │ ModeFlip compact │
//   │            (FlipCard host)           ├──────────────────┤
//   │                                      │ ActionBar     ↓  │
//   │                                      │ (or ResultView)  │
//   └──────────────────────────────────────┴──────────────────┘
//
// Rail width: `clamp(220, 32% of available width, 320)` — empirical
// starting guess from the Phase H spec; tune on iPhone SE landscape.
//
// Flip-card metaphor preserved (Y-axis), but the viewfinder's container
// shape changes from portrait-tall to landscape-wide. The face-column
// inside FlipCard is what `useWindowDimensions()` measures; both faces
// fit edge-to-edge.
//
// Safe-area handling:
//   In landscape on a Pro-class iPhone the dynamic island sits on ONE
//   edge (~78pt) and the home indicator on the OTHER (~32pt). Which
//   edge each lives on depends on the rotation direction the user took
//   (clockwise vs counter-clockwise). `useSafeAreaInsets()` gives us
//   the *actual* per-edge values from the OS — we apply them with
//   paddingLeft/Right so the chrome and viewfinder never bleed behind
//   either feature. Top/bottom insets are intentionally NOT honored
//   here — App.tsx's SafeAreaView still owns top inset for Wave 2A
//   (Wave 2B drops it).
//
// Corner overlay (Viewfinder's `detectedCorners` polygon overlay) is
// disabled in landscape — the existing mapping assumes a 4:3 portrait
// sensor and would render mis-aligned across the wider container. Pass
// `detectedCorners={undefined}` so the overlay short-circuits. Spec
// (review) calls this out as v2 polish.

import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LicenseData } from 'react-native-dl-scan';
import { useTokens } from '../../theme/useTokens';
import type { Tweaks } from '../../hooks/useTweaks';
import type { ScannerInternals } from '../../hooks/useScannerInternals';
import { useDeviceLayout } from '../../hooks/useDeviceLayout';
import type { Phase } from '../ScannerScreen';
import { TopBar } from '../TopBar';
import { ModeFlip } from '../ModeFlip';
import { ActionBar } from '../ActionBar';
import { FlipCard } from '../FlipCard';
import { ResultView } from '../ResultView';
import { ViewfinderWithPipeline } from '../viewfinder/ViewfinderWithPipeline';

export interface PhoneLandscapeShellProps {
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
}

// Rail clamp values per Phase H spec. Starting guess — tune on
// iPhone SE landscape (667pt wide) if rail feels too cramped or too
// wide on iPhone Pro Max (932pt).
const RAIL_MIN = 220;
const RAIL_MAX = 320;
const RAIL_PCT = 0.32;

function clampRail(availableWidth: number): number {
  const target = availableWidth * RAIL_PCT;
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, target));
}

export function PhoneLandscapeShell({
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
}: PhoneLandscapeShellProps) {
  const { t, direction } = useTokens(tweaks.direction, tweaks.theme);
  const insets = useSafeAreaInsets();
  const { scanner, cameraSlot, showFixture, runFixture } = session;

  // Rail width: clamp(220, 32% of screen width, 320). We can't read
  // the parent's measured width pre-render, so we resolve the clamp
  // against the SCREEN width from `useDeviceLayout()`. In practice
  // phone-landscape screens are 667-932pt (iPhone SE → Pro Max
  // landscape), so 32% resolves to ~213-298pt and clamps to
  // RAIL_MIN/RAIL_MAX bounds at the extremes. Re-call of
  // `useDeviceLayout` here is cheap — `useWindowDimensions` is
  // dedup'd by RN core.
  const dl = useDeviceLayout();
  const railWidth = clampRail(dl.width);

  // Viewfinder face — wraps in the landscape-aware face-column so
  // FlipCard can rotate it without breaking the layout. `fillPct=0.8`
  // per spec for phone landscape (vs 0.95 portrait, 0.5 tablet
  // landscape).
  const front = (
    <View style={styles.viewfinderHost}>
      <ViewfinderWithPipeline
        mode={mode}
        phase={phase}
        t={t}
        direction={direction}
        cameraSlot={cameraSlot}
        fillPct={0.95}
        scanProgress={scanner.progress}
        // Landscape: disable detected-corner overlay. The existing
        // corner-to-view mapping assumes a portrait 4:3 sensor; in
        // landscape the math would be inverted and render mis-aligned.
        // spec constraint — re-enable in v2.
        detectedCorners={undefined}
        licenseData={scanner.licenseData}
        fallbackRemaining={fallbackRemaining}
        fallbackTotal={tweaks.fallbackSec}
        showPipeline={phase === 'pipeline'}
        pipelineStage={scanner.pipelineStage}
        onPipelineDone={() => setPhase('result')}
      />
    </View>
  );

  const back = licenseData ? (
    <ResultView
      data={licenseData}
      mode={mode}
      t={t}
      direction={direction}
      minTier={tweaks.minTier}
      onScanAgain={onScanAgain}
      onShowDebug={onShowDebug}
      // In landscape we don't have a separate footer in the viewfinder
      // column — the rail hosts the action affordances. So we let
      // ResultView own its own footer (default `hideActions=false`).
    />
  ) : (
    <View style={{ flex: 1, backgroundColor: t.bg }} />
  );

  const inResult = phase === 'result';
  return (
    <View
      style={[
        styles.host,
        {
          paddingTop: Math.max(insets.top, 8),
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      {/* LEFT — viewfinder column. FlipCard wraps the front/back
       *  faces; Y-axis flip metaphor preserved per spec. */}
      <View style={styles.viewfinderColumn}>
        <FlipCard
          flipped={inResult}
          front={front}
          back={back}
          mode={Platform.OS === 'android' ? 'slide' : 'flip'}
        />
      </View>

      {/* RIGHT — narrow rail. Contains:
       *    - TopBar (eyebrow/title/session count)
       *    - ModeFlip (compact)
       *    - ActionBar (push to the bottom of the rail) OR — when in
       *      result phase — the action affordances live in ResultView's
       *      own footer (default, on the back face). The rail still
       *      shows TopBar + ModeFlip so the user can re-orient between
       *      scans. */}
      <View style={[styles.rail, { width: railWidth }]}>
        <TopBar t={t} phase={phase} scanCount={scanCount} />
        <ModeFlip
          mode={mode}
          onChange={onModeChange}
          t={t}
          direction={direction}
          dim={inResult}
          compact
        />
        {/* Spacer pushes the action bar to the bottom of the rail in
         *  the scanning/idle phases. In result phase we drop the rail
         *  action bar — ResultView's own footer hosts Scan-again. */}
        <View style={styles.railSpacer} />
        {!inResult && (
          <ActionBar
            t={t}
            phase={phase}
            onStart={onStart}
            onStop={onStop}
            showFixture={showFixture}
            onRunFixture={runFixture}
          />
        )}
        {scanner.error != null && (
          <Text style={[styles.errorText, { color: '#ef4444' }]}>
            {scanner.error}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 12,
  },
  viewfinderColumn: {
    flex: 1,
    minWidth: 0,
  },
  viewfinderHost: {
    flex: 1,
    position: 'relative',
  },
  rail: {
    flexDirection: 'column',
    gap: 10,
  },
  railSpacer: { flex: 1 },
  errorText: {
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
  },
});
