// TelemetryRail — display-only session telemetry for the tablet split-pane
// (Phase H Wave 2A).
//
// Right-side pane on tablet layouts. Shows:
//   - Header: SESSION label + current scan count (e.g. `002`)
//   - Scrollable list of last 50 `RecentScanSummary` entries
//       row: name · mode badge · avgScore percentage
//
// Out of scope for v1 (explicitly):
//   - Actions (NO scan-next, NO debug button). Actions stay in the
//     viewfinder column footer in ALL layouts per the Phase H spec.
//   - Tier distribution chart. `RecentScanSummary` doesn't carry tier
//     counts; deferred to v2 (would require data model change).
//   - Throughput stats.
//
// Visual treatment mirrors DebugDrawer's recent-scans rows so the two
// list-of-scans surfaces don't drift wildly. The spec accepts the
// duplication for v1 — extract a shared `RecentScanRow` component in
// v2 if drift becomes painful.

import { View, Text, ScrollView, StyleSheet } from 'react-native';
import type { ThemeTokens } from '../theme/tokens';
import type { RecentScanSummary } from './DebugDrawer';

export interface TelemetryRailProps {
  t: ThemeTokens;
  /** Total scans completed this session. Drives the header counter. */
  scanCount: number;
  /** Last-50 ring buffer of completed scans. Newest first. */
  recentScans: RecentScanSummary[];
}

export function TelemetryRail({
  t,
  scanCount,
  recentScans,
}: TelemetryRailProps) {
  return (
    <View
      style={[
        styles.host,
        {
          backgroundColor: t.surface,
          borderColor: t.hairline,
        },
      ]}
    >
      {/* Header — SESSION eyebrow + scan count. Matches the visual
       *  vocab of the rest of the app (mono eyebrow, display count). */}
      <View style={[styles.header, { borderBottomColor: t.hairline }]}>
        <Text style={[styles.eyebrow, { fontFamily: t.mono, color: t.ink3 }]}>
          Session
        </Text>
        <Text style={[styles.count, { fontFamily: t.mono, color: t.ink }]}>
          {String(scanCount).padStart(3, '0')}
        </Text>
      </View>

      {/* List body */}
      {recentScans.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: t.ink3 }]}>
            Scan history populates here as you process licenses.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          {recentScans.slice(0, 50).map((s, i) => (
            <RecentRow
              key={i}
              rank={recentScans.length - i}
              summary={s}
              t={t}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function RecentRow({
  rank,
  summary,
  t,
}: {
  rank: number;
  summary: RecentScanSummary;
  t: ThemeTokens;
}) {
  const pct = Math.round(summary.avgScore * 100);
  const pctColor = pct >= 95 ? t.tierCV : pct >= 85 ? t.tierAG : t.tierSM;
  const modeBadge = summary.mode === 'barcode' ? 'BAR' : 'OCR';
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: t.surface2, borderColor: t.hairline },
      ]}
    >
      <Text style={[styles.rank, { fontFamily: t.mono, color: t.ink3 }]}>
        #{String(rank).padStart(2, '0')}
      </Text>
      <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
        {summary.name}
      </Text>
      <Text style={[styles.mode, { fontFamily: t.mono, color: t.ink3 }]}>
        {modeBadge}
      </Text>
      <Text style={[styles.pct, { fontFamily: t.mono, color: pctColor }]}>
        {pct}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    minHeight: 0,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  count: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  scroll: { flex: 1 },
  scrollBody: { padding: 10, gap: 6 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 22, fontSize: 10, fontWeight: '700' },
  name: { flex: 1, fontSize: 13 },
  mode: {
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pct: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'right',
  },
});
