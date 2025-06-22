---
task_id: T01_S06
sprint_sequence_id: S06
status: planned
complexity: Medium
last_updated: 2025-06-22T12:00:00Z
---

# Task: Camera View Component Setup

## Description
Set up the main camera view component that integrates both PDF417 and OCR scanning modes, building upon the existing CameraScanner component. This task extends the current single-mode PDF417 scanner to support dual-mode operation, preparing the foundation for automatic mode switching and unified scanning experience. The component will maintain the existing frame processor architecture while adding mode management capabilities and state handling for both scanning approaches.

## Goal / Objectives
- Extend existing CameraScanner component to support dual-mode operation (PDF417 and OCR)
- Implement mode state management infrastructure for future mode switching
- Maintain existing performance characteristics while preparing for OCR integration
- Create clean separation between mode-specific logic and shared camera functionality
- Establish foundation for automatic mode switching based on scan failures
- Preserve existing error handling and quality check patterns

## Acceptance Criteria
- [ ] CameraScanner component refactored to support mode switching architecture
- [ ] Mode state management implemented with clear separation of concerns
- [ ] Existing PDF417 scanning functionality preserved without regression
- [ ] OCR mode infrastructure prepared (hooks for future OCR frame processor)
- [ ] Component maintains 30fps camera preview performance
- [ ] Error handling extended to support mode-specific error scenarios
- [ ] Unit tests updated to cover multi-mode component behavior
- [ ] TypeScript interfaces defined for mode configuration and state
- [ ] Component remains backwards compatible with existing integration

## Subtasks
- [ ] Analyze existing CameraScanner component architecture and dependencies
  - [ ] Document current frame processor integration points
  - [ ] Identify mode-specific vs shared functionality
  - [ ] Map out state management requirements for dual-mode operation
  
- [ ] Refactor CameraScanner for mode support
  - [ ] Extract PDF417-specific logic into separate concern
  - [ ] Create mode configuration interface (ScanMode: 'pdf417' | 'ocr' | 'auto')
  - [ ] Implement mode state management using React hooks
  - [ ] Add mode-specific frame processor selection logic
  
- [ ] Implement shared camera functionality
  - [ ] Maintain existing permission handling and UI states
  - [ ] Preserve camera configuration (torch, zoom, etc.)
  - [ ] Keep quality check integration points
  - [ ] Ensure overlay and instruction text can adapt to mode
  
- [ ] Prepare OCR integration points
  - [ ] Create placeholder for OCR frame processor hook
  - [ ] Define OCR-specific result interface extending LicenseData
  - [ ] Add OCR mode error handling infrastructure
  - [ ] Implement mode-specific timeout and retry logic
  
- [ ] Update state management architecture
  - [ ] Implement scanning mode state with proper TypeScript types
  - [ ] Add mode transition handling (prepare for auto-switching)
  - [ ] Create hooks for mode-specific configuration
  - [ ] Maintain existing scan attempt tracking per mode
  
- [ ] Enhance error handling for multi-mode operation
  - [ ] Extend error types to include mode context
  - [ ] Implement mode-specific error recovery strategies
  - [ ] Add fallback triggers for future auto-mode switching
  - [ ] Preserve existing error UI patterns
  
- [ ] Update component props and interfaces
  - [ ] Add optional mode prop with default to 'auto'
  - [ ] Create mode change callback for parent components
  - [ ] Define mode-specific configuration options
  - [ ] Maintain backward compatibility with existing props
  
- [ ] Write comprehensive tests
  - [ ] Unit tests for mode state management
  - [ ] Integration tests for mode switching logic
  - [ ] Performance tests ensuring 30fps maintained
  - [ ] Error scenario tests for each mode

## Implementation Context

### Current Architecture Integration
- **CameraScanner.tsx**: Existing component using react-native-vision-camera with PDF417 frame processor
- **scanLicense frame processor**: Current PDF417-specific implementation to be abstracted
- **Error handling patterns**: Established error recovery and user feedback mechanisms
- **Quality checks**: Existing frame quality validation that applies to both modes

### Technical Approach
- **Mode Management**: Use React state with proper TypeScript discriminated unions
- **Frame Processor Selection**: Dynamic selection based on current mode
- **Performance**: Maintain single frame processor instance, switch logic internally
- **State Persistence**: Consider mode preference persistence for future enhancement

### Mode Architecture Design
```typescript
type ScanMode = 'pdf417' | 'ocr' | 'auto';

interface ScanModeConfig {
  mode: ScanMode;
  frameProcessorConfig?: FrameProcessorConfig;
  timeoutMs?: number;
  maxAttempts?: number;
}
```

### Integration Considerations
- Preserve existing CameraScanner public API for backward compatibility
- Ensure mode switching doesn't interrupt camera preview
- Maintain smooth UI transitions between modes
- Keep existing permission and error handling flows intact
- Prepare for S07 automatic mode switching implementation

## Output Log
*(This section is populated as work progresses on the task)*

[2025-06-22 12:00] Task created - Ready for implementation