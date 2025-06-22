# T03 S09: NPM Package Preparation

**🎯 Objective**: Prepare and configure the react-native-dl-scan package for NPM release with proper versioning, build scripts, and examples.

**⏱️ Estimated Effort**: 2 days  
**🔧 Complexity**: Low  
**🏷️ Priority**: High  
**📋 Prerequisites**: All features complete, documentation ready  

## 📝 Requirements

### Package Configuration
- [ ] Optimize package.json for NPM publication
- [ ] Configure proper entry points and exports
- [ ] Set up peer dependencies correctly
- [ ] Add all necessary metadata

### Build Scripts
- [ ] Create production build scripts
- [ ] Set up TypeScript compilation
- [ ] Configure bundle optimization
- [ ] Add pre-publish validation

### Example Projects
- [ ] Create basic usage example
- [ ] Add advanced features example
- [ ] Include custom UI example
- [ ] Provide integration examples

### Semantic Versioning
- [ ] Set up semantic-release
- [ ] Configure changelog generation
- [ ] Add version bump scripts
- [ ] Set up release automation

## 🔍 Acceptance Criteria

1. **Package Quality**
   - Package size < 500KB
   - No unnecessary files included
   - All dependencies properly declared
   - TypeScript definitions included

2. **Build Process**
   - Clean build without warnings
   - Proper source maps generated
   - Examples build successfully
   - Tests pass before publish

3. **Documentation**
   - README complete and accurate
   - CHANGELOG maintained
   - LICENSE file included
   - CONTRIBUTING guide added

## 🚀 Implementation Tasks

### Task 1: Optimized package.json
```json
{
  "name": "react-native-dl-scan",
  "version": "1.0.0",
  "description": "High-performance driver's license scanner for React Native with PDF417 and OCR support",
  "main": "lib/commonjs/index.js",
  "module": "lib/module/index.js",
  "types": "lib/typescript/index.d.ts",
  "react-native": "src/index.ts",
  "source": "src/index.ts",
  "files": [
    "src",
    "lib",
    "ios",
    "android",
    "!**/__tests__",
    "!**/__fixtures__",
    "!**/__mocks__"
  ],
  "scripts": {
    "prepare": "bob build",
    "typescript": "tsc --noEmit",
    "lint": "eslint \"**/*.{js,ts,tsx}\"",
    "test": "jest",
    "release": "semantic-release",
    "example": "yarn --cwd example",
    "pods": "cd example && pod-install --quiet",
    "bootstrap": "yarn example && yarn && yarn pods"
  },
  "keywords": [
    "react-native",
    "ios",
    "android",
    "driver-license",
    "scanner",
    "pdf417",
    "ocr",
    "barcode",
    "ml-kit",
    "vision"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yourusername/react-native-dl-scan.git"
  },
  "author": "Your Name <email@example.com>",
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/yourusername/react-native-dl-scan/issues"
  },
  "homepage": "https://github.com/yourusername/react-native-dl-scan#readme",
  "publishConfig": {
    "registry": "https://registry.npmjs.org/"
  },
  "peerDependencies": {
    "react": "*",
    "react-native": "*",
    "react-native-vision-camera": "^2.15.0"
  },
  "devDependencies": {
    "@commitlint/config-conventional": "^17.0.0",
    "@react-native-community/eslint-config": "^3.0.0",
    "@semantic-release/changelog": "^6.0.0",
    "@semantic-release/git": "^10.0.0",
    "@types/jest": "^28.1.0",
    "@types/react": "^18.0.0",
    "@types/react-native": "^0.70.0",
    "commitlint": "^17.0.0",
    "eslint": "^8.0.0",
    "jest": "^28.1.0",
    "pod-install": "^0.1.0",
    "prettier": "^2.7.0",
    "react": "18.2.0",
    "react-native": "0.71.0",
    "react-native-builder-bob": "^0.20.0",
    "semantic-release": "^19.0.0",
    "typescript": "^4.8.0"
  },
  "react-native-builder-bob": {
    "source": "src",
    "output": "lib",
    "targets": [
      "commonjs",
      "module",
      "typescript"
    ]
  },
  "jest": {
    "preset": "react-native",
    "modulePathIgnorePatterns": [
      "<rootDir>/example/node_modules",
      "<rootDir>/lib/"
    ]
  },
  "commitlint": {
    "extends": [
      "@commitlint/config-conventional"
    ]
  },
  "eslintConfig": {
    "root": true,
    "extends": [
      "@react-native-community",
      "prettier"
    ]
  },
  "prettier": {
    "singleQuote": true,
    "trailingComma": "es5",
    "tabWidth": 2
  }
}
```

### Task 2: Semantic Release Configuration
```javascript
// .releaserc.js
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    '@semantic-release/npm',
    '@semantic-release/github',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
      }
    ]
  ]
};
```

### Task 3: Build Configuration
```javascript
// react-native-builder-bob.config.js
module.exports = {
  source: 'src',
  output: 'lib',
  targets: [
    [
      'commonjs',
      {
        configFile: './tsconfig.build.json'
      }
    ],
    [
      'module',
      {
        configFile: './tsconfig.build.json'
      }
    ],
    [
      'typescript',
      {
        project: 'tsconfig.build.json'
      }
    ]
  ],
  exclude: '**/{__tests__,__fixtures__,__mocks__}/**'
};
```

### Task 4: Example Project Structure
```typescript
// example/src/BasicExample.tsx
import React, { useState } from 'react';
import { View, Text, Button } from 'react-native';
import { DLScanner, ScanResult } from 'react-native-dl-scan';

export const BasicExample: React.FC = () => {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const handleScanComplete = (scanResult: ScanResult) => {
    setResult(scanResult);
    setShowScanner(false);
  };

  if (showScanner) {
    return (
      <DLScanner
        onScanComplete={handleScanComplete}
        onError={(error) => console.error('Scan error:', error)}
      />
    );
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Button
        title="Start Scanning"
        onPress={() => setShowScanner(true)}
      />
      {result && (
        <View style={{ marginTop: 20 }}>
          <Text>Name: {result.firstName} {result.lastName}</Text>
          <Text>License #: {result.licenseNumber}</Text>
          <Text>Expiry: {result.expiryDate}</Text>
        </View>
      )}
    </View>
  );
};

// example/src/AdvancedExample.tsx
import React from 'react';
import { DLScanner, useDLScanner } from 'react-native-dl-scan';
import { CustomScannerUI } from './components/CustomScannerUI';

export const AdvancedExample: React.FC = () => {
  const {
    mode,
    switchMode,
    quality,
    isScanning,
    startScan,
    stopScan
  } = useDLScanner();

  return (
    <DLScanner
      mode={mode}
      customUI={CustomScannerUI}
      onScanComplete={(result) => {
        console.log('Advanced scan result:', result);
        // Handle result with custom logic
      }}
      options={{
        enableVibration: true,
        enableSound: true,
        qualityThreshold: 0.8,
        timeout: 30000
      }}
    />
  );
};
```

### Task 5: Pre-publish Validation
```javascript
// scripts/prepublish.js
const fs = require('fs');
const path = require('path');

function validatePackage() {
  const errors = [];
  
  // Check package.json
  const pkg = require('../package.json');
  
  if (!pkg.version) {
    errors.push('Missing version in package.json');
  }
  
  if (!pkg.main || !fs.existsSync(path.join(__dirname, '..', pkg.main))) {
    errors.push('Main entry point not found');
  }
  
  if (!pkg.types || !fs.existsSync(path.join(__dirname, '..', pkg.types))) {
    errors.push('TypeScript definitions not found');
  }
  
  // Check required files
  const requiredFiles = ['README.md', 'LICENSE', 'CHANGELOG.md'];
  requiredFiles.forEach(file => {
    if (!fs.existsSync(path.join(__dirname, '..', file))) {
      errors.push(`Missing required file: ${file}`);
    }
  });
  
  // Check build output
  if (!fs.existsSync(path.join(__dirname, '../lib'))) {
    errors.push('Build output not found. Run "yarn prepare" first.');
  }
  
  if (errors.length > 0) {
    console.error('Pre-publish validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  
  console.log('✅ Pre-publish validation passed');
}

validatePackage();
```

### Task 6: NPM Scripts
```json
{
  "scripts": {
    "clean": "rm -rf lib/",
    "prepare": "yarn clean && bob build",
    "prepublishOnly": "yarn test && yarn typescript && yarn lint && node scripts/prepublish.js",
    "version": "yarn changelog && git add CHANGELOG.md",
    "postversion": "git push && git push --tags",
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s",
    "size": "size-limit",
    "analyze": "source-map-explorer lib/module/index.js"
  }
}
```

## 📁 Package Structure
```
react-native-dl-scan/
├── src/
│   └── index.ts
├── lib/
│   ├── commonjs/
│   ├── module/
│   └── typescript/
├── ios/
│   └── DLScan.xcodeproj
├── android/
│   └── build.gradle
├── example/
│   ├── src/
│   ├── ios/
│   └── android/
├── scripts/
│   ├── prepublish.js
│   └── postinstall.js
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── README.md
├── LICENSE
├── CHANGELOG.md
└── .npmignore
```

## ✅ Completion Checklist

- [ ] package.json fully configured
- [ ] Build process optimized
- [ ] Examples created and tested
- [ ] Semantic versioning set up
- [ ] Pre-publish validation working
- [ ] NPM account configured
- [ ] First release published

## 🔗 References
- NPM Publishing Guide: https://docs.npmjs.com/packages-and-modules
- Semantic Release: https://semantic-release.gitbook.io/
- React Native Builder Bob: https://github.com/callstack/react-native-builder-bob