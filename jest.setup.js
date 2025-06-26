/* eslint-env jest */

// Setup for React Native Testing Library
// NativeDlScan mock will be handled by __mocks__/src/NativeDlScan.js

// Mock native modules - defer to __mocks__ directory
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => {
  const dlScanMock = {
    scanLicense: jest.fn().mockImplementation((barcodeData) => {
      // Simulate processing based on input
      if (!barcodeData || typeof barcodeData !== 'string') {
        return Promise.resolve({
          success: false,
          error: {
            code: 'INVALID_BARCODE_DATA',
            message: 'Invalid barcode data provided',
            userMessage: 'The barcode data is invalid. Please try scanning again.',
            recoverable: true,
          },
        });
      }

      // Simulate different responses based on barcode content for testing
      if (barcodeData.includes('invalid') || barcodeData.includes('INVALID')) {
        return Promise.resolve({
          success: false,
          error: {
            code: 'BARCODE_READ_ERROR',
            message: 'Could not read barcode data',
            userMessage: 'Unable to read the barcode. Please ensure the license is clearly visible.',
            recoverable: true,
          },
        });
      }

      if (barcodeData.includes('corrupted') || barcodeData.includes('CORRUPTED')) {
        return Promise.resolve({
          success: false,
          error: {
            code: 'CORRUPTED_BARCODE',
            message: 'Corrupted barcode data detected',
            userMessage: 'The barcode appears damaged. Please try with a different license.',
            recoverable: false,
          },
        });
      }

      // Default successful response with dynamic data based on input
      const testVariations = [
        {
          firstName: 'RAPID',
          lastName: 'TEST',
          licenseNumber: 'TEST123',
        },
        {
          firstName: 'JOHN',
          lastName: 'DOE',
          licenseNumber: 'DOE456',
        },
        {
          firstName: 'JANE',
          lastName: 'SMITH',
          licenseNumber: 'SMITH789',
        },
      ];

      // Use hash of barcode data to consistently return same result for same input
      const hash = barcodeData.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      const variation = testVariations[Math.abs(hash) % testVariations.length];

      return Promise.resolve({
        success: true,
        data: {
          ...variation,
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
      });
    }),
    parseOCRText: jest.fn().mockImplementation((textObservations) => {
      if (!textObservations || !Array.isArray(textObservations)) {
        return Promise.resolve({
          success: false,
          error: {
            code: 'INVALID_OCR_INPUT',
            message: 'Invalid OCR text observations provided',
            userMessage: 'Unable to process the image text. Please try again.',
            recoverable: true,
          },
        });
      }

      // Simulate OCR parsing logic
      const allText = textObservations.map(obs => obs.text).join(' ');
      const result = {
        firstName: 'RAPID',
        lastName: 'TEST',
        licenseNumber: 'TEST123',
      };

      // Basic OCR simulation - look for patterns in the text
      if (allText.includes('DOE')) {
        result.firstName = 'JOHN';
        result.lastName = 'DOE';
        result.licenseNumber = 'DOE456';
      } else if (allText.includes('SMITH')) {
        result.firstName = 'JANE';
        result.lastName = 'SMITH';
        result.licenseNumber = 'SMITH789';
      }

      // Simulate low confidence OCR failure
      const averageConfidence = textObservations.reduce((sum, obs) => sum + obs.confidence, 0) / textObservations.length;
      if (averageConfidence < 0.5) {
        return Promise.resolve({
          success: false,
          error: {
            code: 'LOW_OCR_CONFIDENCE',
            message: 'OCR confidence too low',
            userMessage: 'The text is not clear enough. Please improve lighting and try again.',
            recoverable: true,
          },
        });
      }

      return Promise.resolve({
        success: true,
        data: {
          ...result,
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
      });
    }),
    startScanning: jest.fn().mockResolvedValue(undefined),
    stopScanning: jest.fn().mockResolvedValue(undefined),
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

// Mock platform constants before React Native import
jest.mock('react-native/Libraries/Utilities/Platform.ios.js', () => ({
  default: {
    getConstants: jest.fn(() => ({
      osVersion: '14.0',
      systemName: 'iOS',
      reactNativeVersion: { major: 0, minor: 79, patch: 0 },
      isTesting: true,
    })),
  },
}));

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

  // Force garbage collection to help with memory cleanup
  if (global.gc) {
    global.gc();
  }
});

// Global cleanup on exit
afterAll(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();

  // Force garbage collection
  if (global.gc) {
    global.gc();
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
