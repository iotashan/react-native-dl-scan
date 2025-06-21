# Suggested Commands

## Development Commands
```bash
# Install dependencies
yarn install

# Type checking
yarn typecheck
# Alternative: npx tsc

# Linting
yarn lint
# Alternative: npx eslint "**/*.{js,ts,tsx}"

# Testing
yarn test
# Alternative: npx jest

# Clean build artifacts
yarn clean
```

## Build Commands
```bash
# Build the library
yarn prepare
# Alternative: npx bob build

# Release (version only)
yarn release
```

## Example App Commands
```bash
# Run example app commands
yarn example <command>

# Example iOS
yarn example ios

# Example Android  
yarn example android
```

## Git Hooks (Automated)
```bash
# Pre-commit (runs automatically)
- ESLint on staged files
- TypeScript type checking

# Commit message validation
- Conventional commit format required
```

## System Commands (macOS)
```bash
# Basic file operations
ls          # List files
find        # Search files
grep        # Search content
git         # Version control
```

## Package Management
```bash
# Add dependency
yarn add <package>

# Add dev dependency  
yarn add -D <package>

# Workspace commands
yarn workspace <workspace-name> <command>
```