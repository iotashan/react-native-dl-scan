# T04_S08: CI/CD Pipeline Configuration

## Task ID
**T04_S08**

## Description
Configure comprehensive GitHub Actions CI/CD pipeline with automated testing, linting, performance checks, quality gates, and deployment workflows for the React Native driver's license scanning module.

## Parent Module
**M05: Testing, Optimization & Documentation**

## Prerequisites
- T01_S08: Unit test framework established
- T02_S08: Integration tests implemented
- T03_S08: E2E tests configured
- GitHub repository configured
- App signing certificates available

## Complexity
**Medium** - Requires orchestrating multiple build and test stages

## Sub-tasks

### 1. Base CI Pipeline Setup
- Configure GitHub Actions workflows
- Set up build matrix for platforms
- Configure caching strategies
- Implement artifact management

### 2. Automated Testing Integration
- Run unit tests for both platforms
- Execute integration test suites
- Schedule E2E tests appropriately
- Aggregate test results and coverage

### 3. Code Quality Checks
- ESLint and TSC for TypeScript
- SwiftLint for iOS native code
- Ktlint for Android (if applicable)
- Security vulnerability scanning

### 4. Performance and Quality Gates
- Bundle size analysis
- Performance benchmarking
- Code coverage thresholds
- Build time optimization

### 5. Deployment Workflows
- TestFlight deployment for iOS
- Play Store internal testing
- Version bumping automation
- Release notes generation

## Acceptance Criteria
- [ ] CI pipeline runs on all PRs and main branch
- [ ] All test suites integrated with reporting
- [ ] Code quality checks enforced
- [ ] Performance metrics tracked
- [ ] Automated deployment workflows functional
- [ ] Build artifacts properly archived

## Technical Notes

### Main CI Workflow
```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: '18'
  RUBY_VERSION: '3.0'
  JAVA_VERSION: '11'

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      cache-key: ${{ steps.cache-key.outputs.key }}
    steps:
      - uses: actions/checkout@v3
      
      - name: Generate cache key
        id: cache-key
        run: |
          echo "key=${{ runner.os }}-${{ hashFiles('**/package-lock.json', '**/Podfile.lock') }}" >> $GITHUB_OUTPUT

  lint-and-typecheck:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run ESLint
        run: npm run lint
      
      - name: Run TypeScript check
        run: npm run typecheck
      
      - name: Check bundle size
        run: |
          npm run build
          npx bundlewatch --config .bundlewatchrc.json

  test-js:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit -- --coverage
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: javascript

  test-ios:
    needs: setup
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: ${{ env.RUBY_VERSION }}
          bundler-cache: true
      
      - name: Cache CocoaPods
        uses: actions/cache@v3
        with:
          path: ios/Pods
          key: ${{ runner.os }}-pods-${{ hashFiles('**/Podfile.lock') }}
          restore-keys: |
            ${{ runner.os }}-pods-
      
      - name: Install dependencies
        run: |
          npm ci
          cd ios && pod install
      
      - name: Run SwiftLint
        run: cd ios && swiftlint
      
      - name: Run iOS tests
        run: |
          cd ios
          xcodebuild test \
            -workspace RNDLScan.xcworkspace \
            -scheme RNDLScan \
            -destination 'platform=iOS Simulator,name=iPhone 14' \
            -enableCodeCoverage YES
      
      - name: Generate coverage report
        run: |
          cd ios
          xcrun xccov view --report --json DerivedData/Build/Logs/Test/*.xcresult > coverage.json
      
      - name: Upload iOS coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./ios/coverage.json
          flags: ios

  test-android:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup JDK
        uses: actions/setup-java@v3
        with:
          java-version: ${{ env.JAVA_VERSION }}
          distribution: 'temurin'
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Cache Gradle
        uses: actions/cache@v3
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run Android lint
        run: cd android && ./gradlew lint
      
      - name: Run Android tests
        run: cd android && ./gradlew test
      
      - name: Upload Android test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: android-test-results
          path: android/app/build/reports/tests

  e2e-tests:
    needs: [test-js, test-ios, test-android]
    runs-on: macos-latest
    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup environment
        uses: ./.github/actions/setup-e2e
      
      - name: Build apps for E2E
        run: |
          npm run e2e:build:ios
          npm run e2e:build:android
      
      - name: Run E2E tests - iOS
        run: npm run e2e:test:ios
      
      - name: Run E2E tests - Android
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 31
          target: google_apis
          arch: x86_64
          script: npm run e2e:test:android
      
      - name: Upload E2E artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-artifacts
          path: |
            e2e/artifacts
            e2e/reports

  performance-check:
    needs: [test-js]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run performance benchmarks
        run: npm run benchmark
      
      - name: Compare with baseline
        uses: benchmark-action/github-action-benchmark@v1
        with:
          tool: 'customBiggerIsBetter'
          output-file-path: benchmark-results.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
          auto-push: true
          alert-threshold: '110%'
          comment-on-alert: true
          fail-on-alert: true

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run npm audit
        run: npm audit --production
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      
      - name: SAST with CodeQL
        uses: github/codeql-action/analyze@v2
```

### Quality Gates Configuration
```yaml
# .github/workflows/quality-gates.yml
name: Quality Gates

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  check-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Check code coverage
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Code coverage $COVERAGE% is below threshold of 80%"
            exit 1
          fi
      
      - name: Check bundle size
        run: |
          MAX_SIZE=500000  # 500KB
          ACTUAL_SIZE=$(stat -f%z dist/bundle.js)
          if [ $ACTUAL_SIZE -gt $MAX_SIZE ]; then
            echo "Bundle size $ACTUAL_SIZE exceeds limit of $MAX_SIZE"
            exit 1
          fi
      
      - name: Check performance metrics
        run: |
          npm run lighthouse:ci
```

### Deployment Workflow
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    tags:
      - 'v*'

jobs:
  deploy-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup certificates
        env:
          CERTIFICATE_BASE64: ${{ secrets.IOS_CERTIFICATE_BASE64 }}
          PROVISION_PROFILE_BASE64: ${{ secrets.IOS_PROVISION_PROFILE_BASE64 }}
        run: |
          echo "$CERTIFICATE_BASE64" | base64 --decode > certificate.p12
          echo "$PROVISION_PROFILE_BASE64" | base64 --decode > profile.mobileprovision
          
          security create-keychain -p "" build.keychain
          security import certificate.p12 -k build.keychain -P "${{ secrets.CERTIFICATE_PASSWORD }}" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
          
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp profile.mobileprovision ~/Library/MobileDevice/Provisioning\ Profiles/
      
      - name: Build iOS app
        run: |
          cd ios
          xcodebuild archive \
            -workspace RNDLScan.xcworkspace \
            -scheme RNDLScan \
            -configuration Release \
            -archivePath build/RNDLScan.xcarchive
      
      - name: Export IPA
        run: |
          cd ios
          xcodebuild -exportArchive \
            -archivePath build/RNDLScan.xcarchive \
            -exportPath build \
            -exportOptionsPlist ExportOptions.plist
      
      - name: Upload to TestFlight
        env:
          APP_STORE_CONNECT_API_KEY: ${{ secrets.APP_STORE_CONNECT_API_KEY }}
        run: |
          xcrun altool --upload-app \
            --type ios \
            --file ios/build/RNDLScan.ipa \
            --apiKey "$APP_STORE_CONNECT_API_KEY"

  deploy-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup signing
        env:
          KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          echo "$KEYSTORE_BASE64" | base64 --decode > android/app/release.keystore
      
      - name: Build Android app
        env:
          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          cd android
          ./gradlew assembleRelease
      
      - name: Upload to Play Store
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_STORE_SERVICE_ACCOUNT }}
          packageName: com.example.rndlscan
          releaseFiles: android/app/build/outputs/apk/release/app-release.apk
          track: internal
```

### Performance Monitoring Script
```javascript
// scripts/performance-benchmark.js
const { performance } = require('perf_hooks');
const { DLParser } = require('../dist/parser');

const benchmarks = {
  pdf417Parsing: async () => {
    const testData = loadTestPDF417Data();
    const start = performance.now();
    
    for (let i = 0; i < 1000; i++) {
      await DLParser.parse(testData);
    }
    
    const end = performance.now();
    return {
      name: 'PDF417 Parsing',
      value: 1000 / ((end - start) / 1000), // ops/sec
      unit: 'ops/sec'
    };
  },
  
  ocrProcessing: async () => {
    const testImage = loadTestImage();
    const start = performance.now();
    
    for (let i = 0; i < 100; i++) {
      await processOCR(testImage);
    }
    
    const end = performance.now();
    return {
      name: 'OCR Processing',
      value: (end - start) / 100, // ms/operation
      unit: 'ms'
    };
  }
};

// Export results for CI
const results = await runBenchmarks(benchmarks);
fs.writeFileSync('benchmark-results.json', JSON.stringify(results));
```

## Dependencies
- GitHub Actions
- Node.js build tools
- Xcode command line tools
- Android SDK
- Fastlane (optional)
- Code coverage tools
- Security scanning tools

## Risks & Mitigations
- **Risk**: Long CI build times
  - **Mitigation**: Implement aggressive caching and parallel jobs
- **Risk**: Flaky E2E tests in CI
  - **Mitigation**: Run E2E tests with retry logic
- **Risk**: Secret management complexity
  - **Mitigation**: Use GitHub secrets and environment protection rules

## Success Metrics
- CI pipeline runs in < 15 minutes for PRs
- 100% of PRs pass quality gates before merge
- Deployment pipeline success rate > 95%
- Zero security vulnerabilities in production
- Automated performance regression detection