# Task Completion Checklist

## Required Steps After Code Changes

### 1. Code Quality Checks
```bash
# Type checking - MUST pass
yarn typecheck

# Linting - MUST pass  
yarn lint

# Testing - MUST pass
yarn test
```

### 2. Build Verification
```bash
# Clean and rebuild
yarn clean
yarn prepare
```

### 3. Example App Testing
```bash
# Test in example app if applicable
yarn example ios
# or
yarn example android
```

### 4. Pre-commit Validation
- Lefthook will automatically run:
  - ESLint on staged files
  - TypeScript compilation
  - Commit message validation

### 5. Documentation Updates
- Update README.md if public API changes
- Update CHANGELOG.md for notable changes
- Update TypeScript interfaces if needed

## Quality Gates
- ✅ All TypeScript errors resolved
- ✅ All ESLint warnings/errors fixed
- ✅ All tests passing
- ✅ Example app builds and runs
- ✅ Native iOS compilation successful
- ✅ No build artifacts committed

## Release Checklist (if applicable)
- Version bump follows semantic versioning
- Conventional commit messages used
- CHANGELOG.md updated
- All dependencies up to date
- Library builds successfully