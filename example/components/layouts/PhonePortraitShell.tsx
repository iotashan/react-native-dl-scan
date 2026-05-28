// PhonePortraitShell — the current phone-portrait composition lifted
// out of ScannerScreen verbatim (Phase H Wave 1 foundation refactor).
//
// Body matches the previous ScannerScreen `front` / `back` / FlipCard
// JSX exactly — only difference is that the inline `<Viewfinder>` +
// face-column `<PipelineOverlay>` are now replaced by the single
// `<ViewfinderWithPipeline>` component (the overlay is scoped to the
// viewfinder bounds rather than the face column).
//
// Receives all runtime state via two prop bags: the session bag
// (camera + scanner + permission) from `useScannerInternals` and the
// UI bag (mode, phase, callbacks, tweaks, fallback) from
// ScannerScreen / App.tsx.

import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LicenseData } from 'react-native-dl-scan';
import { useTokens } from '../../theme/useTokens';
import type { Tweaks } from '../../hooks/useTweaks';
import type { ScannerInternals } from '../../hooks/useScannerInternals';
import type { Phase } from '../ScannerScreen';
import { TopBar } from '../TopBar';
import { ModeFlip } from '../ModeFlip';
import { ActionBar } from '../ActionBar';
import { FlipCard } from '../FlipCard';
import { ResultView } from '../ResultView';
import { ViewfinderWithPipeline } from '../viewfinder/ViewfinderWithPipeline';

export interface PhonePortraitShellProps {
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

export function PhonePortraitShell({
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
}: PhonePortraitShellProps) {
  const { t, direction } = useTokens(tweaks.direction, tweaks.theme);
  const insets = useSafeAreaInsets();
  const { scanner, cameraSlot, showFixture, runFixture } = session;

  const front = (
    <View style={styles.faceColumn}>
      <ViewfinderWithPipeline
        mode={mode}
        phase={phase}
        t={t}
        direction={direction}
        cameraSlot={cameraSlot}
        fillPct={0.95}
        scanProgress={scanner.progress}
        detectedCorners={scanner.detectedCorners}
        licenseData={scanner.licenseData}
        fallbackRemaining={fallbackRemaining}
        fallbackTotal={tweaks.fallbackSec}
        showPipeline={phase === 'pipeline'}
        pipelineStage={scanner.pipelineStage}
        onPipelineDone={() => setPhase('result')}
      />
      <ActionBar
        t={t}
        phase={phase}
        onStart={onStart}
        onStop={onStop}
        showFixture={showFixture}
        onRunFixture={runFixture}
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
    />
  ) : (
    // Placeholder for the back-face during the transition's first
    // 90° (before licenseData is set). Solid color keeps the flip
    // visually consistent.
    <View style={{ flex: 1, backgroundColor: t.bg }} />
  );

  return (
    <View
      style={[
        styles.host,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <TopBar t={t} phase={phase} scanCount={scanCount} />
      <View style={styles.modeWrap}>
        <ModeFlip
          mode={mode}
          onChange={onModeChange}
          t={t}
          direction={direction}
          dim={phase === 'result'}
        />
      </View>
      <View style={styles.flipCardWrap}>
        {/* review P2 (Phase F-G review): Android's hardware-accelerated
         *  rotateY can flicker the native Camera preview surface
         *  mid-rotation. We pause Camera frame output via the
         *  conditional outputs={[]} above, but the preview SURFACE
         *  stays live inside the rotated face. Slide-mode on Android
         *  sidesteps the 3D compositor entirely; iOS keeps the flip
         *  metaphor where it composites cleanly. */}
        <FlipCard
          flipped={phase === 'result'}
          front={front}
          back={back}
          mode={Platform.OS === 'android' ? 'slide' : 'flip'}
        />
      </View>
      {scanner.error != null && (
        <Text style={[styles.errorText, { color: '#ef4444' }]}>
          {scanner.error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  modeWrap: { paddingHorizontal: 8, paddingBottom: 12 },
  flipCardWrap: { flex: 1, position: 'relative' },
  faceColumn: {
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 0,
    paddingBottom: 14,
  },
  errorText: {
    textAlign: 'center',
    padding: 12,
    fontSize: 12,
  },
});
