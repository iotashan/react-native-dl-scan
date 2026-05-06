module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Use a test-specific tsconfig that turns off verbatimModuleSyntax
  // (required by the main tsconfig for ESM) so ts-jest can run in CJS mode.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.test.json' }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^react-native-nitro-modules$':
      '<rootDir>/__tests__/__mocks__/react-native-nitro-modules.ts',
    // Stub out RN packages that ship ESM-only builds or require native modules.
    // The integration test only exercises NativeDlScan (parseBarcodeData), which
    // does NOT depend on these at runtime — they come in via re-exports in index.ts.
    '^react-native$': '<rootDir>/__tests__/__mocks__/react-native.ts',
    '^react-native-worklets$':
      '<rootDir>/__tests__/__mocks__/react-native-worklets.ts',
    '^react-native-vision-camera$':
      '<rootDir>/__tests__/__mocks__/react-native-vision-camera.ts',
    '^react-native-vision-camera-barcode-scanner$':
      '<rootDir>/__tests__/__mocks__/react-native-vision-camera-barcode-scanner.ts',
  },
  // Don't try to compile cpp/, nitrogen/, ios/, android/, lib/ — those aren't TS.
  // Note: do NOT include '/.worktrees/' here — when running inside a git worktree
  // the absolute path itself contains '.worktrees/' which would incorrectly exclude
  // every test file. The rootDir is already scoped to this worktree.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/lib/',
    '/cpp/',
    '/nitrogen/',
    '/ios/',
    '/android/',
  ],
};
