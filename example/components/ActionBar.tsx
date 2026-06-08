// Action bar — fixture button + primary Start scan / Scanning…
// (Phase F-G of task #71).

import { View, Pressable, Text, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native';
import type { ThemeTokens } from '../theme/tokens';
import { IconBeaker } from '../icons';
import type { Phase } from './ScannerScreen';

export function ActionBar({
  t,
  phase,
  onStart,
  onStop,
  onScanAgain,
  showFixture,
  onRunFixture,
}: {
  t: ThemeTokens;
  phase: Phase;
  onStart: () => void;
  onStop: () => void;
  onScanAgain?: () => void;
  showFixture: boolean;
  onRunFixture: () => void;
}) {
  const scanning = phase === 'scanning';
  // In the result phase the primary button must RESET the scanner via
  // onScanAgain (remounts useLicenseScanner + clears the native voter).
  // Calling onStart here only flips phase back to 'scanning'; the stale
  // hook state then re-emits the PRIOR result instantly with no fresh
  // frames — the "Start scan just shows the last scan again" bug.
  const inResult = phase === 'result';
  const primaryPress = scanning
    ? onStop
    : inResult && onScanAgain
      ? onScanAgain
      : onStart;
  const primaryLabel = scanning
    ? 'Stop scanning'
    : inResult && onScanAgain
      ? 'Scan again'
      : 'Start scan';
  return (
    <View style={styles.host}>
      {showFixture && (
        <Pressable
          onPress={onRunFixture}
          accessibilityLabel="Run AAMVA fixture"
          style={[
            styles.fixture,
            { backgroundColor: t.surface, borderColor: t.ink4 },
          ]}
        >
          <IconBeaker c={t.ink2} />
          <View style={[styles.devTag, { backgroundColor: t.ink }]}>
            <Text
              style={[styles.devTagText, { fontFamily: t.mono, color: t.bg }]}
            >
              DEV
            </Text>
          </View>
        </Pressable>
      )}
      <Pressable
        onPress={primaryPress}
        accessibilityLabel={primaryLabel}
        style={[
          styles.primary,
          {
            backgroundColor: scanning ? t.surface : t.ink,
            borderColor: scanning ? t.hairline : undefined,
            borderWidth: scanning ? StyleSheet.hairlineWidth : 0,
          },
        ]}
      >
        {scanning ? (
          <View style={styles.primaryRow}>
            <ActivityIndicator color={t.ink2} size="small" />
            <Text style={[styles.primaryLabel, { color: t.ink2 }]}>
              Stop scanning
            </Text>
          </View>
        ) : (
          <View style={styles.primaryRow}>
            <View
              style={[
                styles.accentDot,
                {
                  backgroundColor: t.accent,
                  shadowColor: t.accent,
                  shadowOpacity: 0.6,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 4,
                },
              ]}
            />
            <Text style={[styles.primaryLabel, { color: t.bg }]}>
              {primaryLabel}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  fixture: {
    height: 54,
    width: 54,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  devTag: {
    position: 'absolute',
    top: -4,
    right: -4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  devTagText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  primary: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryLabel: {
    fontSize: 15.5,
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  accentDot: { width: 10, height: 10, borderRadius: 999 },
});
