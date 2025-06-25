/**
 * T03_S08: E2E Test Artifacts Path Builder
 * Organizes test artifacts with consistent naming and structure
 */

const path = require('path');

/**
 * Custom path builder for Detox artifacts
 * Creates organized directory structure for test artifacts
 */
module.exports = {
  buildPath: function (artifactName, testSummary) {
    // eslint-disable-next-line no-unused-vars
    const { title, fullName, status, invocations } = testSummary;

    // Create a safe filename from test name
    const safeTestName = title
      .replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase();

    // Get current timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-') // Replace colons and dots with hyphens
      .slice(0, 19); // Remove milliseconds

    // Determine artifact type
    let artifactType = 'unknown';
    if (artifactName.includes('screenshot')) {
      artifactType = 'screenshots';
    } else if (artifactName.includes('log')) {
      artifactType = 'logs';
    } else if (artifactName.includes('video')) {
      artifactType = 'videos';
    } else if (artifactName.includes('timeline')) {
      artifactType = 'timelines';
    }

    // Build the path components
    const statusDir = status === 'failed' ? 'failures' : 'results';
    const attemptDir = invocations > 1 ? `attempt-${invocations}` : 'attempt-1';

    // Create the full path
    const artifactPath = path.join(
      artifactType, // screenshots/logs/videos/timelines
      statusDir, // failures/results
      safeTestName, // test-name
      attemptDir, // attempt-1/attempt-2/etc
      `${timestamp}-${artifactName}` // timestamp-artifact.ext
    );

    return artifactPath;
  },

  // Utility function to create custom artifact paths
  createCustomPath: function (type, testName, artifactName, attempt = 1) {
    const safeTestName = testName
      .replace(/[^a-zA-Z0-9\s-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    return path.join(
      type,
      safeTestName,
      `attempt-${attempt}`,
      `${timestamp}-${artifactName}`
    );
  },

  // Create device-specific paths
  createDevicePath: function (
    deviceName,
    artifactType,
    testName,
    artifactName
  ) {
    const safeDeviceName = deviceName
      .replace(/[^a-zA-Z0-9\s-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    const safeTestName = testName
      .replace(/[^a-zA-Z0-9\s-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    return path.join(
      'devices',
      safeDeviceName,
      artifactType,
      safeTestName,
      `${timestamp}-${artifactName}`
    );
  },
};
