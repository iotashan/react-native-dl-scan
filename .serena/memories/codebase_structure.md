# Codebase Structure

## Root Directory
```
├── src/                    # TypeScript source code
│   ├── index.tsx          # Main library export
│   └── NativeDlScan.ts    # TurboModule interface
├── ios/                   # iOS native implementation
│   ├── DlScan.h          # Objective-C header
│   └── DlScan.mm         # Objective-C++ implementation  
├── example/              # Demo React Native app
├── lib/                  # Built output (generated)
└── docs/                 # Documentation files
```

## Key Files
- **package.json**: Project configuration and scripts
- **tsconfig.json**: TypeScript configuration (strict mode)
- **eslint.config.mjs**: ESLint rules and formatting
- **lefthook.yml**: Git hooks configuration
- **DlScan.podspec**: iOS CocoaPods spec
- **react-native.config.js**: React Native configuration

## Source Code Organization
- **src/index.tsx**: Main API exports and public interface
- **src/NativeDlScan.ts**: TurboModule specification and registration
- **ios/DlScan.h**: Native module header with protocol
- **ios/DlScan.mm**: Native implementation with TurboModule support

## Documentation Structure
- **AAMVA_IMPLEMENTATION.md**: Driver's license standard spec
- **ARCHITECTURE_DIAGRAMS.md**: System design diagrams
- **ERROR_HANDLING.md**: Error handling patterns
- **TESTING_STRATEGY.md**: Testing approach and guidelines
- **INTERNATIONALIZATION.md**: i18n considerations

## Build Artifacts
- **lib/module/**: ESM build output
- **lib/typescript/**: TypeScript definitions
- **android/build/**: Android build cache (gitignored)
- **ios/build/**: iOS build cache (gitignored)

## Configuration Files
- **.nvmrc**: Node.js version specification
- **.yarnrc.yml**: Yarn 3 configuration
- **.watchmanconfig**: React Native file watching
- **.editorconfig**: Editor settings standardization