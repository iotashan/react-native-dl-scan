// Example app for react-native-dl-scan — design-aligned rewrite
// (Phase F-G of task #71).
//
// Owns the phase machine + cross-screen state:
//
//   phase:    idle → scanning → captured → pipeline → result → idle ...
//   mode:     'barcode' | 'ocr'  — barcode is the back of the DL,
//             OCR reads the front. Auto-fallback flips barcode→ocr
//             after `tweaks.fallbackSec` seconds if enabled.
//   theme/direction: useTweaks state, persisted later (Phase F+ follow-up).
//   recentScans: an in-memory log of completed scans. Surfaced both
//             on the iPad telemetry rail (when we land Phase H) and
//             in the phone's debug drawer.
//
// The ScannerScreen child handles the visual composition + camera; this
// file is purely orchestration.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogBox, Platform, StyleSheet } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Suppress the yellow LogBox warning banner. It interpose-blocks the
// Start-scan button at the bottom of the screen during agent-device
// driven test runs. Production wouldn't have it (release builds
// disable LogBox), but in dev it gets in the way of automation.
LogBox.ignoreAllLogs(true);

const TAG = '[DLScan]';
console.log(TAG, 'App module loaded', Platform.OS, Platform.Version);

function writeScanResult(data: Record<string, unknown>, scanNum: number) {
  const dir = `${FileSystem.documentDirectory}dlscan-results/`;
  const file = `${dir}scan-${scanNum}.json`;
  FileSystem.makeDirectoryAsync(dir, { intermediates: true })
    .then(() =>
      FileSystem.writeAsStringAsync(file, JSON.stringify(data, null, 2))
    )
    .then(() => console.log(TAG, `SCAN_SAVED ${file}`))
    .catch((e) => console.warn(TAG, 'writeScanResult failed', e));
}

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import type { LicenseData } from 'react-native-dl-scan';
import { useTokens } from './theme/useTokens';
import { useTweaks } from './hooks/useTweaks';
import { useDeviceLayout } from './hooks/useDeviceLayout';
import { ScannerScreen, type Phase } from './components/ScannerScreen';
import { DebugDrawer, type RecentScanSummary } from './components/DebugDrawer';
import { TIER_RANK, type ConfidenceTier } from './theme/tokens';

// Phase H follow-up: `useDeviceLayout` + `useSafeAreaInsets` will land
// here to drive landscape branching and the tablet split-pane. The
// phone-portrait layout is the design's primary; H is additive.

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const { tweaks, setTweak } = useTweaks();
  const { t, direction, statusBarStyle } = useTokens(
    tweaks.direction,
    tweaks.theme
  );
  // Phase H Wave 2B: read device class here so onScanAgain can skip the
  // FlipCard unwind delay on tablet (where the result swap is a sibling
  // pane crossfade rather than a card flip). useScannerInternals also
  // calls useDeviceLayout — duplicate calls are cheap (useWindowDimensions
  // is shared / deduped by RN core).
  const { deviceClass } = useDeviceLayout();

  const [mode, setMode] = useState<'barcode' | 'ocr'>('ocr');
  const [phase, setPhaseRaw] = useState<Phase>('idle');
  const setPhase = (p: Phase) => {
    console.log(TAG, 'PHASE', p);
    setPhaseRaw(p);
  };
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [recentScans, setRecentScans] = useState<RecentScanSummary[]>([]);
  // Scan-session epoch. Increments on every new scan (start or scan-again)
  // and is used as a React key on ScannerScreen so the scanner-runtime
  // hook tree fully remounts — fresh useLicenseScanner state, no chance
  // of stale-closure passive effects from the previous session firing
  // with the previous scan's licenseData. round-6 review recommendation
  // for the "Scan again instantly re-emits prior result" bug. The prior
  // useLayoutEffect+ref-guard fix was unsound because passive effects
  // can close over pre-reset state.
  const [scanSessionId, setScanSessionId] = useState(0);

  // Fire a haptic on capture transition (Phase G wireable knob).
  useEffect(() => {
    if (phase === 'captured' && tweaks.haptic) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [phase, tweaks.haptic]);

  // Auto-fallback timer — when enabled, in barcode mode, mid-scan,
  // count down; on hitting zero, flip mode to 'ocr' and reset the
  // timer. The visual countdown ring is owned by Viewfinder; this
  // hook just owns the policy.
  const [fallbackRemaining, setFallbackRemaining] = useState<number | null>(
    null
  );
  useEffect(() => {
    if (!tweaks.autoFallback || mode !== 'barcode' || phase !== 'scanning') {
      setFallbackRemaining(null);
      return;
    }
    let remaining = tweaks.fallbackSec;
    setFallbackRemaining(remaining);
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(id);
        setMode('ocr');
        setFallbackRemaining(null);
        return;
      }
      setFallbackRemaining(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [tweaks.autoFallback, tweaks.fallbackSec, mode, phase]);

  // Drive the phase machine. ScannerScreen reports captured / pipeline /
  // result transitions; we own the canonical state.
  const onStart = useCallback(() => {
    console.log(TAG, 'SCAN_START', mode);
    setPhase('scanning');
  }, [mode]);
  const onStop = useCallback(() => {
    console.log(TAG, 'SCAN_STOP');
    setPhase('idle');
  }, []);
  const onScanAgain = useCallback(() => {
    setLicenseData(null);
    setPhase('idle');
    hasRecordedResultRef.current = false;
    // Bump the session epoch so ScannerScreen remounts with a fresh
    // useLicenseScanner. Without this, the prior scan's hook state
    // can leak into the new scanning phase via a stale-closure
    // passive effect, re-emitting the previous result instantly.
    setScanSessionId((id) => id + 1);
    // Phone: the result card flips back via FlipCard; wait for that
    // animation (~220ms) before restarting the scanner so the user sees
    // the unwind. Tablet: result is a sibling pane, no flip — skip the
    // wait so re-scan is instant.
    if (deviceClass === 'tablet') {
      setPhase('scanning');
    } else {
      setTimeout(() => setPhase('scanning'), 220);
    }
  }, [deviceClass]);
  // Sentinel: have we already done the write-once side effects for the
  // current logical scan (file write, count bump, recent-scans append)?
  // Reset on onScanAgain. review review (Phase H): side effects in a
  // setLicenseData functional updater would double-fire under React
  // Strict Mode (dev). Gate via ref so updaters stay pure.
  const hasRecordedResultRef = useRef(false);

  const onResult = useCallback(
    (data: LicenseData) => {
      // useLicenseScanner may emit multiple OCR frames before phase
      // advances out of 'scanning' (early-exit threshold settles in a
      // couple of frames). First emit: side effects + set gate. Later
      // emits: just refresh the held data.
      if (hasRecordedResultRef.current) {
        setLicenseData(data);
        return;
      }
      hasRecordedResultRef.current = true;
      const num = scanCount + 1;
      console.log(TAG, 'SCAN_RESULT', JSON.stringify(data));
      writeScanResult(data as unknown as Record<string, unknown>, num);
      setScanCount(num);
      setRecentScans((rs) => [buildRecent(data, mode), ...rs].slice(0, 50));
      setLicenseData(data);
    },
    [scanCount, mode]
  );

  // Mode change resets the scan — match the design's onModeChange.
  const onModeChange = useCallback(
    (m: 'barcode' | 'ocr') => {
      if (m === mode) return;
      setMode(m);
      if (phase !== 'result') setPhase('idle');
    },
    [mode, phase]
  );

  return (
    // Phase H Wave 2B: edges={[]} — explicit empty, NOT omitted (omitting
    // falls back to all four edges per react-native-safe-area-context
    // defaults). Each shell (phone-portrait / phone-landscape / tablet)
    // applies its own insets via useSafeAreaInsets so they can place the
    // padding precisely (e.g. tablet's left rail vs right pane). Keeping
    // the SafeAreaView itself preserves the existing background fill
    // behavior under the status bar without touching layout flow.
    <SafeAreaView
      style={[styles.container, { backgroundColor: t.bg }]}
      edges={[]}
    >
      <StatusBar style={statusBarStyle} />
      <ScannerScreen
        key={scanSessionId}
        mode={mode}
        onModeChange={onModeChange}
        phase={phase}
        setPhase={setPhase}
        licenseData={licenseData}
        onResult={onResult}
        onStart={onStart}
        onStop={onStop}
        onScanAgain={onScanAgain}
        onShowDebug={() => setShowDebug(true)}
        scanCount={scanCount}
        tweaks={tweaks}
        setTweak={setTweak}
        fallbackRemaining={fallbackRemaining}
        recentScans={recentScans}
      />
      {showDebug && (
        <DebugDrawer
          data={licenseData}
          mode={mode}
          t={t}
          direction={direction}
          tweaks={tweaks}
          setTweak={setTweak}
          recentScans={recentScans}
          onClose={() => setShowDebug(false)}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Build a one-line summary for the recent-scans queue. Average score
 * is the mean of the per-field score; avgTier is the highest tier
 * observed across the fields (≥ shape_matched at minimum to dodge
 * "Allow all" mode's noise).
 */
function buildRecent(
  data: LicenseData,
  mode: 'barcode' | 'ocr'
): RecentScanSummary {
  const entries = Object.values(data.dataConfidence ?? {});
  const avg =
    entries.length === 0
      ? 0
      : entries.reduce((s, e) => s + e.score, 0) / entries.length;
  let bestTier: ConfidenceTier = 'extracted_raw';
  let bestRank = -1;
  entries.forEach((e) => {
    const r = TIER_RANK[e.tier];
    if (r > bestRank) {
      bestRank = r;
      bestTier = e.tier;
    }
  });
  const name =
    [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Unknown';
  return { name, mode, avgScore: avg, avgTier: bestTier };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
