/* eslint-env jest */

// Setup for React Native Testing Library
// Mock native modules
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => ({
  get: jest.fn(() => ({
    scanLicense: jest.fn(),
    parseOCRText: jest.fn(),
    // Default feature flags mock
    commonTestFlag_shouldUseNewFeature: jest.fn().mockReturnValue(false),
  })),
  getEnforcing: jest.fn(() => ({
    scanLicense: jest.fn(),
    parseOCRText: jest.fn(),
    commonTestFlag_shouldUseNewFeature: jest.fn().mockReturnValue(false),
  })),
}));

// Mock React Native Feature Flags
jest.mock(
  'react-native/src/private/featureflags/specs/NativeReactNativeFeatureFlags',
  () => ({
    get: jest.fn(() => ({})),
    getEnforcing: jest.fn(() => ({})),
  })
);

// Mock NativeDeviceInfo
jest.mock('react-native/src/private/specs_DEPRECATED/modules/NativeDeviceInfo', () => ({
  getConstants: jest.fn(() => ({
    Dimensions: {
      windowPhysicalPixels: {
        width: 375,
        height: 667,
        scale: 2.0,
        fontScale: 1.0,
      },
      screenPhysicalPixels: {
        width: 375,
        height: 667,
        scale: 2.0,
        fontScale: 1.0,
      },
    },
  })),
}));

// Mock react-native-reanimated more comprehensively
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  // Add any additional functions if needed
  return {
    ...Reanimated,
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    createAnimatedComponent: (component) => component,
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (fn) => fn(),
    withTiming: (value) => value,
    withSpring: (value) => value,
  };
});

// Global test configuration
global.__DEV__ = true;

// Configure timers - only for tests that use fake timers
afterEach(() => {
  // Only run pending timers if fake timers are in use
  if (jest.isMockFunction(setTimeout)) {
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
  }
});
