import Svg, { Path } from 'react-native-svg';
import type { CutoutRect } from './geometry';

export interface CutoutScrimProps {
  containerW: number;
  containerH: number;
  cutout: CutoutRect;
  dimOpacity?: number;
  cornerRadius?: number;
}

export function CutoutScrim({
  containerW,
  containerH,
  cutout,
  dimOpacity = 0.55,
  cornerRadius = 14,
}: CutoutScrimProps) {
  const { x, y, w, h } = cutout;
  const r = Math.min(cornerRadius, w / 2, h / 2);

  const outer = `M0,0 H${containerW} V${containerH} H0 Z`;
  const inner = [
    `M${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h - r}`,
    `Q${x + w},${y + h} ${x + w - r},${y + h}`,
    `H${x + r}`,
    `Q${x},${y + h} ${x},${y + h - r}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    'Z',
  ].join(' ');

  return (
    <Svg
      width={containerW}
      height={containerH}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      <Path
        d={`${outer} ${inner}`}
        fill={`rgba(0,0,0,${dimOpacity})`}
        fillRule="evenodd"
      />
    </Svg>
  );
}
