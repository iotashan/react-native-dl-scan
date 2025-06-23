import { jest } from '@jest/globals';

// Mock react-native-vision-camera and VisionCameraProxy
jest.mock('react-native-vision-camera', () => ({
  Camera: {
    getCameraDevice: jest.fn(),
    requestCameraPermission: jest.fn(() => Promise.resolve('granted')),
  },
  useCameraDevices: jest.fn(() => ({ back: {} })),
  useFrameProcessor: jest.fn(),
  VisionCameraProxy: {
    initFrameProcessorPlugin: jest.fn(() => ({
      call: jest.fn(),
    })),
  },
}));

// Mock TurboModuleRegistry for react-native-reanimated
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => ({
  get: jest.fn(() => ({
    installCoreFunctions: jest.fn(),
    makeShareableClone: jest.fn(),
  })),
  getEnforcing: jest.fn(() => ({
    installCoreFunctions: jest.fn(),
    makeShareableClone: jest.fn(),
  })),
}));

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  // The mock for `call` immediately calls the callback which is incorrect
  // So we override it with a no-op
  Reanimated.default.call = () => {};

  return Reanimated;
});

// Mock react-native-svg
jest.mock('react-native-svg', () => ({
  Svg: 'Svg',
  Circle: 'Circle',
  Ellipse: 'Ellipse',
  G: 'G',
  Text: 'Text',
  TSpan: 'TSpan',
  TextPath: 'TextPath',
  Path: 'Path',
  Polygon: 'Polygon',
  Polyline: 'Polyline',
  Line: 'Line',
  Rect: 'Rect',
  Use: 'Use',
  Image: 'Image',
  Symbol: 'Symbol',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  RadialGradient: 'RadialGradient',
  Stop: 'Stop',
  ClipPath: 'ClipPath',
  Pattern: 'Pattern',
  Mask: 'Mask',
}));

// Silence console warnings during tests unless NODE_ENV is 'test-verbose'
if (process.env.NODE_ENV !== 'test-verbose') {
  console.warn = jest.fn();
  console.error = jest.fn();
}