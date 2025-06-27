declare module 'react-native-gesture-handler' {
  import type { ComponentType, ReactNode } from 'react';

  export interface GestureType {
    Pan: () => GestureType;
    Pinch: () => GestureType;
    Rotation: () => GestureType;
    Tap: () => GestureType;
    onBegin: (fn: (event?: any) => void) => GestureType;
    onUpdate: (fn: (event?: any) => void) => GestureType;
    onEnd: (fn: (event?: any) => void) => GestureType;
    onFinalize: (fn: (event?: any) => void) => GestureType;
    onChange: (fn: (event?: any) => void) => GestureType;
    withSpring: () => GestureType;
    enabled: (enabled: boolean) => GestureType;
    maxPointers: (max: number) => GestureType;
    minPointers: (min: number) => GestureType;
    shouldCancelWhenOutside: (should: boolean) => GestureType;
    onStart: (fn: () => void) => GestureType;
    runOnJS: (runOnJS: boolean) => GestureType;
    simultaneousWithExternalGesture: (gesture: GestureType) => GestureType;
    numberOfTaps: (taps: number) => GestureType;
    numberOfPointers: (pointers: number) => GestureType;
    Simultaneous: (...gestures: GestureType[]) => GestureType;
  }

  export const Gesture: GestureType;

  export interface GestureDetectorProps {
    gesture: GestureType;
    children: ReactNode;
  }

  export const GestureDetector: ComponentType<GestureDetectorProps>;
  export const GestureHandlerRootView: ComponentType<{ children: ReactNode }>;

  export const State: {
    BEGAN: number;
    FAILED: number;
    ACTIVE: number;
    CANCELLED: number;
    END: number;
    UNDETERMINED: number;
  };

  export const Directions: {
    RIGHT: number;
    LEFT: number;
    UP: number;
    DOWN: number;
  };

  export const PanGestureHandler: ComponentType<any>;
  export const TapGestureHandler: ComponentType<any>;
  export const PinchGestureHandler: ComponentType<any>;
  export const TouchableOpacity: ComponentType<any>;
  export function gestureHandlerRootHOC<T>(
    Component: ComponentType<T>
  ): ComponentType<T>;

  export const GestureStateManager: {
    create: () => void;
  };
}
