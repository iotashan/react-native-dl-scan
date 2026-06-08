// In-memory tweaks state for the dl-scan example app (Phase B of task #71).
//
// Mirrors the design's TWEAK_DEFAULTS from dl-scan.html, scoped to the
// settings the React Native app actually exposes (per round-1
// "build only wireable knobs" scope decision). Three categories:
//
//   1. Aesthetic preferences — direction, theme. UI-only.
//   2. Dev affordances — showFixture, showPipeline. UI-only.
//   3. Scanner settings that ARE wireable through the existing hook
//      and orchestrator surface area:
//        - autoFallback (toggle) + fallbackSec (5..60s in 5s steps)
//          → App-level timer flips mode barcode→ocr.
//        - minTier → UI filter for FieldChip dropped state.
//        - haptic (toggle) → expo-haptics on phase=captured.
//
// NOT included (filed as follow-ups #72/#73/#74):
//   - votingFrames (hardcoded MAX_VOTING_FRAMES = 8 in the hook)
//   - cameraRotation (no orientation hint plumbed through native pipelines)
//   - mrzFallback (no MRZ scan path implemented)
//   - sound (low priority; would need expo-av or similar)
//
// AsyncStorage persistence deferred to Phase F per review's "schema first,
// persist later" guidance. Until then values reset on cold start.

import { useState, useCallback } from 'react';
import type { LicenseData, TtaMode } from 'react-native-dl-scan';
import type {
  Direction,
  ThemePreference,
  ConfidenceTier,
} from '../theme/tokens';

export interface Tweaks {
  /** Aesthetic direction. Default: 'lumen' (premium iOS glass — matches
   *  the design's TWEAK_DEFAULTS). */
  direction: Direction;
  /** Theme mode preference. Default: 'auto'. */
  theme: ThemePreference;
  /** Show the discreet beaker-icon AAMVA fixture button. Default: true. */
  showFixture: boolean;
  /** Animate the choreographed Camera → Pipeline → Result transition.
   *  When false, captured → result is direct. Default: true. */
  showPipeline: boolean;
  /** Switch barcode → ocr after `fallbackSec` seconds of unsuccessful
   *  scanning. Default: false. */
  autoFallback: boolean;
  /** Seconds before auto-fallback fires. 5..60 in 5s steps. Default: 30. */
  fallbackSec: number;
  /** Drop fields whose tier rank is below this. Default: 'shape_matched'. */
  minTier: ConfidenceTier;
  /** Fire a haptic on phase=captured. Default: true. */
  haptic: boolean;
  /** OCR completion policy — fields that must all be read before the scan
   *  finishes. The scan keeps accumulating passes until these are all present
   *  (or `maxPasses` is hit). */
  requiredFields: (keyof LicenseData)[];
  /** Hard cap on OCR consensus passes (2..50). Default 30. */
  maxPasses: number;
  /** Require one extra confirming pass after the required set is met. Default true. */
  validationPass: boolean;
  /** Re-parse the best retained crop at finalization. Default true. */
  ttaEnabled: boolean;
  /** Best-crop re-parse augmentations to apply when `ttaEnabled`. Default: all three. */
  ttaModes: TtaMode[];
}

/** Best-crop re-parse augmentation modes the settings UI lets the user toggle. */
export const TTA_MODE_OPTIONS: TtaMode[] = [
  'original',
  'blueChannel',
  'contrastStretch',
];

/** Fields the settings UI lets the user toggle into the required set. */
export const TOGGLEABLE_REQUIRED_FIELDS: (keyof LicenseData)[] = [
  'firstName',
  'middleName',
  'lastName',
  'street',
  'city',
  'state',
  'postalCode',
  'sex',
  'dateOfBirth',
  'licenseNumber',
  'height',
  'weight',
  'eyeColor',
  'hairColor',
  'vehicleClass',
  'expirationDate',
  'issueDate',
];

export const TWEAK_DEFAULTS: Tweaks = {
  direction: 'lumen',
  theme: 'auto',
  showFixture: true,
  showPipeline: true,
  autoFallback: false,
  fallbackSec: 30,
  minTier: 'shape_matched',
  haptic: true,
  requiredFields: [
    'firstName',
    'lastName',
    'street',
    'city',
    'state',
    'postalCode',
    'dateOfBirth',
    'licenseNumber',
    'sex',
  ],
  maxPasses: 30,
  validationPass: true,
  ttaEnabled: true,
  ttaModes: ['original', 'blueChannel', 'contrastStretch'],
};

/**
 * Single-key setter that takes a typed key and a typed value, then
 * narrows automatically. Callers write:
 *   setTweak('direction', 'onyx');         // ✓
 *   setTweak('autoFallback', true);        // ✓
 *   setTweak('autoFallback', 30);          // ✗ compile error
 */
export type SetTweak = <K extends keyof Tweaks>(
  key: K,
  value: Tweaks[K]
) => void;

export function useTweaks(initial: Tweaks = TWEAK_DEFAULTS) {
  const [tweaks, setTweaks] = useState<Tweaks>(initial);
  const setTweak: SetTweak = useCallback((key, value) => {
    setTweaks((prev) => ({ ...prev, [key]: value }));
  }, []);
  return { tweaks, setTweak };
}
