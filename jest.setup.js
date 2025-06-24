/* eslint-env jest */

// Setup for React Native Testing Library
// Mock native modules - comprehensive TurboModuleRegistry mocking
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

// Mock TurboModuleRegistry for Reanimated compatibility
global.TurboModuleRegistry = {
  get: jest.fn(() => null),
  getEnforcing: jest.fn(() => null),
};

// Mock React Native Feature Flags
jest.mock(
  'react-native/src/private/featureflags/specs/NativeReactNativeFeatureFlags',
  () => ({
    get: jest.fn(() => ({})),
    getEnforcing: jest.fn(() => ({})),
  })
);

// Mock NativeDeviceInfo
jest.mock(
  'react-native/src/private/specs_DEPRECATED/modules/NativeDeviceInfo',
  () => ({
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
  })
);

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

// Auto-mock these modules - Jest will use __mocks__ directory
jest.mock('react-native-svg');
jest.mock('react-native-vision-camera');
jest.mock('expo-haptics');

// Mock React Native modules that might be missing
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');

  // Add any missing mocks
  Object.defineProperty(RN, 'NativeModules', {
    value: {
      ...RN.NativeModules,
      DlScan: {
        scanLicense: jest.fn(),
        parseOCRText: jest.fn(),
      },
      // Add other native modules if needed
    },
    writable: true,
    configurable: true,
  });

  // Mock Platform if needed
  Object.defineProperty(RN, 'Platform', {
    value: {
      OS: 'ios',
      select: jest.fn((obj) => obj.ios || obj.default),
      Version: '14.0',
      constants: {},
    },
    writable: true,
    configurable: true,
  });

  return RN;
});

// Global test configuration
global.__DEV__ = true;

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Configure timers - only for tests that use fake timers
afterEach(() => {
  // Only run pending timers if fake timers are in use
  if (jest.isMockFunction(setTimeout)) {
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
  }
});
