/**
 * T03_S08: E2E Test Sequencer
 * Controls the order of E2E test execution for optimal device usage
 */

const Sequencer = require('@jest/test-sequencer').default;

class E2ETestSequencer extends Sequencer {
  /**
   * Sort test files to optimize device usage and minimize app restarts
   */
  sort(tests) {
    // Define test execution order priority
    const testPriority = {
      // Core functionality tests first
      'scanningFlow.test.ts': 1,
      'coreFeatures.test.ts': 2,

      // Error handling tests
      'errorScenarios.test.ts': 3,
      'permissionHandling.test.ts': 4,

      // Performance and stress tests
      'performanceTests.test.ts': 5,
      'loadTesting.test.ts': 6,

      // Device-specific tests last
      'deviceMatrix.test.ts': 7,
      'orientationTests.test.ts': 8,
    };

    // Sort tests based on priority and filename
    return tests.sort((testA, testB) => {
      const getTestName = (test) => test.path.split('/').pop();
      const nameA = getTestName(testA);
      const nameB = getTestName(testB);

      const priorityA = testPriority[nameA] || 99;
      const priorityB = testPriority[nameB] || 99;

      // Primary sort by priority
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Secondary sort by filename
      return nameA.localeCompare(nameB);
    });
  }

  /**
   * Determine if tests should be run in parallel
   */
  allFailedTests(tests) {
    // For E2E tests, we typically run sequentially to avoid device conflicts
    return tests;
  }
}

module.exports = E2ETestSequencer;
