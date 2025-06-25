/**
 * T03_S08: E2E Jest Configuration
 * Jest configuration for Detox end-to-end testing
 */

module.exports = {
  maxWorkers: 1,
  testTimeout: 120000,
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/e2e/artifacts/',
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  preset: 'ts-jest',
  testEnvironment: 'node',
  reporters: [
    'default',
    [
      'jest-html-reporter',
      {
        pageTitle: 'RNDLScan E2E Test Report',
        outputPath: 'e2e/reports/test-report.html',
        includeFailureMsg: true,
        includeConsoleLog: true,
        includeSuiteFailure: true,
        includeObsoleteSnapshots: true,
      },
    ],
    [
      'jest-junit',
      {
        outputDirectory: 'e2e/reports',
        outputName: 'junit.xml',
        ancestorSeparator: ' › ',
        uniqueOutputName: 'false',
        suiteNameTemplate: '{filepath}',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
      },
    ],
  ],
  setupFilesAfterEnv: ['<rootDir>/e2e/setup.ts'],
  verbose: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
  ],
  coverageDirectory: 'e2e/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  globalSetup: '<rootDir>/e2e/globalSetup.js',
  globalTeardown: '<rootDir>/e2e/globalTeardown.js',
  testSequencer: '<rootDir>/e2e/utils/testSequencer.js',
};
