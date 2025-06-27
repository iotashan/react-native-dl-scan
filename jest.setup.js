/* eslint-env jest */

// Setup for React Native Testing Library
// NativeDlScan mock will be handled by __mocks__/src/NativeDlScan.js

// Mock native modules - defer to __mocks__ directory
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => {
  const dlScanMock = {
    scanLicense: jest.fn().mockResolvedValue({
      success: true,
      data: {
        firstName: 'RAPID',
        lastName: 'TEST',
        licenseNumber: 'TEST123',
        dateOfBirth: new Date('1990-01-01'),
        expirationDate: new Date('2025-01-01'),
        sex: 'M',
        address: {
          street: '123 TEST ST',
          city: 'TEST CITY',
          state: 'CA',
          postalCode: '90210',
        },
      },
    }),
    parseOCRText: jest.fn().mockResolvedValue({
      success: true,
      data: {
        firstName: 'RAPID',
        lastName: 'TEST',
        licenseNumber: 'TEST123',
      },
    }),
    startScanning: jest.fn().mockResolvedValue(undefined),
    stopScanning: jest.fn().mockResolvedValue(undefined),
    // iOS-specific methods
    configureVisionFramework: jest.fn().mockResolvedValue(undefined),
    enableHapticFeedback: jest.fn().mockResolvedValue(undefined),
  };

  // Store globally for test access
  global.__DL_SCAN_MOCK__ = dlScanMock;

  return {
    get: jest.fn((name) => {
      if (name === 'DlScan') return dlScanMock;
      return {
        commonTestFlag_shouldUseNewFeature: jest.fn().mockReturnValue(false),
      };
    }),
    getEnforcing: jest.fn((name) => {
      if (name === 'DlScan') return dlScanMock;
      return {
        commonTestFlag_shouldUseNewFeature: jest.fn().mockReturnValue(false),
      };
    }),
  };
});

// Mock TurboModuleRegistry for Reanimated compatibility (already handled above)

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
jest.mock('react-native-reanimated', () => ({
  default: {
    createAnimatedComponent: (component) => component,
    Value: jest.fn(),
    event: jest.fn(),
    add: jest.fn(),
    eq: jest.fn(),
    set: jest.fn(),
    cond: jest.fn(),
    interpolate: jest.fn(),
    View: 'Animated.View',
    Text: 'Animated.Text',
    Image: 'Animated.Image',
    ScrollView: 'Animated.ScrollView',
    FlatList: 'Animated.FlatList',
  },
  Easing: {
    linear: jest.fn(),
    ease: jest.fn(),
    quad: jest.fn(),
    cubic: jest.fn(),
    poly: jest.fn(),
    sin: jest.fn(),
    circle: jest.fn(),
    exp: jest.fn(),
    elastic: jest.fn(),
    back: jest.fn(),
    bounce: jest.fn(),
    bezier: jest.fn(),
    in: jest.fn(),
    out: jest.fn(),
    inOut: jest.fn(),
  },
  Extrapolate: {
    EXTEND: 'extend',
    CLAMP: 'clamp',
    IDENTITY: 'identity',
  },
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
  createAnimatedComponent: (component) => component,
  useSharedValue: (initial) => ({ value: initial }),
  useAnimatedStyle: (fn) => fn(),
  withTiming: (value) => value,
  withSpring: (value) => value,
  withDelay: (delay, animation) => animation,
  withRepeat: (animation) => animation,
  withSequence: (...animations) => animations[0],
  cancelAnimation: jest.fn(),
  useAnimatedGestureHandler: () => ({}),
  useAnimatedScrollHandler: () => ({}),
}));

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
      // DlScan to be added after global setup
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
      constants: {
        isTesting: true,
        osVersion: '14.0',
        reactNativeVersion: {
          major: 0,
          minor: 79,
          patch: 0,
        },
        systemName: 'iOS',
      },
      isDisableAnimations: false,
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

// Mock Permissions module for camera tests
jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {
    IOS: {
      CAMERA: 'ios.permission.CAMERA',
    },
    ANDROID: {
      CAMERA: 'android.permission.CAMERA',
    },
  },
  RESULTS: {
    UNAVAILABLE: 'unavailable',
    BLOCKED: 'blocked',
    DENIED: 'denied',
    GRANTED: 'granted',
    LIMITED: 'limited',
  },
  check: jest.fn().mockResolvedValue('granted'),
  request: jest.fn().mockResolvedValue('granted'),
  openSettings: jest.fn().mockResolvedValue(true),
}));
