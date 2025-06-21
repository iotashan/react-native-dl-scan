# Code Style and Conventions

## TypeScript Configuration
- **Strict mode**: Enabled with comprehensive checks
- **No unused parameters/locals**: Enforced
- **No unchecked indexed access**: Enabled for safety
- **ESNext target**: Modern JavaScript features
- **JSX**: react-jsx transform

## Code Formatting (Prettier)
- **Single quotes**: Required
- **Tab width**: 2 spaces
- **Trailing commas**: ES5 style
- **Quote props**: Consistent
- **No tabs**: Use spaces only

## ESLint Rules
- **React Native config**: Base configuration
- **React in JSX scope**: Disabled (modern JSX transform)
- **Prettier integration**: Enforced as errors

## File Organization
- **src/**: TypeScript source code
- **ios/**: Native iOS implementation (.h/.mm files)
- **example/**: Demo application
- **lib/**: Built output (generated)

## Naming Conventions
- **camelCase**: Functions and variables
- **PascalCase**: Components and interfaces
- **kebab-case**: File names
- **SCREAMING_SNAKE_CASE**: Constants

## Native Code Style
- **Objective-C++**: iOS implementation
- **RCT_EXPORT_MODULE**: Module registration
- **TurboModule**: Modern native module pattern

## Git Conventions
- **Conventional commits**: Required via commitlint
- **Pre-commit hooks**: Lint and type checking
- **Angular preset**: For changelog generation