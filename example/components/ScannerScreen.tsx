// ScannerScreen — scanner HOST (Phase H Wave 1 refactor).
//
// Previously this file owned the entire visual composition + the
// camera/permission/scanner hook stack. After Wave 1 it's reduced to
// a thin host that:
//
//   1. Composes the runtime hooks once, unconditionally, via
//      `useScannerInternals` (so React's hook rules hold across
//      shell switches).
//   2. Wraps in `PermissionGate` — pure presentational, no hooks
//      that touch scanner/camera/permission.
//   3. Wraps the chosen shell in `<KeyedRuntime>` to preserve the
//      existing scanSessionId re-key reset mechanism (App.tsx
//      remounts ScannerScreen on session-bump for now; KeyedRuntime
//      is here so Wave 2 can move the re-key INSIDE ScannerScreen
//      without further refactoring).
//   4. Picks ONE of three layout shells via `useDeviceLayout`:
//        - tablet                → TabletShell
//        - phone + landscape     → PhoneLandscapeShell
//        - else (phone portrait) → PhonePortraitShell
//
// For Wave 1, the landscape + tablet shells are stubs that delegate
// to PhonePortraitShell. The user sees no UI change. Wave 2 will
// replace those stubs with real compositions.

import { useEffect, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import type { LicenseData } from 'react-native-dl-scan';
import { useTokens } from '../theme/useTokens';
import type { Tweaks, SetTweak } from '../hooks/useTweaks';
import { useScannerInternals } from '../hooks/useScannerInternals';
import { useDeviceLayout } from '../hooks/useDeviceLayout';
import { PermissionGate } from './PermissionGate';
import { PhonePortraitShell } from './layouts/PhonePortraitShell';
import { PhoneLandscapeShell } from './layouts/PhoneLandscapeShell';
import { TabletShell } from './layouts/TabletShell';
import type { RecentScanSummary } from './DebugDrawer';

export type Phase = 'idle' | 'scanning' | 'captured' | 'pipeline' | 'result';

export interface ScannerScreenProps {
  mode: 'barcode' | 'ocr';
  onModeChange: (m: 'barcode' | 'ocr') => void;
  phase: Phase;
  setPhase: (p: Phase) => void;
  licenseData: LicenseData | null;
  onResult: (data: LicenseData) => void;
  onStart: () => void;
  onStop: () => void;
  onScanAgain: () => void;
  onShowDebug: () => void;
  scanCount: number;
  tweaks: Tweaks;
  setTweak: SetTweak;
  fallbackRemaining: number | null;
  /** Optional — last-50 completed scan summaries surfaced in the
   *  tablet TelemetryRail. App.tsx may not pass this until Wave 2B
   *  threads it through; default to []. */
  recentScans?: RecentScanSummary[];
}

export function ScannerScreen({
  mode,
  onModeChange,
  phase,
  setPhase,
  licenseData,
  onResult,
  onStart,
  onStop,
  onScanAgain,
  onShowDebug,
  scanCount,
  tweaks,
  fallbackRemaining,
  recentScans = [],
}: ScannerScreenProps) {
  const { t } = useTokens(tweaks.direction, tweaks.theme);

  // Single, unconditional hook composition. PermissionGate runs AFTER
  // this hook — it only chooses what to render based on the state we
  // return. The hooks themselves run every render regardless of
  // permission state (Rules of Hooks).
  const session = useScannerInternals({
    mode,
    phase,
    setPhase,
    onResult,
    showFixtureTweak: tweaks.showFixture,
    completion: {
      requiredFields: tweaks.requiredFields,
      maxFrames: tweaks.maxPasses,
      validationPass: tweaks.validationPass,
      tta: { enabled: tweaks.ttaEnabled, modes: tweaks.ttaModes },
    },
  });

  // captured → pipeline (if pipeline-animation on) → result transition.
  // Pure phase-machine effect; doesn't touch any scanner internals so
  // it stays here in the host rather than being pushed into the hook.
  useEffect(() => {
    if (phase !== 'captured') return;
    const id = setTimeout(
      () => setPhase(tweaks.showPipeline ? 'pipeline' : 'result'),
      600
    );
    return () => clearTimeout(id);
  }, [phase, tweaks.showPipeline, setPhase]);

  return (
    <PermissionGate
      status={session.status}
      hasPermission={session.hasPermission}
      canRequestPermission={session.canRequestPermission}
      requestPermission={session.requestPermission}
      device={session.device}
      t={t}
    >
      {/* KeyedRuntime preserves the existing scanSessionId re-key reset
       *  mechanism. Today App.tsx re-keys ScannerScreen itself, which
       *  remounts everything including the permission hooks above —
       *  that still works. KeyedRuntime is the seam Wave 2 will use to
       *  scope the re-key to JUST the shell tree, so the camera +
       *  permission hooks survive a session reset. For Wave 1 it's a
       *  stable identity (no key prop) so behavior is unchanged. */}
      <KeyedRuntime>
        <ChosenShell
          session={session}
          mode={mode}
          onModeChange={onModeChange}
          phase={phase}
          setPhase={setPhase}
          licenseData={licenseData}
          onStart={onStart}
          onStop={onStop}
          onScanAgain={onScanAgain}
          onShowDebug={onShowDebug}
          scanCount={scanCount}
          tweaks={tweaks}
          fallbackRemaining={fallbackRemaining}
          recentScans={recentScans}
        />
      </KeyedRuntime>
    </PermissionGate>
  );
}

function KeyedRuntime({ children }: { children: ReactNode }) {
  return <View style={styles.keyedRuntime}>{children}</View>;
}

interface ChosenShellProps {
  session: ReturnType<typeof useScannerInternals>;
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
  recentScans: RecentScanSummary[];
}

function ChosenShell(props: ChosenShellProps) {
  const { deviceClass, isLandscape } = useDeviceLayout();
  if (deviceClass === 'tablet') {
    // Tablet shell needs both the orientation flag (for fillPct) and
    // the recent-scans buffer (for the TelemetryRail). Phone shells
    // don't surface recent scans in v1 — the rail is tablet-only —
    // so we strip it out of the prop bag below to keep their types
    // tight.
    return (
      <TabletShell
        {...props}
        orientation={isLandscape ? 'landscape' : 'portrait'}
      />
    );
  }
  // Phone shells don't render recentScans in v1; strip from props.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { recentScans, ...phoneProps } = props;
  if (isLandscape) {
    return <PhoneLandscapeShell {...phoneProps} />;
  }
  return <PhonePortraitShell {...phoneProps} />;
}

const styles = StyleSheet.create({
  keyedRuntime: { flex: 1 },
});
