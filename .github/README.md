# CI/CD Documentation

This document describes the Continuous Integration and Continuous Deployment (CI/CD) setup for the `react-native-dl-scan` project.

## Overview

The project uses GitHub Actions for automated testing, building, and deployment workflows. The CI/CD pipeline ensures code quality, runs comprehensive tests, and automates releases.

## Workflows

### 1. **Test Workflow** (`.github/workflows/test.yml`)

Runs on every push to `main`/`develop` and pull requests to `main`.

**Jobs:**
- **test**: Unit tests on Node.js 18.x and 20.x
- **test-example**: Tests for the example app
- **build-ios**: iOS platform build validation
- **build-android**: Android platform build validation  
- **security-audit**: Dependency vulnerability scanning

**Features:**
- Multi-platform testing
- Code coverage reporting
- Security vulnerability detection
- Example app validation

### 2. **CI Workflow** (`.github/workflows/ci.yml`)

Comprehensive integration testing with path-based triggering.

**Jobs:**
- **changes**: Detects which parts of the codebase changed
- **test-library**: Library tests (conditional based on changes)
- **test-example**: Example app tests (conditional based on changes)
- **build-platforms**: Cross-platform builds (iOS/Android)
- **validate-docs**: Documentation validation
- **security-scan**: Security audit
- **ci-summary**: Overall pipeline status summary

**Features:**
- Smart change detection (only runs relevant jobs)
- Matrix testing across Node.js versions
- Platform-specific builds
- Documentation validation
- Security scanning
- Success rate calculation

### 3. **Code Quality Workflow** (`.github/workflows/code-quality.yml`)

Focuses on code quality metrics and standards.

**Jobs:**
- **static-analysis**: ESLint, TypeScript, and Prettier checks
- **test-coverage**: Coverage analysis with thresholds
- **dependency-audit**: Security and duplicate dependency checks
- **code-complexity**: Code complexity analysis
- **documentation-check**: Documentation completeness validation
- **quality-summary**: Overall quality score calculation

**Features:**
- Comprehensive static analysis
- Coverage reporting with thresholds
- Security vulnerability scanning
- Code complexity metrics
- Documentation validation
- Quality gate scoring

### 4. **Performance Monitoring** (`.github/workflows/performance.yml`)

Monitors performance metrics and regressions.

**Jobs:**
- **bundle-size-analysis**: Bundle size tracking with limits
- **performance-benchmarks**: Performance regression tests
- **test-performance**: Test execution time monitoring
- **memory-profiling**: Memory usage analysis (scheduled)
- **performance-summary**: Performance metrics summary

**Features:**
- Bundle size monitoring
- Performance regression detection
- Memory profiling
- Test execution timing
- Performance threshold alerts

### 5. **Release Workflow** (`.github/workflows/release.yml`)

Automated release process triggered by version tags.

**Jobs:**
- **test**: Pre-release testing
- **build**: Package building and artifact creation
- **publish-npm**: NPM package publication
- **create-release**: GitHub release creation with changelog
- **publish-docs**: Documentation deployment to GitHub Pages

**Features:**
- Automated NPM publishing
- GitHub release creation
- Changelog generation
- Documentation deployment
- Release artifact management

## Configuration Files

### **Dependabot** (`.github/dependabot.yml`)

Automated dependency updates:
- **Main library**: Weekly dependency updates
- **Example app**: Weekly dependency updates  
- **GitHub Actions**: Weekly action updates

**Features:**
- Automated PR creation for dependency updates
- Security-focused updates
- Configurable update schedules
- Auto-merge capability for minor updates

## Secrets Required

For full CI/CD functionality, configure these repository secrets:

| Secret | Purpose | Required For |
|--------|---------|--------------|
| `NPM_TOKEN` | NPM package publishing | Release workflow |
| `GITHUB_TOKEN` | GitHub API access | Automatically provided |
| `CODECOV_TOKEN` | Code coverage reporting | Optional, enhances coverage reports |

## Branch Protection

Recommended branch protection rules for `main`:

- Require status checks to pass before merging
- Require branches to be up to date before merging
- Required status checks:
  - `test-library`
  - `build-platforms`
  - `validate-docs`
  - `security-scan`
- Require pull request reviews before merging
- Dismiss stale reviews when new commits are pushed
- Restrict pushes that create files

## Workflow Triggers

### Automatic Triggers

- **Push** to `main`, `develop`, `feature/**`, `fix/**` branches
- **Pull Request** to `main`, `develop` branches
- **Tag** creation matching `v*` pattern
- **Scheduled** runs (performance monitoring)

### Manual Triggers

- Performance workflows can be triggered manually
- Release workflow supports manual version bumping

## Artifacts and Reports

### Generated Artifacts

- **Test Results**: Coverage reports, test output
- **Build Artifacts**: NPM packages, platform builds
- **Performance Reports**: Bundle size, benchmark results
- **Security Reports**: Vulnerability scans, audit results

### Artifact Retention

- **Test artifacts**: 30 days
- **Release artifacts**: 90 days
- **Performance reports**: 30 days
- **Security reports**: 30 days

## Performance Monitoring

### Bundle Size Limits

- **CommonJS build**: 150KB (gzipped)
- **ES Module build**: 100KB (gzipped)

### Test Performance Thresholds

- **Maximum execution time**: 5 minutes
- **Minimum pass rate**: 80%
- **Coverage thresholds**: 80% lines, functions, branches, statements

### Performance Alerts

- Bundle size increases beyond limits
- Test execution time exceeding thresholds
- Pass rate drops below 80%
- Memory usage anomalies

## Debugging CI/CD Issues

### Common Issues

1. **Test Failures**
   - Check test logs in the Actions tab
   - Run tests locally: `yarn test`
   - Check for environment differences

2. **Build Failures**
   - Verify dependencies: `yarn install`
   - Check platform-specific requirements
   - Review build logs for specific errors

3. **Coverage Issues**
   - Ensure tests cover critical paths
   - Check coverage thresholds in configuration
   - Add tests for uncovered code

4. **Security Vulnerabilities**
   - Review `npm audit` output
   - Update vulnerable dependencies
   - Consider alternative packages if needed

### Debugging Steps

1. **Check Workflow Status**: Go to Actions tab in GitHub
2. **Review Logs**: Click on failed jobs to see detailed logs
3. **Reproduce Locally**: Run the same commands locally
4. **Check Dependencies**: Ensure all dependencies are properly installed
5. **Environment Differences**: Check for Node.js version, OS differences

## Contributing to CI/CD

When modifying workflows:

1. Test changes in a fork or feature branch
2. Use workflow validation tools
3. Start with small, incremental changes
4. Document changes in pull requests
5. Monitor workflow performance after changes

### Workflow Development Guidelines

- Use descriptive job and step names
- Add appropriate error handling
- Use caching for dependencies when possible
- Minimize workflow execution time
- Include helpful summary information
- Use conditional logic to skip unnecessary work

## Monitoring and Maintenance

### Regular Maintenance Tasks

- **Weekly**: Review dependency updates from Dependabot
- **Monthly**: Review performance trends and adjust thresholds
- **Quarterly**: Update GitHub Actions to latest versions
- **As needed**: Update Node.js versions in matrix testing

### Monitoring Dashboards

- GitHub Actions workflow status
- Codecov coverage reports
- NPM package download statistics
- GitHub repository insights

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [NPM Publishing Guide](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [Codecov Documentation](https://docs.codecov.io/)
- [React Native CI/CD Best Practices](https://reactnative.dev/docs/testing-overview)