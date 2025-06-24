#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Coverage thresholds
const thresholds = {
  global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  core: { branches: 90, functions: 90, lines: 90, statements: 90 },
  ui: { branches: 80, functions: 80, lines: 80, statements: 80 },
  utils: { branches: 85, functions: 85, lines: 85, statements: 85 },
  bridge: { branches: 75, functions: 75, lines: 75, statements: 75 },
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runJestCoverage() {
  log('\n📊 Running Jest Coverage...', 'cyan');

  try {
    execSync('npm run test -- --coverage --coverageReporters=json-summary', {
      stdio: 'inherit',
    });

    // Read coverage summary
    const coveragePath = path.join(
      __dirname,
      '..',
      'coverage',
      'coverage-summary.json'
    );
    if (fs.existsSync(coveragePath)) {
      const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      return coverage;
    }
  } catch {
    log('Failed to run Jest coverage', 'red');
    return null;
  }
}

function runXcodeCoverage() {
  log('\n📊 Running Xcode Coverage...', 'cyan');

  try {
    // Run xcodebuild with coverage
    execSync(
      'xcodebuild test -workspace example/ios/DlScanExample.xcworkspace ' +
        '-scheme DlScanExample -destination "platform=iOS Simulator,name=iPhone 14" ' +
        '-enableCodeCoverage YES',
      { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
    );

    // TODO: Parse xcresult for coverage data
    return {
      message: 'Xcode tests completed (coverage parsing not implemented)',
    };
  } catch {
    log(
      'Failed to run Xcode coverage (this is expected if not on macOS)',
      'yellow'
    );
    return null;
  }
}

function analyzeCoverage(coverage) {
  if (!coverage || !coverage.total) return;

  log('\n📈 Coverage Analysis:', 'magenta');

  const metrics = ['lines', 'statements', 'functions', 'branches'];
  const total = coverage.total;

  // Display overall coverage
  log('\nOverall Coverage:', 'blue');
  metrics.forEach((metric) => {
    const value = total[metric].pct;
    const threshold = thresholds.global[metric];
    const color = value >= threshold ? 'green' : 'red';
    const icon = value >= threshold ? '✅' : '❌';

    log(`  ${icon} ${metric}: ${value}% (threshold: ${threshold}%)`, color);
  });

  // Check module-specific coverage
  log('\nModule Coverage:', 'blue');

  const modulePatterns = {
    core: /src\/(parser|scanner|detector)/,
    ui: /src\/components/,
    utils: /src\/utils/,
    bridge: /src\/(DLScanModule|hooks)/,
  };

  Object.entries(modulePatterns).forEach(([module, pattern]) => {
    log(`\n  ${module}:`, 'cyan');

    const moduleFiles = Object.entries(coverage)
      .filter(([file]) => pattern.test(file))
      .map(([, data]) => data);

    if (moduleFiles.length === 0) {
      log('    No files found', 'yellow');
      return;
    }

    metrics.forEach((metric) => {
      const moduleTotal = moduleFiles.reduce(
        (sum, file) => sum + file[metric].total,
        0
      );
      const moduleCovered = moduleFiles.reduce(
        (sum, file) => sum + file[metric].covered,
        0
      );
      const pct = moduleTotal > 0 ? ((moduleCovered / moduleTotal) * 100).toFixed(2) : 0;
      const threshold = thresholds[module][metric];
      const color = pct >= threshold ? 'green' : 'red';
      const icon = pct >= threshold ? '✅' : '❌';

      log(`    ${icon} ${metric}: ${pct}% (threshold: ${threshold}%)`, color);
    });
  });
}

function generateUnifiedReport() {
  log('\n📝 Generating Unified Coverage Report...', 'cyan');

  const report = {
    timestamp: new Date().toISOString(),
    jest: null,
    xcode: null,
    summary: {
      passed: false,
      details: [],
    },
  };

  // Run Jest coverage
  const jestCoverage = runJestCoverage();
  if (jestCoverage) {
    report.jest = jestCoverage;
    analyzeCoverage(jestCoverage);
  }

  // Run Xcode coverage
  const xcodeCoverage = runXcodeCoverage();
  if (xcodeCoverage) {
    report.xcode = xcodeCoverage;
  }

  // Save unified report
  const reportPath = path.join(
    __dirname,
    '..',
    'coverage',
    'unified-coverage-report.json'
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  log(`\n✅ Unified coverage report saved to: ${reportPath}`, 'green');

  // Check if coverage meets thresholds
  if (jestCoverage && jestCoverage.total) {
    const passed = Object.entries(thresholds.global).every(
      ([metric, threshold]) => {
        return jestCoverage.total[metric].pct >= threshold;
      }
    );

    if (passed) {
      log('\n🎉 All coverage thresholds met!', 'green');
      process.exit(0);
    } else {
      log('\n❌ Coverage thresholds not met!', 'red');
      process.exit(1);
    }
  }
}

// Main execution
function main() {
  log('🔍 DL Scan Coverage Report Generator', 'magenta');
  log('===================================\n', 'magenta');

  generateUnifiedReport();
}

main();
