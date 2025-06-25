/**
 * T03_S08: E2E Test Runner with Artifact Collection
 * Enhanced test runner that integrates artifact collection and reporting
 */

const ArtifactCollector = require('./artifactCollector');
const fs = require('fs');
const path = require('path');

class E2ETestRunner {
  constructor() {
    this.artifactCollector = new ArtifactCollector();
    this.testResults = [];
    this.suiteResults = [];
    this.startTime = null;
    this.currentSuite = null;
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
    this.skippedTests = 0;
  }

  onRunStart(results) {
    this.startTime = Date.now();
    this.totalTests = results.numTotalTests;

    console.log('🚀 E2E Test Run Started');
    console.log(`📊 Total tests to run: ${this.totalTests}`);
    console.log(`📱 Platform: ${require('detox').device.getPlatform()}`);

    // Initialize test run artifacts directory
    this.createTestRunDirectory();
  }

  onTestSuiteStart(suite) {
    this.currentSuite = {
      name: suite.title,
      startTime: Date.now(),
      tests: [],
      artifacts: [],
    };

    console.log(`📁 Starting test suite: ${suite.title}`);
  }

  async onTestStart(test) {
    const testName = test.title;
    const suiteName = this.currentSuite
      ? this.currentSuite.name
      : 'Unknown Suite';

    console.log(`🧪 Starting test: ${testName}`);

    // Set up artifact collection for this test
    this.artifactCollector.setCurrentTest(testName, suiteName);

    // Capture test start screenshot
    await this.artifactCollector.captureScreenshot('test-start', {
      description: 'Screenshot at test start',
    });

    // Start video recording if enabled
    await this.artifactCollector.startVideoRecording(testName);

    // Collect initial app state
    await this.artifactCollector.collectAppState('test-start');
  }

  async onTestPass(test) {
    const testResult = {
      name: test.title,
      suite: this.currentSuite ? this.currentSuite.name : 'Unknown Suite',
      status: 'passed',
      duration: test.duration,
      artifacts: [...(this.artifactCollector.currentTest?.artifacts || [])],
      timestamp: Date.now(),
    };

    this.testResults.push(testResult);
    this.passedTests++;

    if (this.currentSuite) {
      this.currentSuite.tests.push(testResult);
    }

    // Capture success screenshot
    await this.artifactCollector.captureScreenshot('test-success', {
      description: 'Screenshot at test completion',
    });

    // Stop video recording
    await this.artifactCollector.stopVideoRecording();

    // Complete test in artifact collector
    this.artifactCollector.completeTest('passed');

    console.log(`✅ Test passed: ${test.title} (${test.duration}ms)`);
  }

  async onTestFailure(test, error) {
    const testResult = {
      name: test.title,
      suite: this.currentSuite ? this.currentSuite.name : 'Unknown Suite',
      status: 'failed',
      duration: test.duration,
      error: {
        message: error.message,
        stack: error.stack,
      },
      artifacts: [],
      timestamp: Date.now(),
    };

    console.log(`❌ Test failed: ${test.title}`);
    console.log(`   Error: ${error.message}`);

    // Capture failure artifacts
    await this.artifactCollector.captureFailureArtifacts(error);

    // Add artifacts to test result
    testResult.artifacts = [
      ...(this.artifactCollector.currentTest?.artifacts || []),
    ];

    this.testResults.push(testResult);
    this.failedTests++;

    if (this.currentSuite) {
      this.currentSuite.tests.push(testResult);
    }

    // Stop video recording
    await this.artifactCollector.stopVideoRecording();

    // Complete test in artifact collector
    this.artifactCollector.completeTest('failed');
  }

  async onTestSkip(test) {
    const testResult = {
      name: test.title,
      suite: this.currentSuite ? this.currentSuite.name : 'Unknown Suite',
      status: 'skipped',
      duration: 0,
      artifacts: [],
      timestamp: Date.now(),
    };

    this.testResults.push(testResult);
    this.skippedTests++;

    if (this.currentSuite) {
      this.currentSuite.tests.push(testResult);
    }

    console.log(`⏭️  Test skipped: ${test.title}`);
  }

  onTestSuiteEnd(suite) {
    if (this.currentSuite) {
      this.currentSuite.endTime = Date.now();
      this.currentSuite.duration =
        this.currentSuite.endTime - this.currentSuite.startTime;

      const passedInSuite = this.currentSuite.tests.filter(
        (t) => t.status === 'passed'
      ).length;
      const failedInSuite = this.currentSuite.tests.filter(
        (t) => t.status === 'failed'
      ).length;
      const skippedInSuite = this.currentSuite.tests.filter(
        (t) => t.status === 'skipped'
      ).length;

      this.currentSuite.summary = {
        total: this.currentSuite.tests.length,
        passed: passedInSuite,
        failed: failedInSuite,
        skipped: skippedInSuite,
      };

      this.suiteResults.push(this.currentSuite);

      console.log(`📁 Test suite completed: ${suite.title}`);
      console.log(`   Duration: ${this.currentSuite.duration}ms`);
      console.log(
        `   Results: ${passedInSuite} passed, ${failedInSuite} failed, ${skippedInSuite} skipped`
      );

      this.currentSuite = null;
    }
  }

  async onRunComplete(results) {
    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;

    console.log('🏁 E2E Test Run Completed');
    console.log(`⏱️  Total duration: ${totalDuration}ms`);
    console.log(
      `📊 Results: ${this.passedTests} passed, ${this.failedTests} failed, ${this.skippedTests} skipped`
    );

    // Generate comprehensive test report
    await this.generateComprehensiveReport(totalDuration, results);

    // Generate artifact reports
    this.artifactCollector.generateTestReport();
    this.artifactCollector.generateHTMLReport();

    // Clean up
    this.artifactCollector.cleanup();

    console.log('📋 All reports generated successfully');
  }

  createTestRunDirectory() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(
      process.env.E2E_ARTIFACTS_DIR || './e2e/artifacts',
      `run-${timestamp}`
    );

    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }

    this.runDirectory = runDir;
    console.log(`📁 Test run directory: ${runDir}`);
  }

  async generateComprehensiveReport(totalDuration, jestResults) {
    const timestamp = new Date().toISOString();
    const reportTimestamp = timestamp.replace(/[:.]/g, '-');

    const report = {
      metadata: {
        timestamp,
        platform: require('detox').device.getPlatform(),
        totalDuration,
        runDirectory: this.runDirectory,
      },
      summary: {
        total: this.totalTests,
        passed: this.passedTests,
        failed: this.failedTests,
        skipped: this.skippedTests,
        successRate:
          this.totalTests > 0
            ? ((this.passedTests / this.totalTests) * 100).toFixed(2)
            : 0,
      },
      suites: this.suiteResults.map((suite) => ({
        ...suite,
        artifacts: suite.artifacts || [],
      })),
      tests: this.testResults,
      performance: {
        averageTestDuration:
          this.testResults.length > 0
            ? this.testResults.reduce(
                (sum, test) => sum + (test.duration || 0),
                0
              ) / this.testResults.length
            : 0,
        slowestTests: this.testResults
          .filter((test) => test.duration)
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 5),
        fastestTests: this.testResults
          .filter((test) => test.duration)
          .sort((a, b) => a.duration - b.duration)
          .slice(0, 5),
      },
      artifacts: {
        total: this.artifactCollector.artifacts.length,
        byType: this.artifactCollector.getArtifactsByType(),
        details: this.artifactCollector.artifacts,
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage(),
      },
    };

    // Save JSON report
    const reportsDir = process.env.E2E_REPORTS_DIR || './e2e/reports';
    const jsonReportPath = path.join(
      reportsDir,
      `comprehensive-report-${reportTimestamp}.json`
    );
    fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));

    // Generate HTML report
    const htmlReportPath = path.join(
      reportsDir,
      `comprehensive-report-${reportTimestamp}.html`
    );
    const htmlContent = this.generateHTMLReport(report);
    fs.writeFileSync(htmlReportPath, htmlContent);

    // Generate CI-friendly report (JUnit XML format)
    const junitReportPath = path.join(
      reportsDir,
      `junit-report-${reportTimestamp}.xml`
    );
    const junitContent = this.generateJUnitReport(report);
    fs.writeFileSync(junitReportPath, junitContent);

    console.log(`📋 Comprehensive reports generated:`);
    console.log(`   JSON: ${jsonReportPath}`);
    console.log(`   HTML: ${htmlReportPath}`);
    console.log(`   JUnit: ${junitReportPath}`);

    return report;
  }

  generateHTMLReport(report) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>E2E Test Comprehensive Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .summary-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #007bff; }
        .summary-card.passed { border-left-color: #28a745; }
        .summary-card.failed { border-left-color: #dc3545; }
        .summary-card.skipped { border-left-color: #ffc107; }
        .section { margin: 30px 0; }
        .section h2 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        .test-suite { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .test-item { margin: 10px 0; padding: 10px; border-radius: 4px; }
        .test-item.passed { background: #d4edda; border-left: 4px solid #28a745; }
        .test-item.failed { background: #f8d7da; border-left: 4px solid #dc3545; }
        .test-item.skipped { background: #fff3cd; border-left: 4px solid #ffc107; }
        .performance-chart { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
        .chart-section { background: #f8f9fa; padding: 15px; border-radius: 5px; }
        .artifact-count { display: inline-block; background: #007bff; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
        .duration { color: #666; font-size: 0.9em; }
        .error-details { background: #f8f9fa; padding: 10px; border-radius: 4px; margin: 10px 0; font-family: monospace; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>E2E Test Report</h1>
            <p>Generated: ${new Date(report.metadata.timestamp).toLocaleString()}</p>
            <p>Platform: ${report.metadata.platform} | Duration: ${report.metadata.totalDuration}ms</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>Total Tests</h3>
                <div style="font-size: 2em; font-weight: bold;">${report.summary.total}</div>
            </div>
            <div class="summary-card passed">
                <h3>Passed</h3>
                <div style="font-size: 2em; font-weight: bold; color: #28a745;">${report.summary.passed}</div>
            </div>
            <div class="summary-card failed">
                <h3>Failed</h3>
                <div style="font-size: 2em; font-weight: bold; color: #dc3545;">${report.summary.failed}</div>
            </div>
            <div class="summary-card skipped">
                <h3>Skipped</h3>
                <div style="font-size: 2em; font-weight: bold; color: #ffc107;">${report.summary.skipped}</div>
            </div>
            <div class="summary-card">
                <h3>Success Rate</h3>
                <div style="font-size: 2em; font-weight: bold; color: #007bff;">${report.summary.successRate}%</div>
            </div>
        </div>
        
        <div class="section">
            <h2>Test Suites</h2>
            ${report.suites
              .map(
                (suite) => `
                <div class="test-suite">
                    <h3>${suite.name} <span class="duration">(${suite.duration}ms)</span></h3>
                    <p>Tests: ${suite.summary.passed} passed, ${suite.summary.failed} failed, ${suite.summary.skipped} skipped</p>
                    ${suite.tests
                      .map(
                        (test) => `
                        <div class="test-item ${test.status}">
                            <strong>${test.name}</strong> 
                            <span class="duration">${test.duration || 0}ms</span>
                            <span class="artifact-count">${test.artifacts.length} artifacts</span>
                            ${test.error ? `<div class="error-details">${test.error.message}</div>` : ''}
                        </div>
                    `
                      )
                      .join('')}
                </div>
            `
              )
              .join('')}
        </div>
        
        <div class="section">
            <h2>Performance Analysis</h2>
            <div class="performance-chart">
                <div class="chart-section">
                    <h3>Slowest Tests</h3>
                    ${report.performance.slowestTests
                      .map(
                        (test) => `
                        <div style="margin: 5px 0;">${test.name}: ${test.duration}ms</div>
                    `
                      )
                      .join('')}
                </div>
                <div class="chart-section">
                    <h3>Fastest Tests</h3>
                    ${report.performance.fastestTests
                      .map(
                        (test) => `
                        <div style="margin: 5px 0;">${test.name}: ${test.duration}ms</div>
                    `
                      )
                      .join('')}
                </div>
            </div>
            <p>Average test duration: ${report.performance.averageTestDuration.toFixed(2)}ms</p>
        </div>
        
        <div class="section">
            <h2>Artifacts Summary</h2>
            <p>Total artifacts collected: ${report.artifacts.total}</p>
            <div style="margin: 10px 0;">
                ${Object.entries(report.artifacts.byType)
                  .map(
                    ([type, count]) =>
                      `<span class="artifact-count" style="margin: 5px;">${type}: ${count}</span>`
                  )
                  .join('')}
            </div>
        </div>
    </div>
</body>
</html>`;
  }

  generateJUnitReport(report) {
    const escapeXml = (str) => {
      if (!str) return '';
      return str.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<':
            return '&lt;';
          case '>':
            return '&gt;';
          case '&':
            return '&amp;';
          case "'":
            return '&apos;';
          case '"':
            return '&quot;';
          default:
            return c;
        }
      });
    };

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="${report.summary.total}" failures="${report.summary.failed}" skipped="${report.summary.skipped}" time="${report.metadata.totalDuration / 1000}">
  ${report.suites
    .map(
      (suite) => `
  <testsuite name="${escapeXml(suite.name)}" tests="${suite.summary.total}" failures="${suite.summary.failed}" skipped="${suite.summary.skipped}" time="${suite.duration / 1000}">
    ${suite.tests
      .map(
        (test) => `
    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(suite.name)}" time="${(test.duration || 0) / 1000}">
      ${
        test.status === 'failed'
          ? `
      <failure message="${escapeXml(test.error?.message || 'Test failed')}">
        ${escapeXml(test.error?.stack || '')}
      </failure>`
          : ''
      }
      ${test.status === 'skipped' ? '<skipped/>' : ''}
    </testcase>`
      )
      .join('')}
  </testsuite>`
    )
    .join('')}
</testsuites>`;
  }
}

module.exports = E2ETestRunner;
