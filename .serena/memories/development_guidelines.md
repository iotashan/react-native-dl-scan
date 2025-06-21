# Development Guidelines

## Architecture Patterns

### TurboModule Pattern
- Use TurboModule for all native functionality
- Define TypeScript interfaces that match native specs
- Export through single index.tsx entry point
- Leverage automatic codegen for native bindings

### Error Handling
- Use Result<T, E> pattern for fallible operations
- Provide descriptive error messages with error codes
- Handle platform-specific errors gracefully
- Document all possible error conditions

### Type Safety
- Strict TypeScript configuration enforced
- No any types allowed
- Comprehensive null/undefined checking
- Generic types for flexible APIs

## Design Patterns

### React Native Integration
- Follow React Native new architecture patterns
- Use hooks for component state management
- Provide context providers for global state
- Support both iOS and Android (future)

### Native Module Design
- Single responsibility principle for native methods
- Async operations return Promises
- Use proper memory management in Objective-C++
- Handle threading appropriately

### API Design
- Intuitive function names and parameters
- Consistent error handling across all methods
- Comprehensive TypeScript documentation
- Backward compatibility considerations

## Testing Strategy
- Unit tests for all business logic
- Integration tests for native bridge
- Example app for manual testing
- Automated CI/CD validation

## Security Considerations
- No sensitive data in source code
- Proper input validation and sanitization
- Secure handling of camera permissions
- Privacy-compliant data processing

## Performance Guidelines
- Optimize for mobile device constraints
- Minimize JavaScript bridge calls
- Efficient memory usage in native code
- Lazy loading of heavy resources