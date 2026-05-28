// SVG icon primitives for the dl-scan example app (Phase B of task #71).
//
// Ported from the design handoff's components.jsx — same viewBoxes,
// same path data. Implemented with react-native-svg primitives so they
// composite correctly under expo-blur backdrops and over the live
// Camera preview (HTML <svg> with style="position:absolute" works on
// the web; RN needs a real native node).
//
// Color is always an explicit prop (`c`), never inherited via CSS,
// because react-native-svg doesn't follow ancestor color styles —
// passing the resolved token color from the call site keeps theming
// explicit and avoids the "blank icon" foot-gun.

// React 19 + new JSX transform — no default React import needed for
// JSX in this file. Imports are limited to the SVG primitives we use.
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

interface IconProps {
  c: string;
  size?: number;
}

/** PDF417-style vertical bars — used for the barcode mode tab. */
export function IconBarcode({ c, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={c} strokeWidth={1.4}>
        <Path d="M3 5v14M5 5v14M7 5v14M9.5 5v14M12 5v14M14 5v14M16.5 5v14M19 5v14M21 5v14" />
      </G>
    </Svg>
  );
}

/** ID-card silhouette (portrait + lines + signature strip) — OCR mode tab. */
export function IconCard({ c, size = 20 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={1.4}
    >
      <Rect x={3} y={5} width={18} height={14} rx={2.5} />
      <Circle cx={9} cy={11} r={2} />
      <Path d="M14 10h5M14 13h4M6 16h12" strokeLinecap="round" />
    </Svg>
  );
}

/** Checkmark — pipeline-stage-complete + license-hero "Parsed" badge. */
export function IconCheck({ c, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M3 7.5l3 3 5-6"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Filled lightning bolt — pipeline section header. */
export function IconBolt({ c, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path d="M8 1L3 8h3l-1 5 5-7H7l1-5z" fill={c} />
    </Svg>
  );
}

/** Erlenmeyer-style beaker — fixture button + debug-drawer trigger. */
export function IconBeaker({ c, size = 20 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={1.4}
    >
      <Path d="M9 3v6l-5 9a3 3 0 003 4h10a3 3 0 003-4l-5-9V3" />
      <Path d="M9 3h6M8 14h8" strokeLinecap="round" />
    </Svg>
  );
}

/** Right-chevron — scan-again CTA trailing affordance. */
export function IconChevronRight({ c, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M5 3l5 5-5 5"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
