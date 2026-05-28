// Debug drawer (Phase E of task #71).
//
// Bottom-sheet modal accessible via the beaker icon on the result
// screen. Per the chat with the designer the drawer exposes:
//   1. Scanner settings (only the WIREABLE knobs — see hooks/useTweaks)
//   2. Pipeline stage list
//   3. Recent scans
//   4. Tier semantics legend
//   5. Raw JSON payload
//
// Codex round-2 scope decision: build only the knobs the lib actually
// honors. Camera rotation, voting frames, MRZ fallback, and sound are
// filed as tasks #72/#73/#74 and deliberately omitted from this UI.

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';

const OCR_BACKEND_LABEL = Platform.OS === 'ios' ? 'VisionKit OCR' : 'MLKit OCR';
import {
  TIER_RANK,
  tierColor,
  type ThemeTokens,
  type Direction,
  type ConfidenceTier,
} from '../theme/tokens';
import type { Tweaks, SetTweak } from '../hooks/useTweaks';
import type { LicenseData } from 'react-native-dl-scan';
import { IconCheck } from '../icons';
import { AcknowledgmentsScreen } from './AcknowledgmentsScreen';

export type DebugMode = 'barcode' | 'ocr';

export interface RecentScanSummary {
  /** Display name composed from firstName + lastName. */
  name: string;
  mode: DebugMode;
  /** Aggregate score in [0, 1] (mean of per-field scores). */
  avgScore: number;
  /** Highest tier observed (matches highest individual field tier). */
  avgTier: ConfidenceTier;
}

export interface DebugDrawerProps {
  /** The license data being inspected. Source of truth for the raw
   *  JSON payload + the per-field confidence summary. */
  data: LicenseData | null;
  mode: DebugMode;
  t: ThemeTokens;
  direction: Direction;
  tweaks: Tweaks;
  setTweak: SetTweak;
  recentScans: RecentScanSummary[];
  onClose: () => void;
}

const STAGES_BARCODE = [
  'camera frame',
  'PDF417 decoder',
  'JS → Nitro JNI',
  'C++ AAMVA resolver',
  'tier classifier',
];
const STAGES_OCR = [
  'camera frame',
  OCR_BACKEND_LABEL,
  'JS → Nitro JNI',
  'C++ field extractor',
  '4-gate voter',
];

const TIER_HELP: Array<[ConfidenceTier, string]> = [
  [
    'cross_validated',
    'Two independent checks agree (e.g. PDF417 + OCR consensus)',
  ],
  ['all_gates_passed', '4-gate strict demographic parser'],
  ['shape_matched', 'Value matches expected regex shape'],
  ['extracted_raw', 'Pulled from text pool, no content check'],
];

export function DebugDrawer({
  data,
  mode,
  t,
  direction,
  tweaks,
  setTweak,
  recentScans,
  onClose,
}: DebugDrawerProps) {
  const stages = mode === 'barcode' ? STAGES_BARCODE : STAGES_OCR;
  const [showAcks, setShowAcks] = useState(false);
  const json = useMemo(
    () => (data == null ? '{}' : JSON.stringify(data, null, 2)),
    [data]
  );

  return (
    <View style={styles.scrim}>
      <Pressable style={styles.scrimTap} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.bg }]}>
        <View style={[styles.grabber, { backgroundColor: t.ink4 }]} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text
              style={[
                styles.headerEyebrow,
                { fontFamily: t.mono, color: t.ink3 },
              ]}
            >
              DEBUG
            </Text>
            <Text style={[styles.headerTitle, { color: t.ink }]}>
              Parse pipeline
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={[
              styles.closeBtn,
              { backgroundColor: t.surface, borderColor: t.hairline },
            ]}
          >
            <Text style={{ color: t.ink2, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel t={t}>Scanner settings</SectionLabel>
          <DebugSettings t={t} tweaks={tweaks} setTweak={setTweak} />

          <SectionLabel t={t}>Pipeline</SectionLabel>
          <View style={styles.stagesList}>
            {stages.map((s, i) => (
              <View
                key={s}
                style={[
                  styles.stageRow,
                  { backgroundColor: t.surface, borderColor: t.hairline },
                ]}
              >
                <Text
                  style={[
                    styles.stageIndex,
                    { fontFamily: t.mono, color: t.ink3 },
                  ]}
                >
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text
                  style={[
                    styles.stageLabel,
                    { fontFamily: t.mono, color: t.ink },
                  ]}
                >
                  {s}
                </Text>
                <IconCheck c={t.tierCV} />
              </View>
            ))}
          </View>

          {recentScans.length > 0 && (
            <>
              <SectionLabel t={t}>Recent scans · this session</SectionLabel>
              <View style={styles.stagesList}>
                {recentScans.slice(0, 8).map((s, i) => (
                  <RecentScanRow
                    key={i}
                    rank={recentScans.length - i}
                    summary={s}
                    t={t}
                  />
                ))}
              </View>
            </>
          )}

          <SectionLabel t={t}>Confidence tier semantics</SectionLabel>
          <View style={styles.tierLegend}>
            {TIER_HELP.map(([tier, desc]) => {
              const [fg, bg] = tierColor(t, tier);
              return (
                <View
                  key={tier}
                  style={[
                    styles.tierRow,
                    { backgroundColor: bg, borderColor: fg + '33' },
                  ]}
                >
                  <Text
                    style={[styles.tierKey, { fontFamily: t.mono, color: fg }]}
                  >
                    {tier}
                  </Text>
                  <Text style={[styles.tierDesc, { color: t.ink2 }]}>
                    {desc}
                  </Text>
                </View>
              );
            })}
          </View>

          <SectionLabel t={t}>Raw payload</SectionLabel>
          <View
            style={[
              styles.jsonWrap,
              {
                backgroundColor: direction === 'vellum' ? '#1a1611' : '#0a0a0c',
              },
            ]}
          >
            <Text
              selectable
              style={[
                styles.jsonText,
                {
                  fontFamily: t.mono,
                  color: direction === 'vellum' ? '#f6efde' : '#e4e4e7',
                },
              ]}
            >
              {json}
            </Text>
          </View>

          <SectionLabel t={t}>About</SectionLabel>
          <Pressable
            onPress={() => setShowAcks(true)}
            accessibilityRole="button"
            accessibilityLabel="Open open source licenses"
            style={[
              styles.aboutRow,
              { backgroundColor: t.surface, borderColor: t.hairline },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.aboutTitle, { color: t.ink }]}>
                Open source licenses
              </Text>
              <Text style={[styles.aboutSub, { color: t.ink2 }]}>
                Acknowledgments for every library this app uses
              </Text>
            </View>
            <Text
              style={[
                styles.aboutChevron,
                { fontFamily: t.mono, color: t.ink3 },
              ]}
            >
              →
            </Text>
          </Pressable>
        </ScrollView>
      </View>
      <AcknowledgmentsScreen
        visible={showAcks}
        onClose={() => setShowAcks(false)}
        t={t}
        direction={direction}
      />
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

function RecentScanRow({
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
  return (
    <View
      style={[
        styles.stageRow,
        { backgroundColor: t.surface, borderColor: t.hairline },
      ]}
    >
      <Text style={[styles.recentRank, { fontFamily: t.mono, color: t.ink3 }]}>
        #{String(rank).padStart(2, '0')}
      </Text>
      <Text numberOfLines={1} style={[styles.recentName, { color: t.ink }]}>
        {summary.name}
      </Text>
      <Text style={[styles.recentMode, { fontFamily: t.mono, color: t.ink3 }]}>
        {summary.mode}
      </Text>
      <Text style={[styles.recentPct, { fontFamily: t.mono, color: pctColor }]}>
        {pct}%
      </Text>
    </View>
  );
}

// ─── scanner settings panel ───────────────────────────────────────────────

interface DebugSettingsProps {
  t: ThemeTokens;
  tweaks: Tweaks;
  setTweak: SetTweak;
}

function DebugSettings({ t, tweaks, setTweak }: DebugSettingsProps) {
  return (
    <View style={styles.settingsBlock}>
      <SettingRow
        t={t}
        label="Auto-fallback"
        hint="Switch barcode→OCR after N seconds of no match"
      >
        <Toggle
          t={t}
          value={tweaks.autoFallback}
          onChange={(v) => setTweak('autoFallback', v)}
        />
      </SettingRow>
      {tweaks.autoFallback && (
        <SettingRow
          t={t}
          label="Fallback after"
          hint="Seconds before flipping to OCR mode"
        >
          <Stepper
            t={t}
            value={tweaks.fallbackSec}
            min={5}
            max={60}
            step={5}
            suffix="s"
            onChange={(v) => setTweak('fallbackSec', v)}
          />
        </SettingRow>
      )}

      <MinTierPicker
        t={t}
        value={tweaks.minTier}
        onChange={(v) => setTweak('minTier', v)}
      />

      <SettingRow t={t} label="Haptic on capture" hint={null}>
        <Toggle
          t={t}
          value={tweaks.haptic}
          onChange={(v) => setTweak('haptic', v)}
        />
      </SettingRow>

      <SettingRow t={t} label="Aesthetic" hint="Visual direction">
        <SegRadio
          t={t}
          value={tweaks.direction}
          options={[
            { value: 'onyx', label: 'Onyx' },
            { value: 'vellum', label: 'Vellum' },
            { value: 'lumen', label: 'Lumen' },
          ]}
          onChange={(v) => setTweak('direction', v)}
        />
      </SettingRow>

      <SettingRow t={t} label="Theme" hint="Auto follows OS appearance">
        <SegRadio
          t={t}
          value={tweaks.theme}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => setTweak('theme', v)}
        />
      </SettingRow>

      <SettingRow t={t} label="Fixture button" hint={null}>
        <Toggle
          t={t}
          value={tweaks.showFixture}
          onChange={(v) => setTweak('showFixture', v)}
        />
      </SettingRow>

      <SettingRow t={t} label="Pipeline animation" hint={null}>
        <Toggle
          t={t}
          value={tweaks.showPipeline}
          onChange={(v) => setTweak('showPipeline', v)}
        />
      </SettingRow>
    </View>
  );
}

function SettingRow({
  t,
  label,
  hint,
  children,
}: {
  t: ThemeTokens;
  label: string;
  hint: string | null;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.settingRow,
        { backgroundColor: t.surface, borderColor: t.hairline },
      ]}
    >
      <View style={styles.settingLabelCol}>
        <Text
          style={[styles.settingLabel, { fontFamily: t.mono, color: t.ink3 }]}
        >
          {label}
        </Text>
        {hint != null && (
          <Text style={[styles.settingHint, { color: t.ink3 }]}>{hint}</Text>
        )}
      </View>
      <View>{children}</View>
    </View>
  );
}

function Toggle({
  t,
  value,
  onChange,
}: {
  t: ThemeTokens;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[styles.toggle, { backgroundColor: value ? t.accent : t.ink4 }]}
    >
      <View style={[styles.toggleThumb, { left: value ? 16 : 2 }]} />
    </Pressable>
  );
}

function Stepper({
  t,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  t: ThemeTokens;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <View
      style={[
        styles.stepper,
        { backgroundColor: t.surface2, borderColor: t.hairline },
      ]}
    >
      <Pressable onPress={dec} style={styles.stepperBtn}>
        <Text style={[styles.stepperBtnText, { color: t.ink2 }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepperValue, { fontFamily: t.mono, color: t.ink }]}>
        {value}
        {suffix ?? ''}
      </Text>
      <Pressable onPress={inc} style={styles.stepperBtn}>
        <Text style={[styles.stepperBtnText, { color: t.ink2 }]}>+</Text>
      </Pressable>
    </View>
  );
}

function SegRadio<T extends string>({
  t,
  value,
  options,
  onChange,
}: {
  t: ThemeTokens;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View
      style={[
        styles.segGroup,
        { backgroundColor: t.surface2, borderColor: t.hairline },
      ]}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              styles.segBtn,
              on
                ? { backgroundColor: t.ink }
                : {
                    borderColor: t.hairline,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
            ]}
          >
            <Text
              style={{
                color: on ? t.bg : t.ink2,
                fontSize: 11.5,
                fontWeight: '600',
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MinTierPicker({
  t,
  value,
  onChange,
}: {
  t: ThemeTokens;
  value: ConfidenceTier;
  onChange: (v: ConfidenceTier) => void;
}) {
  const options: Array<{
    value: ConfidenceTier;
    label: string;
    hint: string;
  }> = [
    {
      value: 'extracted_raw',
      label: 'Allow all',
      hint: 'Keep everything, even raw text-pool extracts',
    },
    {
      value: 'shape_matched',
      label: 'Shape ↑',
      hint: 'Drop raw; keep values matching expected regex shape',
    },
    {
      value: 'all_gates_passed',
      label: 'Strict ↑',
      hint: 'Require the 4-gate demographic parser',
    },
    {
      value: 'cross_validated',
      label: 'Verified only',
      hint: 'Only fields confirmed by two independent checks',
    },
  ];
  return (
    <View style={styles.minTierBlock}>
      <Text
        style={[
          styles.settingLabel,
          { fontFamily: t.mono, color: t.ink3, marginBottom: 6 },
        ]}
      >
        Min confidence tier
        <Text style={{ color: t.ink4 }}>{'  '}— drop fields below this</Text>
      </Text>
      <View style={{ gap: 4 }}>
        {options.map((o) => {
          const on = value === o.value;
          const [fg] = tierColor(t, o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[
                styles.minTierRow,
                {
                  backgroundColor: on ? t.surface : 'transparent',
                  borderColor: on ? fg + '88' : t.hairline,
                  borderLeftColor: on ? fg : 'transparent',
                  borderLeftWidth: 3,
                },
              ]}
            >
              <View style={[styles.minTierDot, { backgroundColor: fg }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.minTierLabel, { color: t.ink }]}>
                  {o.label}
                </Text>
                <Text style={[styles.minTierHint, { color: t.ink3 }]}>
                  {o.hint}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Re-export the tier rank table from this file for App.tsx convenience.
export { TIER_RANK };

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scrimTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingTop: 6,
  },
  grabber: {
    width: 48,
    height: 6,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerLeft: {},
  headerEyebrow: {
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: -0.4,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionLabel: {
    fontSize: 10.5,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    fontWeight: '600',
    paddingTop: 14,
    paddingBottom: 8,
  },
  settingsBlock: { gap: 6, marginBottom: 12 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  settingLabelCol: { flex: 1, minWidth: 0 },
  settingLabel: {
    fontSize: 10.5,
    letterSpacing: 0.85,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  settingHint: { fontSize: 11, marginTop: 2, lineHeight: 14.85 },
  toggle: {
    position: 'relative',
    width: 36,
    height: 22,
    borderRadius: 999,
  },
  toggleThumb: {
    position: 'absolute',
    top: 2,
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 3,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepperBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { fontSize: 14, fontWeight: '600' },
  stepperValue: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 12.5,
    fontWeight: '700',
  },
  segGroup: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  minTierBlock: {
    paddingHorizontal: 2,
    paddingTop: 4,
  },
  minTierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  minTierDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  minTierLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.06,
  },
  minTierHint: {
    fontSize: 10.5,
    marginTop: 1,
    lineHeight: 14.18,
  },
  stagesList: { gap: 6, marginBottom: 12 },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stageIndex: { width: 18, fontSize: 10, fontWeight: '700' },
  stageLabel: { flex: 1, fontSize: 12.5 },
  recentRank: { width: 22, fontSize: 10, fontWeight: '700' },
  recentName: { flex: 1, fontSize: 13 },
  recentMode: {
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recentPct: {
    fontSize: 11,
    fontWeight: '700',
  },
  tierLegend: { gap: 6, marginBottom: 12 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tierKey: {
    fontSize: 10,
    fontWeight: '700',
    minWidth: 120,
  },
  tierDesc: { fontSize: 12, flex: 1, lineHeight: 16.8 },
  jsonWrap: { padding: 14, borderRadius: 10, marginBottom: 4 },
  jsonText: { fontSize: 10.5, lineHeight: 16.275 },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  aboutTitle: { fontSize: 14, fontWeight: '600' },
  aboutSub: { fontSize: 12, marginTop: 2 },
  aboutChevron: { fontSize: 18 },
});
