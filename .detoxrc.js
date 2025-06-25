/**
 * T03_S08: Detox E2E Testing Configuration
 * Configures Detox for iOS and Android end-to-end testing
 */

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath:
        'example/ios/build/Build/Products/Debug-iphonesimulator/DlScanExample.app',
      build:
        'cd example && xcodebuild -workspace ios/DlScanExample.xcworkspace -scheme DlScanExample -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath:
        'example/ios/build/Build/Products/Release-iphonesimulator/DlScanExample.app',
      build:
        'cd example && xcodebuild -workspace ios/DlScanExample.xcworkspace -scheme DlScanExample -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'example/android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        'cd example/android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
      reversePorts: [8081],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath:
        'example/android/app/build/outputs/apk/release/app-release.apk',
      build:
        'cd example/android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release',
      reversePorts: [8081],
    },
  },
  devices: {
    'ios.simulator': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 14',
      },
    },
    'ios.simulator.large': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 14 Pro Max',
      },
    },
    'ios.simulator.tablet': {
      type: 'ios.simulator',
      device: {
        type: 'iPad Pro (12.9-inch) (6th generation)',
      },
    },
    'android.emulator': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_5_API_31',
      },
    },
    'android.emulator.large': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_7_API_33',
      },
    },
    'android.emulator.tablet': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_Tablet_API_33',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'ios.simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'ios.simulator',
      app: 'ios.release',
    },
    'ios.large.debug': {
      device: 'ios.simulator.large',
      app: 'ios.debug',
    },
    'ios.tablet.debug': {
      device: 'ios.simulator.tablet',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'android.emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'android.emulator',
      app: 'android.release',
    },
    'android.large.debug': {
      device: 'android.emulator.large',
      app: 'android.debug',
    },
    'android.tablet.debug': {
      device: 'android.emulator.tablet',
      app: 'android.debug',
    },
  },
  behavior: {
    init: {
      reinstallApp: true,
      exposeGlobals: false,
    },
    cleanup: {
      shutdownDevice: false,
    },
  },
  artifacts: {
    rootDir: './e2e/artifacts',
    pathBuilder: './e2e/utils/pathBuilder.js',
    plugins: {
      log: 'all',
      screenshot: {
        shouldTakeAutomaticSnapshots: true,
        takeWhen: {
          testStart: false,
          testDone: true,
          testFailure: true,
        },
        attachToReport: true,
      },
      video: {
        android: 'enabled',
        simulator: 'enabled',
      },
      instruments: {
        path: 'all',
      },
      timeline: {
        enabled: true,
      },
    },
  },
  logger: {
    level: process.env.CI ? 'error' : 'info',
    overrideConsole: true,
  },
};
