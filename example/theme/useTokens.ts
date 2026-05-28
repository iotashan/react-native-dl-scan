// Resolved-theme hook for the dl-scan example app (Phase B of task #71).
//
// Wraps RN's `useColorScheme()` so:
//   - 'auto' → tracks the OS appearance live (Settings → Display & Brightness
//     flip → app re-renders without a remount)
//   - 'light' | 'dark' → forced, OS preference ignored
//
// Returns the resolved tokens AND a couple of derived values the rest
// of the app needs: the resolved mode (so consumers can branch on
// 'dark' vs 'light' for treatments not captured in tokens), and the
// `StatusBar` style hint per review's Phase A review note.

import { useColorScheme } from 'react-native';
import type { StatusBarStyle } from 'expo-status-bar';
import {
  TOKENS,
  type Direction,
  type ThemeMode,
  type ThemePreference,
  type ThemeTokens,
} from './tokens';

export interface ResolvedTheme {
  /** The full token palette for the active direction × mode. */
  t: ThemeTokens;
  /** The resolved theme mode after collapsing 'auto'. */
  mode: ThemeMode;
  /** The active aesthetic direction (passed through unchanged). */
  direction: Direction;
  /**
   * Recommended `style` prop for `<StatusBar />` so the system status
   * bar text contrasts the resolved theme. Status-bar style runs OFF
   * the resolved mode, not the direction — both Vellum-dark and
   * Onyx-dark want light bar text; both light modes want dark bar text.
   */
  statusBarStyle: StatusBarStyle;
}

export function useTokens(
  direction: Direction,
  theme: ThemePreference
): ResolvedTheme {
  const sys = useColorScheme();
  // Resolve 'auto': prefer the OS scheme; fall back to 'light' when the
  // OS reports `null` (this happens briefly during cold start on iOS
  // before the appearance proxy is wired up).
  const mode: ThemeMode =
    theme === 'auto' ? (sys === 'dark' ? 'dark' : 'light') : theme;
  return {
    t: TOKENS[direction][mode],
    mode,
    direction,
    statusBarStyle: mode === 'dark' ? 'light' : 'dark',
  };
}
