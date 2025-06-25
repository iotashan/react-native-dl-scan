/**
 * T03_S08: Global E2E Test Teardown
 * Cleanup after the entire E2E test suite
 */

const { DetoxCircusEnvironment } = require('detox/runners/jest');

module.exports = async function globalTeardown() {
  console.log('🧹 Starting global E2E test teardown...');

  // Calculate total test duration
  const totalDuration = Date.now() - global.E2E_START_TIME;
  console.log(`⏱️  Total E2E test duration: ${totalDuration}ms`);

  // Clean up Detox
  await DetoxCircusEnvironment.cleanupDetox();

  // Generate test summary report
  const fs = require('fs');
  const path = require('path');

  const summaryReport = {
    timestamp: new Date().toISOString(),
    totalDuration: totalDuration,
    artifactsLocation: process.env.E2E_ARTIFACTS_DIR,
    reportsLocation: process.env.E2E_REPORTS_DIR,
    platform: process.env.DETOX_DEVICE_NAME || 'unknown',
    configuration: process.env.DETOX_CONFIGURATION || 'unknown',
  };

  const summaryPath = path.join(
    process.env.E2E_REPORTS_DIR,
    'test-summary.json'
  );
  fs.writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));

  console.log('📊 Test summary report generated:', summaryPath);

  // Log artifact information
  const artifactsDir = process.env.E2E_ARTIFACTS_DIR;
  if (fs.existsSync(artifactsDir)) {
    const artifacts = fs.readdirSync(artifactsDir, { withFileTypes: true });

    console.log('📁 Test artifacts generated:');
    artifacts.forEach((artifact) => {
      if (artifact.isDirectory()) {
        const subDir = path.join(artifactsDir, artifact.name);
        const subFiles = fs.readdirSync(subDir);
        console.log(`   - ${artifact.name}/: ${subFiles.length} files`);
      } else {
        console.log(`   - ${artifact.name}`);
      }
    });
  }

  console.log('✅ Global E2E test teardown completed');
};
