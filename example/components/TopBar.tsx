// Top bar — eyebrow + title (Scan license / Captured) + session
// counter (Phase F-G of task #71).

import { View, Text, StyleSheet } from 'react-native';
import type { ThemeTokens } from '../theme/tokens';
import type { Phase } from './ScannerScreen';

export function TopBar({
  t,
  phase,
  scanCount,
}: {
  t: ThemeTokens;
  phase: Phase;
  scanCount: number;
}) {
  const title = phase === 'result' ? 'Captured' : 'Scan license';
  return (
    <View style={styles.host}>
      <View>
        <Text style={[styles.eyebrow, { fontFamily: t.mono, color: t.ink3 }]}>
          react-native-dl-scan
        </Text>
        <Text style={[styles.title, { fontFamily: t.display, color: t.ink }]}>
          {title}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.eyebrow, { fontFamily: t.mono, color: t.ink3 }]}>
          Session
        </Text>
        <Text style={[styles.count, { fontFamily: t.mono, color: t.ink }]}>
          {String(scanCount).padStart(3, '0')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  right: { alignItems: 'flex-end' },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: 1,
    letterSpacing: -0.65,
    lineHeight: 28.6,
  },
  count: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.18,
  },
});
