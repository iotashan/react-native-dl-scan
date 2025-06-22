---
task_id: T02_S05
sprint_sequence_id: S05
status: open
complexity: Medium
last_updated: 2025-06-21T18:50:00Z
---

# Task: Unified Scanning Hook with Dual-Mode Support

## Description
Enhance the existing `useLicenseScanner` React hook to provide unified dual-mode scanning capabilities, supporting both PDF417 barcode and OCR scanning through a single, consistent interface. This creates a seamless developer experience for both scanning methods.

## Goal / Objectives
Create a unified scanning interface that abstracts the complexity of dual-mode scanning while providing full control and transparency to developers.
- Extend existing `useLicenseScanner` with dual-mode capabilities
- Maintain backward compatibility with existing barcode-only usage
- Provide consistent API for both scanning methods
- Add comprehensive state management for fallback scenarios

## Acceptance Criteria
- [ ] Enhanced `useLicenseScanner` hook supports mode parameter ('auto', 'barcode', 'ocr')
- [ ] Backward compatibility maintained for existing barcode scanning usage
- [ ] Consistent `LicenseData` format returned regardless of scanning method
- [ ] State management includes current scanning mode and transition status
- [ ] Error handling unified across both scanning methods
- [ ] Performance metrics available for both barcode and OCR processing
- [ ] TypeScript types updated for dual-mode functionality

## Technical Guidance

### Key Integration Points
- **Existing Hook**: Extend current `useLicenseScanner` in `src/hooks/useLicenseScanner.ts`
- **Fallback Logic**: Integrate T01_S05 automatic fallback controller
- **OCR Integration**: Interface with S04 field parsing engine
- **Type Consistency**: Ensure `LicenseData` format consistency across modes

### Existing Patterns to Follow
- **Hook Structure**: Maintain existing state and action patterns from `useLicenseScanner.ts:6-83`
- **Error Interface**: Use established `ScanError` class and handling patterns
- **Async Operations**: Follow existing promise-based scanning in `scan()` method
- **State Management**: Extend existing useState patterns for new mode tracking

### Implementation Notes

**Enhanced Hook Interface:**
```typescript
interface LicenseScannerOptions {
  mode: 'auto' | 'barcode' | 'ocr';
  barcodeTimeout?: number;
  enableFallback?: boolean;
  confidenceThreshold?: number;
}

interface EnhancedLicenseScannerState {
  licenseData: LicenseData | null;
  isScanning: boolean;
  error: ScanError | null;
  currentMode: 'barcode' | 'ocr' | 'switching';
  scanningProgress: number;
  performanceMetrics: ScanMetrics;
}
```

**Dual-Mode Architecture:**
1. **Mode Selection**: Automatic or manual mode selection
2. **Scanning Coordination**: Manage barcode and OCR scanning processes
3. **Data Normalization**: Ensure consistent LicenseData format
4. **State Synchronization**: Track scanning state across modes
5. **Error Unification**: Provide consistent error handling

**Integration Points:**
- **Frame Processing**: Coordinate both PDF417 and OCR frame processors
- **Fallback Control**: Interface with automatic fallback logic
- **Performance Tracking**: Monitor and report scanning performance metrics
- **State Management**: Unified state for complex scanning scenarios

## Testing Requirements

### Unit Tests
- [ ] Test enhanced hook interface with all mode parameters ('auto', 'barcode', 'ocr')
- [ ] Validate `LicenseScannerState` extension with mode tracking functionality
- [ ] Test mode selection and validation logic with various input scenarios
- [ ] Verify scanning progress tracking accuracy and user feedback integration
- [ ] Test unified error handling consistency across both scanning methods
- [ ] Validate performance metrics collection and reporting accuracy
- [ ] Test data normalization ensuring consistent LicenseData format

### Integration Tests
- [ ] Test complete dual-mode hook with T01_S05 fallback controller integration
- [ ] Validate backward compatibility with existing barcode-only usage patterns
- [ ] Test TypeScript type safety across all hook interface variations
- [ ] Verify configuration options (timeout, thresholds) integration with hook state

### Simulator Testing with Camera Mocking
- [ ] Mock both PDF417 and OCR frame processing for dual-mode testing
- [ ] Test hook state transitions during automatic mode switching
- [ ] Mock performance metrics collection during simulated scanning sessions
- [ ] Test progress tracking with simulated scanning delays and transitions

### Test Scenarios
1. **Auto Mode Testing**: Automatic fallback from barcode to OCR
2. **Explicit Barcode Mode**: Hook configured for barcode-only scanning
3. **Explicit OCR Mode**: Hook configured for OCR-only scanning
4. **Backward Compatibility**: Existing code using hook without mode parameter
5. **Configuration Testing**: Various timeout and threshold combinations
6. **Error Handling Consistency**: Same error interface regardless of scanning mode
7. **Performance Monitoring**: Metrics collection across all scanning modes
8. **State Transition Testing**: Hook state changes during mode switching

### Test Fixtures and Mock Data
- [ ] Mock LicenseData samples from both barcode and OCR sources
- [ ] Performance metrics mock data for validation testing
- [ ] Error scenarios for both scanning methods with consistent ScanError format
- [ ] Configuration test scenarios (timeouts: 1s-10s, thresholds: 0.1-0.9)
- [ ] Progress tracking mock data for UI state testing
- [ ] TypeScript type validation test cases for hook interface
- [ ] Backward compatibility test scenarios with legacy hook usage

### Subtasks
- [ ] Design enhanced hook interface with dual-mode support
- [ ] Extend existing `LicenseScannerState` with mode tracking
- [ ] Implement mode selection and validation logic
- [ ] Add scanning progress tracking for user feedback
- [ ] Create unified error handling for both scanning methods
- [ ] Implement performance metrics collection and reporting
- [ ] Add data normalization for consistent LicenseData format
- [ ] Create comprehensive TypeScript type definitions
- [ ] Build backward compatibility layer for existing usage
- [ ] Add configuration options for timeout and thresholds
- [ ] **Create comprehensive unit test suite for dual-mode hook functionality**
- [ ] **Build integration tests with fallback controller and scanning pipeline**
- [ ] **Implement mock framework for dual-mode simulator testing**
- [ ] **Create TypeScript type safety validation tests**
- [ ] **Add backward compatibility verification test suite**
- [ ] **Build performance metrics testing and validation framework**

## Output Log
*(This section is populated as work progresses on the task)*