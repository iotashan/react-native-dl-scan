// Theme tokens for the dl-scan example app (Phase B of task #71).
//
// Three aesthetic directions × two color schemes = six concrete palettes,
// each producing a strongly-typed `ThemeTokens` value that the rest of
// the app consumes. Sourced from the design handoff at
//   /tmp/dl-scan-design/dl-scan-example-app/project/components.jsx
// (the `TOKENS` constant); ported here to TypeScript so consumers get
// autocomplete and compile-time checking on every `t.someKey` read.
//
// Direction guide:
//   onyx   — technical dark; neon-green accents; monospace + SF Pro
//   vellum — editorial light; warm paper + rust; Fraunces serif display
//   lumen  — premium iOS glass; purple→mint gradient; translucent surfaces
//
// Theme mode guide:
//   'auto' — resolved against the OS appearance (`useColorScheme()`),
//            with a fallback to 'light' when the OS reports `null` (rare,
//            but happens during cold start before the appearance proxy
//            updates).

import { Platform } from 'react-native';
import type { ConfidenceTier as LibConfidenceTier } from 'react-native-dl-scan';

export type Direction = 'onyx' | 'vellum' | 'lumen';
export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'auto';

// Re-export the lib's `ConfidenceTier` so consumers in this app can
// `import { ConfidenceTier } from './theme/tokens'` without learning
// the library's TS surface. Single source of truth, defined in
// react-native-dl-scan's src/types.ts.
export type ConfidenceTier = LibConfidenceTier;

// Font family tokens — Phase B review review note: React Native's
// `fontFamily` style prop does NOT parse CSS font stacks (e.g.
// "ui-monospace,'SF Mono',Menlo,monospace"). Passing a CSS stack
// silently falls back to the platform default. Until expo-font loads
// custom faces (Fraunces, IBM Plex Mono, Söhne — see Phase B+
// follow-up), use single-family names that exist on each platform.
//
// `undefined` for `display` means "platform default" — which is
// SF Pro on iOS and Roboto on Android. That's exactly the design's
// stated direction for onyx and lumen.
const SYSTEM_MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});
const SYSTEM_DISPLAY = Platform.select({
  ios: undefined, // SF Pro
  android: undefined, // Roboto / Google Sans Text
  default: undefined,
}) as string | undefined;
// Vellum direction wants a serif. Georgia is shipped on iOS and
// Android both, so it works without expo-font; swapping in Fraunces
// when fonts land is a one-line change here.
const VELLUM_DISPLAY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

/**
 * Strict shape of a resolved palette. Every direction × mode must
 * populate every key — the compiler enforces this. Adding a new token
 * means updating six palettes, not just one direction.
 *
 * Naming convention (carried over from the design):
 *   bg / surface / surface2 — three backdrop layers, lowest to highest
 *   hairline               — translucent border for chrome
 *   ink, ink2..4           — primary, secondary, tertiary, quaternary text
 *   accent / accentSoft    — brand accent + low-opacity tinted background
 *   tierCV/AG/SM/ER        — confidence-tier foreground colors
 *   tierCVbg/AGbg/SMbg/ERbg — confidence-tier background tints
 *   cardGrad               — license-hero gradient (CSS string; pulled
 *                            apart by LicenseHero into expo-linear-gradient
 *                            stops in Phase D)
 *   reticle                — color for the viewfinder corner brackets +
 *                            scanning sweep
 *   mono / display         — font-family stacks. Real fonts are loaded
 *                            in Phase B via expo-font; until then RN
 *                            picks the first installed face per platform.
 */
export interface ThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  hairline: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  accent: string;
  accentSoft: string;
  tierCV: string;
  tierCVbg: string;
  tierAG: string;
  tierAGbg: string;
  tierSM: string;
  tierSMbg: string;
  tierER: string;
  tierERbg: string;
  cardGrad: string;
  reticle: string;
  /** RN-ready single-family font name. `undefined` = platform default
   *  (SF Pro on iOS, Roboto on Android). Phase B+ may load custom faces
   *  via expo-font; until then, undefined is the correct value for any
   *  direction that wants the system display font. */
  mono: string | undefined;
  display: string | undefined;
}

const ONYX_LIGHT: ThemeTokens = {
  bg: '#f6f6f7',
  surface: '#ffffff',
  surface2: '#f0f0f3',
  hairline: 'rgba(0,0,0,0.08)',
  ink: '#0a0a0c',
  ink2: 'rgba(10,10,12,0.62)',
  ink3: 'rgba(10,10,12,0.4)',
  ink4: 'rgba(10,10,12,0.18)',
  accent: '#0a7d4f',
  accentSoft: 'rgba(10,125,79,0.12)',
  tierCV: '#0a7d4f',
  tierCVbg: 'rgba(10,125,79,0.14)',
  tierAG: '#1d4ed8',
  tierAGbg: 'rgba(29,78,216,0.12)',
  tierSM: '#92400e',
  tierSMbg: 'rgba(146,64,14,0.12)',
  tierER: 'rgba(10,10,12,0.45)',
  tierERbg: 'rgba(10,10,12,0.06)',
  cardGrad: 'linear-gradient(160deg,#fdfdfd,#eef0f4)',
  reticle: '#0a7d4f',
  mono: SYSTEM_MONO,
  display: SYSTEM_DISPLAY,
};

const ONYX_DARK: ThemeTokens = {
  bg: '#050507',
  surface: '#0e0e12',
  surface2: '#16161d',
  hairline: 'rgba(255,255,255,0.08)',
  ink: '#f4f4f5',
  ink2: 'rgba(244,244,245,0.62)',
  ink3: 'rgba(244,244,245,0.38)',
  ink4: 'rgba(244,244,245,0.16)',
  accent: '#00e07f',
  accentSoft: 'rgba(0,224,127,0.18)',
  tierCV: '#34d399',
  tierCVbg: 'rgba(52,211,153,0.16)',
  tierAG: '#60a5fa',
  tierAGbg: 'rgba(96,165,250,0.16)',
  tierSM: '#fbbf24',
  tierSMbg: 'rgba(251,191,36,0.16)',
  tierER: 'rgba(244,244,245,0.4)',
  tierERbg: 'rgba(244,244,245,0.06)',
  cardGrad: 'linear-gradient(160deg,#1c1f27,#0d0f14)',
  reticle: '#00e07f',
  mono: SYSTEM_MONO,
  display: SYSTEM_DISPLAY,
};

const VELLUM_LIGHT: ThemeTokens = {
  bg: '#ece5d7',
  surface: '#fbf8f1',
  surface2: '#ede5d3',
  hairline: 'rgba(34,30,22,0.12)',
  ink: '#1a1611',
  ink2: 'rgba(26,22,17,0.68)',
  ink3: 'rgba(26,22,17,0.46)',
  ink4: 'rgba(26,22,17,0.18)',
  accent: '#b5341c',
  accentSoft: 'rgba(181,52,28,0.14)',
  tierCV: '#2f7d52',
  tierCVbg: 'rgba(47,125,82,0.14)',
  tierAG: '#2d5fa0',
  tierAGbg: 'rgba(45,95,160,0.14)',
  tierSM: '#a96400',
  tierSMbg: 'rgba(169,100,0,0.14)',
  tierER: 'rgba(26,22,17,0.45)',
  tierERbg: 'rgba(26,22,17,0.06)',
  cardGrad: 'linear-gradient(160deg,#fbf8f1,#ece4d0)',
  reticle: '#b5341c',
  mono: SYSTEM_MONO,
  display: VELLUM_DISPLAY,
};

const VELLUM_DARK: ThemeTokens = {
  bg: '#1b1812',
  surface: '#23201a',
  surface2: '#2a2620',
  hairline: 'rgba(245,236,217,0.1)',
  ink: '#f6efde',
  ink2: 'rgba(246,239,222,0.7)',
  ink3: 'rgba(246,239,222,0.45)',
  ink4: 'rgba(246,239,222,0.18)',
  accent: '#e87a4a',
  accentSoft: 'rgba(232,122,74,0.18)',
  tierCV: '#7ab98a',
  tierCVbg: 'rgba(122,185,138,0.16)',
  tierAG: '#7da9e0',
  tierAGbg: 'rgba(125,169,224,0.16)',
  tierSM: '#e0a456',
  tierSMbg: 'rgba(224,164,86,0.16)',
  tierER: 'rgba(246,239,222,0.42)',
  tierERbg: 'rgba(246,239,222,0.06)',
  cardGrad: 'linear-gradient(160deg,#2d2820,#1a1712)',
  reticle: '#e87a4a',
  mono: SYSTEM_MONO,
  display: VELLUM_DISPLAY,
};

const LUMEN_LIGHT: ThemeTokens = {
  bg: '#eef0fb',
  surface: 'rgba(255,255,255,0.7)',
  surface2: 'rgba(255,255,255,0.5)',
  hairline: 'rgba(20,20,40,0.1)',
  ink: '#0a0a14',
  ink2: 'rgba(10,10,20,0.65)',
  ink3: 'rgba(10,10,20,0.42)',
  ink4: 'rgba(10,10,20,0.18)',
  accent: '#6d3aff',
  accentSoft: 'rgba(109,58,255,0.16)',
  tierCV: '#0d9469',
  tierCVbg: 'rgba(13,148,105,0.14)',
  tierAG: '#1d5fcc',
  tierAGbg: 'rgba(29,95,204,0.14)',
  tierSM: '#b06000',
  tierSMbg: 'rgba(176,96,0,0.14)',
  tierER: 'rgba(10,10,20,0.42)',
  tierERbg: 'rgba(10,10,20,0.06)',
  cardGrad:
    'linear-gradient(135deg,rgba(183,148,255,0.5),rgba(110,167,255,0.35) 50%,rgba(110,231,183,0.4))',
  reticle: '#6d3aff',
  mono: SYSTEM_MONO,
  display: SYSTEM_DISPLAY,
};

const LUMEN_DARK: ThemeTokens = {
  bg: '#07080d',
  surface: 'rgba(255,255,255,0.06)',
  surface2: 'rgba(255,255,255,0.1)',
  hairline: 'rgba(255,255,255,0.12)',
  ink: '#fafafe',
  ink2: 'rgba(250,250,254,0.7)',
  ink3: 'rgba(250,250,254,0.42)',
  ink4: 'rgba(250,250,254,0.2)',
  accent: '#b794ff',
  accentSoft: 'rgba(183,148,255,0.22)',
  tierCV: '#6ee7b7',
  tierCVbg: 'rgba(110,231,183,0.18)',
  tierAG: '#93c5fd',
  tierAGbg: 'rgba(147,197,253,0.18)',
  tierSM: '#fcd34d',
  tierSMbg: 'rgba(252,211,77,0.16)',
  tierER: 'rgba(250,250,254,0.4)',
  tierERbg: 'rgba(250,250,254,0.06)',
  cardGrad:
    'linear-gradient(135deg,rgba(183,148,255,0.28),rgba(110,167,255,0.18) 50%,rgba(110,231,183,0.22))',
  reticle: '#b794ff',
  mono: SYSTEM_MONO,
  display: SYSTEM_DISPLAY,
};

export const TOKENS: Record<Direction, Record<ThemeMode, ThemeTokens>> = {
  onyx: { light: ONYX_LIGHT, dark: ONYX_DARK },
  vellum: { light: VELLUM_LIGHT, dark: VELLUM_DARK },
  lumen: { light: LUMEN_LIGHT, dark: LUMEN_DARK },
};

/**
 * Tier label + rank tables. `ConfidenceTier` itself is re-exported at
 * the top of this file from `react-native-dl-scan` so we don't drift
 * from the lib's source of truth.
 */
export const TIER_LABEL: Record<ConfidenceTier, string> = {
  cross_validated: 'Cross-validated',
  all_gates_passed: 'Strict parse',
  shape_matched: 'Shape match',
  extracted_raw: 'Raw extract',
};

/**
 * Tier-rank ladder. Higher rank = stricter check passed. Used by the
 * minTier filter to decide whether a field is "dropped" — derived in
 * the UI per review's review (don't mutate the underlying dataConfidence
 * payload).
 */
export const TIER_RANK: Record<ConfidenceTier, number> = {
  extracted_raw: 0,
  shape_matched: 1,
  all_gates_passed: 2,
  cross_validated: 3,
};

/**
 * Lookup helper: [foregroundColor, backgroundColor] for a given tier
 * under the active palette. Mirrors the design's `tierColor(t, tier)`.
 */
export function tierColor(
  t: ThemeTokens,
  tier: ConfidenceTier
): [string, string] {
  switch (tier) {
    case 'cross_validated':
      return [t.tierCV, t.tierCVbg];
    case 'all_gates_passed':
      return [t.tierAG, t.tierAGbg];
    case 'shape_matched':
      return [t.tierSM, t.tierSMbg];
    case 'extracted_raw':
    default:
      return [t.tierER, t.tierERbg];
  }
}
