/**
 * T03_S08: Global E2E Test Setup
 * One-time setup for the entire E2E test suite
 */

const {
  DetoxCircusEnvironment,
  // eslint-disable-next-line no-unused-vars
  SpecReporter,
  // eslint-disable-next-line no-unused-vars
  WorkerAssignReporter,
} = require('detox/runners/jest');

module.exports = async function globalSetup() {
  console.log('🚀 Starting global E2E test setup...');

  // Initialize Detox
  await DetoxCircusEnvironment.initDetox();

  // Create test artifacts directory
  const fs = require('fs');
  const path = require('path');

  const artifactsDir = path.join(__dirname, 'artifacts');
  const reportsDir = path.join(__dirname, 'reports');
  const screenshotsDir = path.join(artifactsDir, 'screenshots');
  const logsDir = path.join(artifactsDir, 'logs');
  const videosDir = path.join(artifactsDir, 'videos');

  // Ensure directories exist
  [artifactsDir, reportsDir, screenshotsDir, logsDir, videosDir].forEach(
    (dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    }
  );

  // Clear previous test artifacts
  const clearDirectory = (dirPath) => {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const filePath = path.join(dirPath, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          clearDirectory(filePath);
          fs.rmdirSync(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }
  };

  clearDirectory(screenshotsDir);
  clearDirectory(logsDir);
  clearDirectory(videosDir);

  console.log('🧹 Cleared previous test artifacts');

  // Set environment variables for test configuration
  process.env.E2E_ARTIFACTS_DIR = artifactsDir;
  process.env.E2E_REPORTS_DIR = reportsDir;
  process.env.E2E_SCREENSHOTS_DIR = screenshotsDir;
  process.env.E2E_LOGS_DIR = logsDir;
  process.env.E2E_VIDEOS_DIR = videosDir;

  // Log test configuration
  console.log('⚙️  E2E Test Configuration:');
  console.log(`   - Artifacts: ${artifactsDir}`);
  console.log(`   - Reports: ${reportsDir}`);
  console.log(`   - Screenshots: ${screenshotsDir}`);
  console.log(`   - Logs: ${logsDir}`);
  console.log(`   - Videos: ${videosDir}`);

  // Initialize test timing
  global.E2E_START_TIME = Date.now();

  console.log('✅ Global E2E test setup completed');
};
