declare module 'react-native-svg' {
  import { ComponentType } from 'react';
  import { ViewProps } from 'react-native';

  export interface SvgProps extends ViewProps {
    width?: string | number;
    height?: string | number;
    viewBox?: string;
    preserveAspectRatio?: string;
  }

  export interface LineProps {
    x1?: string | number;
    y1?: string | number;
    x2?: string | number;
    y2?: string | number;
    stroke?: string;
    strokeWidth?: string | number;
    strokeDasharray?: string;
    strokeLinecap?: 'butt' | 'round' | 'square';
    opacity?: number;
  }

  export interface PathProps {
    d?: string;
    stroke?: string;
    strokeWidth?: string | number;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'miter' | 'round' | 'bevel';
    fill?: string;
    opacity?: number;
  }

  export const Svg: ComponentType<SvgProps>;
  export const Line: ComponentType<LineProps>;
  export const Path: ComponentType<PathProps>;

  export default Svg;
}
