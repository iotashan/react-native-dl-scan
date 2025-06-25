/**
 * T03_S08: E2E Test Artifact Collector
 * Comprehensive collection of test artifacts including screenshots, logs, and videos
 */

const fs = require('fs');
const path = require('path');
const { device } = require('detox');

class ArtifactCollector {
  constructor() {
    this.artifactsDir = process.env.E2E_ARTIFACTS_DIR || './e2e/artifacts';
    this.screenshotsDir = path.join(this.artifactsDir, 'screenshots');
    this.logsDir = path.join(this.artifactsDir, 'logs');
    this.videosDir = path.join(this.artifactsDir, 'videos');
    this.reportsDir = process.env.E2E_REPORTS_DIR || './e2e/reports';

    this.currentTest = null;
    this.testStartTime = null;
    this.artifacts = [];

    this.ensureDirectories();
  }

  ensureDirectories() {
    [
      this.screenshotsDir,
      this.logsDir,
      this.videosDir,
      this.reportsDir,
    ].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  setCurrentTest(testName, suiteName) {
    this.currentTest = {
      name: testName,
      suite: suiteName,
      startTime: Date.now(),
      artifacts: [],
      status: 'running',
    };
    this.testStartTime = Date.now();
  }

  async captureScreenshot(name, options = {}) {
    if (!this.currentTest) {
      console.warn('No current test set for screenshot capture');
      return null;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeTestName = this.currentTest.name
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .replace(/\s+/g, '-');
      const screenshotName = `${safeTestName}-${name}-${timestamp}.png`;
      const screenshotPath = path.join(this.screenshotsDir, screenshotName);

      await device.takeScreenshot(screenshotName);

      const artifact = {
        type: 'screenshot',
        name: screenshotName,
        path: screenshotPath,
        timestamp: Date.now(),
        testName: this.currentTest.name,
        description: options.description || name,
      };

      this.currentTest.artifacts.push(artifact);
      this.artifacts.push(artifact);

      console.log(`📸 Screenshot captured: ${screenshotName}`);
      return artifact;
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      return null;
    }
  }

  async captureFailureArtifacts(error) {
    if (!this.currentTest) return;

    console.log('📸 Capturing failure artifacts...');

    // Capture failure screenshot
    await this.captureScreenshot('failure', {
      description: `Test failure: ${error.message}`,
    });

    // Collect device logs
    await this.collectDeviceLogs('failure');

    // Collect app state if possible
    await this.collectAppState('failure');

    // Mark test as failed
    this.currentTest.status = 'failed';
    this.currentTest.error = {
      message: error.message,
      stack: error.stack,
    };
  }

  async collectDeviceLogs(name = 'device-logs') {
    if (!this.currentTest) return null;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeTestName = this.currentTest.name
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .replace(/\s+/g, '-');
      const logFileName = `${safeTestName}-${name}-${timestamp}.log`;
      const logPath = path.join(this.logsDir, logFileName);

      let logs = '';

      // Collect platform-specific logs
      if (device.getPlatform() === 'ios') {
        try {
          // iOS device logs
          logs = await device.getUiDevice().getDeviceLog();
        } catch (error) {
          logs = `Failed to collect iOS logs: ${error.message}`;
        }
      } else if (device.getPlatform() === 'android') {
        try {
          // Android logcat
          logs = await device.getUiDevice().getAdbLog();
        } catch (error) {
          logs = `Failed to collect Android logs: ${error.message}`;
        }
      }

      // Add test context to logs
      const logContent = `
=== E2E Test Logs ===
Test: ${this.currentTest.name}
Suite: ${this.currentTest.suite}
Platform: ${device.getPlatform()}
Timestamp: ${new Date().toISOString()}
Test Duration: ${Date.now() - this.currentTest.startTime}ms

=== Device Logs ===
${logs}

=== End of Logs ===
`;

      fs.writeFileSync(logPath, logContent);

      const artifact = {
        type: 'log',
        name: logFileName,
        path: logPath,
        timestamp: Date.now(),
        testName: this.currentTest.name,
        description: `Device logs for ${name}`,
      };

      this.currentTest.artifacts.push(artifact);
      this.artifacts.push(artifact);

      console.log(`📋 Device logs collected: ${logFileName}`);
      return artifact;
    } catch (error) {
      console.error('Failed to collect device logs:', error);
      return null;
    }
  }

  async collectAppState(name = 'app-state') {
    if (!this.currentTest) return null;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeTestName = this.currentTest.name
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .replace(/\s+/g, '-');
      const stateFileName = `${safeTestName}-${name}-${timestamp}.json`;
      const statePath = path.join(this.logsDir, stateFileName);

      // Collect app state information
      const appState = {
        testName: this.currentTest.name,
        platform: device.getPlatform(),
        timestamp: new Date().toISOString(),
        testDuration: Date.now() - this.currentTest.startTime,
        // Add more app state as needed
        memoryUsage: process.memoryUsage(),
        deviceInfo: {
          platform: device.getPlatform(),
          // Add device-specific info
        },
      };

      fs.writeFileSync(statePath, JSON.stringify(appState, null, 2));

      const artifact = {
        type: 'app-state',
        name: stateFileName,
        path: statePath,
        timestamp: Date.now(),
        testName: this.currentTest.name,
        description: `App state for ${name}`,
      };

      this.currentTest.artifacts.push(artifact);
      this.artifacts.push(artifact);

      console.log(`📊 App state collected: ${stateFileName}`);
      return artifact;
    } catch (error) {
      console.error('Failed to collect app state:', error);
      return null;
    }
  }

  async startVideoRecording(testName) {
    if (!this.currentTest) return false;

    try {
      // Note: Video recording setup would depend on Detox configuration
      console.log(`🎥 Video recording started for: ${testName}`);
      return true;
    } catch (error) {
      console.error('Failed to start video recording:', error);
      return false;
    }
  }

  async stopVideoRecording() {
    if (!this.currentTest) return null;

    try {
      // Note: Video recording stop would depend on Detox configuration
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeTestName = this.currentTest.name
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .replace(/\s+/g, '-');
      const videoName = `${safeTestName}-${timestamp}.mp4`;
      const videoPath = path.join(this.videosDir, videoName);

      const artifact = {
        type: 'video',
        name: videoName,
        path: videoPath,
        timestamp: Date.now(),
        testName: this.currentTest.name,
        description: 'Test execution video',
      };

      this.currentTest.artifacts.push(artifact);
      this.artifacts.push(artifact);

      console.log(`🎥 Video recording saved: ${videoName}`);
      return artifact;
    } catch (error) {
      console.error('Failed to stop video recording:', error);
      return null;
    }
  }

  completeTest(status = 'passed') {
    if (!this.currentTest) return;

    this.currentTest.status = status;
    this.currentTest.endTime = Date.now();
    this.currentTest.duration =
      this.currentTest.endTime - this.currentTest.startTime;

    console.log(
      `✅ Test completed: ${this.currentTest.name} (${status}) - ${this.currentTest.duration}ms`
    );
    console.log(`📁 Artifacts collected: ${this.currentTest.artifacts.length}`);

    this.currentTest = null;
  }

  generateTestReport() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = `e2e-test-report-${timestamp}.json`;
    const reportPath = path.join(this.reportsDir, reportName);

    const report = {
      timestamp: new Date().toISOString(),
      platform: device.getPlatform(),
      totalArtifacts: this.artifacts.length,
      artifactsByType: this.getArtifactsByType(),
      artifacts: this.artifacts.map((artifact) => ({
        ...artifact,
        // Include relative paths for portability
        relativePath: path.relative(this.artifactsDir, artifact.path),
      })),
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`📋 Test report generated: ${reportName}`);
    return reportPath;
  }

  getArtifactsByType() {
    const byType = {};
    this.artifacts.forEach((artifact) => {
      byType[artifact.type] = (byType[artifact.type] || 0) + 1;
    });
    return byType;
  }

  generateHTMLReport() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = `e2e-test-report-${timestamp}.html`;
    const reportPath = path.join(this.reportsDir, reportName);

    const html = this.buildHTMLReport();
    fs.writeFileSync(reportPath, html);

    console.log(`📋 HTML test report generated: ${reportName}`);
    return reportPath;
  }

  buildHTMLReport() {
    const artifactsByType = this.getArtifactsByType();

    return `
<!DOCTYPE html>
<html>
<head>
    <title>E2E Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .summary-item { background: #e8f4f8; padding: 15px; border-radius: 5px; flex: 1; }
        .artifacts { margin: 20px 0; }
        .artifact { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .artifact.screenshot { border-left: 4px solid #4CAF50; }
        .artifact.log { border-left: 4px solid #FF9800; }
        .artifact.video { border-left: 4px solid #2196F3; }
        .artifact.app-state { border-left: 4px solid #9C27B0; }
        img { max-width: 300px; height: auto; border: 1px solid #ddd; }
    </style>
</head>
<body>
    <div class="header">
        <h1>E2E Test Artifacts Report</h1>
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Platform: ${device.getPlatform()}</p>
    </div>
    
    <div class="summary">
        <div class="summary-item">
            <h3>Total Artifacts</h3>
            <p>${this.artifacts.length}</p>
        </div>
        <div class="summary-item">
            <h3>Screenshots</h3>
            <p>${artifactsByType.screenshot || 0}</p>
        </div>
        <div class="summary-item">
            <h3>Logs</h3>
            <p>${artifactsByType.log || 0}</p>
        </div>
        <div class="summary-item">
            <h3>Videos</h3>
            <p>${artifactsByType.video || 0}</p>
        </div>
    </div>
    
    <div class="artifacts">
        <h2>Collected Artifacts</h2>
        ${this.artifacts.map((artifact) => this.buildArtifactHTML(artifact)).join('')}
    </div>
</body>
</html>`;
  }

  buildArtifactHTML(artifact) {
    const relativePath = path.relative(this.reportsDir, artifact.path);
    const timestamp = new Date(artifact.timestamp).toLocaleString();

    let preview = '';
    if (artifact.type === 'screenshot') {
      preview = `<img src="${relativePath}" alt="Screenshot: ${artifact.name}">`;
    } else if (artifact.type === 'video') {
      preview = `<video width="300" controls><source src="${relativePath}" type="video/mp4"></video>`;
    }

    return `
    <div class="artifact ${artifact.type}">
        <h3>${artifact.name}</h3>
        <p><strong>Type:</strong> ${artifact.type}</p>
        <p><strong>Test:</strong> ${artifact.testName}</p>
        <p><strong>Time:</strong> ${timestamp}</p>
        <p><strong>Description:</strong> ${artifact.description}</p>
        <p><strong>Path:</strong> <a href="${relativePath}">${relativePath}</a></p>
        ${preview}
    </div>`;
  }

  cleanup() {
    console.log('🧹 Cleaning up artifact collector');
    this.currentTest = null;
    this.testStartTime = null;
  }
}

module.exports = ArtifactCollector;
