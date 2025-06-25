/**
 * T02_S08: Cross-Platform Test Utilities
 * Platform-aware testing utilities for React Native integration tests
 */

import { Platform } from 'react-native';

// ===== PLATFORM DETECTION UTILITIES =====

export const PlatformTestUtils = {
  /**
   * Run platform-specific tests
   */
  runPlatformTest: (
    testName: string,
    iosTest: () => void,
    androidTest?: () => void
  ) => {
    if (Platform.OS === 'ios') {
      test(`${testName} (iOS)`, iosTest);
    } else if (Platform.OS === 'android' && androidTest) {
      test(`${testName} (Android)`, androidTest);
    } else if (androidTest) {
      test(`${testName} (Default/Android)`, androidTest);
    } else {
      test(`${testName} (iOS/Default)`, iosTest);
    }
  },

  /**
   * Run tests on both platforms
   */
  runCrossPlatformTest: (
    testName: string,
    testImplementation: (platform: string) => void
  ) => {
    ['ios', 'android'].forEach((platform) => {
      test(`${testName} (${platform})`, () => {
        // Temporarily override Platform.OS
        const originalOS = Platform.OS;
        (Platform as any).OS = platform;

        try {
          testImplementation(platform);
        } finally {
          // Restore original platform
          (Platform as any).OS = originalOS;
        }
      });
    });
  },

  /**
   * Skip test on specific platform
   */
  skipOnPlatform: (platform: string, testName: string, testFn: () => void) => {
    if (Platform.OS === platform) {
      // eslint-disable-next-line jest/no-disabled-tests
      test.skip(`${testName} (skipped on ${platform})`, testFn);
    } else {
      test(testName, testFn);
    }
  },

  /**
   * Only run test on specific platform
   */
  onlyOnPlatform: (platform: string, testName: string, testFn: () => void) => {
    if (Platform.OS === platform) {
      test(testName, testFn);
    } else {
      // eslint-disable-next-line jest/no-disabled-tests
      test.skip(`${testName} (iOS only)`, testFn);
    }
  },

  /**
   * Mock platform-specific module
   */
  mockPlatformSpecificModule: (moduleName: string) => {
    const mockModule = Platform.select({
      ios: require(`../mocks/ios/${moduleName}`),
      android: require(`../mocks/android/${moduleName}`),
      default: require(`../mocks/default/${moduleName}`),
    });

    jest.doMock(moduleName, () => mockModule);
    return mockModule;
  },

  /**
   * Get platform-specific configuration
   */
  getPlatformConfig: () => ({
    ios: {
      permissions: {
        camera: 'ios.permission.CAMERA',
        photoLibrary: 'ios.permission.PHOTO_LIBRARY',
      },
      constants: {
        statusBarHeight: 44,
        navigationBarHeight: 88,
      },
      features: {
        hapticFeedback: true,
        backgroundProcessing: true,
        nativeImageProcessing: true,
      },
    },
    android: {
      permissions: {
        camera: 'android.permission.CAMERA',
        storage: 'android.permission.WRITE_EXTERNAL_STORAGE',
      },
      constants: {
        statusBarHeight: 24,
        navigationBarHeight: 56,
      },
      features: {
        hapticFeedback: true,
        backgroundProcessing: false,
        nativeImageProcessing: false,
      },
    },
  }),
};

// ===== PERFORMANCE TESTING UTILITIES =====

export const PerformanceTestUtils = {
  /**
   * Measure execution time with platform-specific expectations
   */
  measurePlatformPerformance: async (
    operation: () => Promise<any>,
    expectations: {
      ios?: { maxTime: number; minTime?: number };
      android?: { maxTime: number; minTime?: number };
    }
  ) => {
    const startTime = Date.now();
    const result = await operation();
    const executionTime = Date.now() - startTime;

    const platformExpectation =
      expectations[Platform.OS as keyof typeof expectations];
    if (platformExpectation) {
      expect(executionTime).toBeLessThanOrEqual(platformExpectation.maxTime);
      if (platformExpectation.minTime) {
        expect(executionTime).toBeGreaterThanOrEqual(
          platformExpectation.minTime
        );
      }
    }

    return { result, executionTime };
  },

  /**
   * Test memory usage patterns
   */
  measureMemoryUsage: (testName: string, operation: () => void) => {
    const initialMemory = (global as any).gc ? process.memoryUsage() : null;

    operation();

    if (initialMemory && (global as any).gc) {
      (global as any).gc();
      const finalMemory = process.memoryUsage();
      const memoryDiff = finalMemory.heapUsed - initialMemory.heapUsed;

      // Platform-specific memory expectations
      const maxMemoryIncrease =
        Platform.OS === 'ios' ? 10 * 1024 * 1024 : 15 * 1024 * 1024; // 10MB iOS, 15MB Android

      expect(memoryDiff).toBeLessThan(maxMemoryIncrease);
    }
  },

  /**
   * Test with platform-specific timeouts
   */
  withPlatformTimeout: (
    testFn: () => Promise<void>,
    timeouts: { ios: number; android: number }
  ) => {
    const timeout =
      timeouts[Platform.OS as keyof typeof timeouts] || timeouts.ios;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Test timed out after ${timeout}ms on ${Platform.OS}`)
        );
      }, timeout);

      testFn()
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  },
};

// ===== MOCK UTILITIES =====

export const MockUtils = {
  /**
   * Create platform-specific native module mock
   */
  createPlatformNativeModuleMock: (moduleName: string) => {
    const baseMock = {
      scanLicense: jest.fn(),
      parseOCRText: jest.fn(),
      startScanning: jest.fn(),
      stopScanning: jest.fn(),
    };

    const platformSpecific = Platform.select({
      ios: {
        ...baseMock,
        // iOS-specific methods
        configureVisionFramework: jest.fn(),
        enableHapticFeedback: jest.fn(),
        setProcessingPriority: jest.fn(),
      },
      android: {
        ...baseMock,
        // Android-specific methods
        configureMLKit: jest.fn(),
        enableVibration: jest.fn(),
        setProcessingThread: jest.fn(),
      },
      default: baseMock,
    });

    jest.doMock(`react-native`, () => ({
      NativeModules: {
        [moduleName]: platformSpecific,
      },
      Platform,
    }));

    return platformSpecific;
  },

  /**
   * Create platform-specific TurboModule mock
   */
  createPlatformTurboModuleMock: () => {
    const mockModule = {
      scanLicense: jest.fn(),
      parseOCRText: jest.fn(),
      startScanning: jest.fn(),
      stopScanning: jest.fn(),
    };

    // Add platform-specific features
    if (Platform.OS === 'ios') {
      Object.assign(mockModule, {
        enableVisionFramework: jest.fn(),
        configureHaptics: jest.fn(),
      });
    } else {
      Object.assign(mockModule, {
        enableMLKit: jest.fn(),
        configureVibration: jest.fn(),
      });
    }

    jest.doMock(
      'react-native/Libraries/TurboModule/TurboModuleRegistry',
      () => ({
        get: jest.fn(() => mockModule),
        getEnforcing: jest.fn(() => mockModule),
      })
    );

    return mockModule;
  },

  /**
   * Mock camera permissions for platform
   */
  mockCameraPermissions: (granted: boolean = true) => {
    const permissionResult = granted ? 'granted' : 'denied';

    const mockPermissions = Platform.select({
      ios: {
        PERMISSIONS: {
          IOS: { CAMERA: 'ios.permission.CAMERA' },
        },
        RESULTS: {
          GRANTED: 'granted',
          DENIED: 'denied',
          BLOCKED: 'blocked',
        },
        check: jest.fn().mockResolvedValue(permissionResult),
        request: jest.fn().mockResolvedValue(permissionResult),
        openSettings: jest.fn().mockResolvedValue(true),
      },
      android: {
        PERMISSIONS: {
          ANDROID: { CAMERA: 'android.permission.CAMERA' },
        },
        RESULTS: {
          GRANTED: 'granted',
          DENIED: 'denied',
          NEVER_ASK_AGAIN: 'never_ask_again',
        },
        check: jest.fn().mockResolvedValue(permissionResult),
        request: jest.fn().mockResolvedValue(permissionResult),
        openSettings: jest.fn().mockResolvedValue(true),
      },
      default: {
        check: jest.fn().mockResolvedValue(permissionResult),
        request: jest.fn().mockResolvedValue(permissionResult),
      },
    });

    jest.doMock('react-native-permissions', () => mockPermissions);
    return mockPermissions;
  },
};

// ===== ERROR SIMULATION UTILITIES =====

export const ErrorSimulationUtils = {
  /**
   * Simulate platform-specific errors
   */
  simulatePlatformError: (errorType: 'permission' | 'hardware' | 'system') => {
    const errorMessages = {
      ios: {
        permission: 'User denied camera permission',
        hardware: 'Camera hardware unavailable',
        system: 'iOS system error occurred',
      },
      android: {
        permission: 'Camera permission not granted',
        hardware: 'Camera device in use',
        system: 'Android system error occurred',
      },
    };

    const platformErrors =
      errorMessages[Platform.OS as keyof typeof errorMessages] ||
      errorMessages.ios;
    return new Error(platformErrors[errorType]);
  },

  /**
   * Test error recovery mechanisms
   */
  testErrorRecovery: (
    operation: () => Promise<any>,
    expectedErrors: string[],
    recoveryMechanism: () => Promise<any>
  ) => {
    return async () => {
      // First attempt should fail
      try {
        await operation();
        throw new Error('Expected operation to fail');
      } catch (error) {
        expect(expectedErrors).toContain((error as Error).message);
      }

      // Recovery should succeed
      const result = await recoveryMechanism();
      expect(result).toBeDefined();
    };
  },
};

// ===== DEVICE SIMULATION UTILITIES =====

export const DeviceSimulationUtils = {
  /**
   * Mock different device capabilities
   */
  mockDeviceCapabilities: (capabilities: {
    hasCamera?: boolean;
    hasHaptics?: boolean;
    hasMLProcessing?: boolean;
    memoryLimit?: number;
  }) => {
    const mockCapabilities = Platform.select({
      ios: {
        hasCamera: capabilities.hasCamera ?? true,
        hasHaptics: capabilities.hasHaptics ?? true,
        hasVisionFramework: true,
        hasMLProcessing: capabilities.hasMLProcessing ?? true,
        memoryLimit: capabilities.memoryLimit ?? 512 * 1024 * 1024, // 512MB
      },
      android: {
        hasCamera: capabilities.hasCamera ?? true,
        hasHaptics: capabilities.hasHaptics ?? false,
        hasMLKit: capabilities.hasMLProcessing ?? false,
        hasMLProcessing: capabilities.hasMLProcessing ?? false,
        memoryLimit: capabilities.memoryLimit ?? 256 * 1024 * 1024, // 256MB
      },
      default: capabilities,
    });

    return mockCapabilities;
  },

  /**
   * Simulate different device performance characteristics
   */
  simulateDevicePerformance: (deviceTier: 'low' | 'medium' | 'high') => {
    const performanceProfiles = {
      low: {
        frameProcessingTime: 200, // ms
        maxConcurrentOperations: 1,
        memoryLimit: 128 * 1024 * 1024, // 128MB
      },
      medium: {
        frameProcessingTime: 100, // ms
        maxConcurrentOperations: 2,
        memoryLimit: 256 * 1024 * 1024, // 256MB
      },
      high: {
        frameProcessingTime: 50, // ms
        maxConcurrentOperations: 4,
        memoryLimit: 512 * 1024 * 1024, // 512MB
      },
    };

    return performanceProfiles[deviceTier];
  },
};

// ===== INTEGRATION HELPERS =====

export const IntegrationTestHelpers = {
  /**
   * Setup comprehensive integration test environment
   */
  setupIntegrationEnvironment: () => {
    // Mock all platform-specific modules
    MockUtils.createPlatformTurboModuleMock();
    MockUtils.mockCameraPermissions(true);

    // Setup platform-specific configurations
    const config = PlatformTestUtils.getPlatformConfig();
    return config[Platform.OS as keyof typeof config];
  },

  /**
   * Cleanup integration test environment
   */
  cleanupIntegrationEnvironment: () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  },

  /**
   * Create cross-platform test suite
   */
  createCrossPlatformSuite: (
    suiteName: string,
    testCases: {
      name: string;
      test: (platform: string) => void | Promise<void>;
      platforms?: string[];
    }[]
  ) => {
    describe(suiteName, () => {
      testCases.forEach(({ name, test, platforms = ['ios', 'android'] }) => {
        platforms.forEach((platform) => {
          it(`${name} (${platform})`, async () => {
            const originalOS = Platform.OS;
            (Platform as any).OS = platform;

            try {
              await test(platform);
            } finally {
              (Platform as any).OS = originalOS;
            }
          });
        });
      });
    });
  },
};

// ===== EXPORT UTILITIES =====

export {
  PlatformTestUtils,
  PerformanceTestUtils,
  MockUtils,
  ErrorSimulationUtils,
  DeviceSimulationUtils,
  IntegrationTestHelpers,
};

export default {
  Platform: PlatformTestUtils,
  Performance: PerformanceTestUtils,
  Mocks: MockUtils,
  Errors: ErrorSimulationUtils,
  Device: DeviceSimulationUtils,
  Integration: IntegrationTestHelpers,
};
