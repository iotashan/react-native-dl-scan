// Orientation + device-class detection for the dl-scan example app
// (Phase B of task #71).
//
// Drives:
//   - phone vs tablet layout switch in App.tsx (the design auto-selects
//     iPad at viewports ≥1180; we use the SAME 1180px threshold against
//     the longer screen edge so it works in either orientation)
//   - landscape branch in ScannerScreen (the design's prototype rotated
//     the phone-frame mock 90deg; the RN app reads the real orientation
//     instead — review's Phase A note)
//
// Re-renders on rotation are driven by `useWindowDimensions()`, which
// is part of React Native core (no extra dep). No expo-screen-orientation
// — that's only needed if we WROTE to orientation; we just observe it.

import { useWindowDimensions } from 'react-native';

export type DeviceClass = 'phone' | 'tablet';

export interface DeviceLayout {
  width: number;
  height: number;
  /** True when width > height — current physical orientation. */
  isLandscape: boolean;
  /**
   * Phone vs tablet. Compares the LONGER screen edge to the design's
   * 1180px breakpoint so it doesn't oscillate when the user rotates a
   * device that's near the threshold (an iPad mini in portrait is
   * 744×1133 — under threshold; landscape 1133×744 still under). Real
   * iPad Air 11" is 820×1180 portrait — at threshold; iPad Pro 12.9"
   * is 1024×1366 — well over.
   */
  deviceClass: DeviceClass;
}

const TABLET_BREAKPOINT_LONG_EDGE = 1180;

export function useDeviceLayout(): DeviceLayout {
  const { width, height } = useWindowDimensions();
  const longEdge = Math.max(width, height);
  return {
    width,
    height,
    isLandscape: width > height,
    deviceClass: longEdge >= TABLET_BREAKPOINT_LONG_EDGE ? 'tablet' : 'phone',
  };
}
