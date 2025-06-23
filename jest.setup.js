/* eslint-env jest */

// Setup for React Native Testing Library
// Mock native modules
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => ({
  getEnforcing: jest.fn(() => ({
    scanLicense: jest.fn(),
    parseOCRText: jest.fn(),
  })),
}));

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
