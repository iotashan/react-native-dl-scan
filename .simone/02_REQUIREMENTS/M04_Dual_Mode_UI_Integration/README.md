# M03 - Dual-Mode UI & Integration

**Timeline:** Week 4  
**Status:** 📋 PLANNED  
**Priority:** HIGH

## Milestone Overview

Create a comprehensive user interface that seamlessly integrates PDF417 barcode scanning and front-side OCR fallback. This milestone focuses on intelligent mode switching, user guidance, and creating an intuitive scanning experience with real-time feedback.

## Success Criteria

✅ **Dual-Mode Interface:** Toggle between barcode and front-side scanning modes  
✅ **Intelligent Auto Mode:** Automatic fallback from barcode to OCR scanning  
✅ **Real-time Guidance:** Visual feedback and positioning instructions  
✅ **Quality Indicators:** Live image quality assessment and user guidance  
✅ **Error Recovery:** Graceful handling with retry mechanisms  
✅ **Performance UI:** Smooth 30fps camera preview with processing overlay  
✅ **Accessibility:** VoiceOver support and accessibility features

## Technical Requirements

### Core UI Components
- **Camera View:** Full-screen camera with overlay guidance
- **Mode Selector:** Toggle between Auto/Barcode/OCR modes
- **Scanning Overlay:** Visual frame guides and quality indicators
- **Status Display:** Real-time scanning status and instructions
- **Result Screen:** License data display with validation

### State Management
- **Scanning States:** Idle, searching, processing, success, error
- **Mode Management:** Auto mode logic with intelligent switching
- **Quality Tracking:** Real-time image quality assessment
- **Progress Indicators:** Visual feedback for processing steps

### User Experience Features
- **Smart Guidance:** Context-aware instructions (flip card, improve lighting, etc.)
- **Quality Feedback:** Real-time blur/lighting/positioning indicators
- **Success Animation:** Clear visual confirmation of successful scans
- **Error Guidance:** Specific recovery instructions for different error types

## Implementation Phases

### Phase 3.1: Core UI Components
- Create camera view with Vision Camera integration
- Build scanning overlay with visual guides
- Implement mode selector and state management
- Add basic error and success displays

### Phase 3.2: Intelligent Mode Switching
- Implement auto mode with timeout-based fallback
- Add quality-based mode recommendations
- Create smooth transitions between scanning modes
- Build context-aware user guidance system

### Phase 3.3: Polish & Accessibility
- Add animations and visual polish
- Implement accessibility features
- Optimize performance for smooth camera preview
- Add comprehensive error recovery flows

## UI Architecture

### Component Structure

```typescript
// Main scanning interface
<LicenseScanner>
  <CameraView />
  <ScanningOverlay>
    <FrameGuide />
    <QualityIndicator />
    <StatusMessage />
  </ScanningOverlay>
  <ModeSelector />
  <ControlBar />
</LicenseScanner>
```

### State Management

```typescript
interface ScannerState {
  mode: 'auto' | 'barcode' | 'ocr';
  status: 'idle' | 'searching' | 'processing' | 'success' | 'error';
  quality: {
    blur: number;
    lighting: number;
    positioning: number;
    overall: 'good' | 'fair' | 'poor';
  };
  guidance: {
    message: string;
    action?: 'flip_card' | 'improve_lighting' | 'hold_steady' | 'move_closer';
  };
  result?: LicenseData;
  error?: ScanError;
}
```

### Mode Switching Logic

```typescript
class AutoModeController {
  private barcodeTimeout = 10000; // 10 seconds
  private ocrTimeout = 15000; // 15 seconds
  
  async processFrame(frame: Frame): Promise<void> {
    switch (this.currentMode) {
      case 'searching_barcode':
        await this.tryBarcodeDetection(frame);
        if (this.timeoutExceeded()) {
          this.switchToOCRMode();
        }
        break;
        
      case 'searching_ocr':
        await this.tryOCRDetection(frame);
        break;
    }
  }
  
  private switchToOCRMode(): void {
    this.updateGuidance({
      message: "Flip card to show the front side",
      action: 'flip_card'
    });
    this.currentMode = 'searching_ocr';
  }
}
```

## User Interface Design

### Scanning Overlay Components

```typescript
// Real-time quality indicator
<QualityIndicator 
  blur={quality.blur}
  lighting={quality.lighting}
  positioning={quality.positioning}
  overall={quality.overall}
/>

// Context-sensitive guidance
<GuidanceDisplay
  message={guidance.message}
  action={guidance.action}
  animated={true}
/>

// Visual frame guide
<FrameGuide
  mode={currentMode}
  detected={documentDetected}
  quality={quality.overall}
/>
```

### Mode Selector Interface

```typescript
<ModeSelector>
  <ModeButton 
    mode="auto" 
    active={currentMode === 'auto'}
    icon="auto-scan"
    label="Auto"
  />
  <ModeButton 
    mode="barcode" 
    active={currentMode === 'barcode'}
    icon="barcode"
    label="Barcode"
  />
  <ModeButton 
    mode="ocr" 
    active={currentMode === 'ocr'}
    icon="text-recognition"
    label="Front Side"
  />
</ModeSelector>
```

### Result Display

```typescript
<ResultScreen licenseData={result}>
  <LicensePreview data={result} />
  <FieldValidation fields={result} />
  <ActionButtons>
    <Button onPress={acceptResult}>Accept</Button>
    <Button onPress={retryScanning}>Scan Again</Button>
  </ActionButtons>
</ResultScreen>
```

## Real-time Guidance System

### Context-Aware Messages

```typescript
const guidanceMessages = {
  auto_mode: {
    initial: "Position the back of your license in the frame",
    barcode_searching: "Looking for barcode...",
    barcode_timeout: "Flip card to show the front side",
    ocr_searching: "Reading license information...",
  },
  barcode_mode: {
    initial: "Position the barcode in the frame",
    searching: "Scanning barcode...",
    not_found: "Move camera closer to the barcode",
  },
  ocr_mode: {
    initial: "Position the front of your license in the frame",
    searching: "Reading text...",
    poor_quality: "Improve lighting or hold camera steady",
  }
};
```

### Quality Assessment Integration

```typescript
// Real-time quality feedback
function generateGuidanceFromQuality(quality: QualityMetrics): Guidance {
  if (quality.blur > 0.7) {
    return { message: "Hold camera steady", action: 'hold_steady' };
  }
  if (quality.lighting < 0.3) {
    return { message: "Move to better lighting", action: 'improve_lighting' };
  }
  if (quality.positioning < 0.5) {
    return { message: "Center license in frame", action: 'move_closer' };
  }
  return { message: "Hold steady...", action: undefined };
}
```

## Performance Optimization

### Camera Performance
- **30 FPS Preview:** Smooth camera feed without frame drops
- **Processing Throttling:** Limit scanning to 5-10 FPS for processing
- **GPU Acceleration:** Use Core Image for real-time quality assessment
- **Memory Management:** Efficient buffer management to prevent leaks

### UI Responsiveness
- **Background Processing:** All scanning operations on background queues
- **UI Thread Protection:** Minimal work on main thread
- **Progressive Loading:** Show immediate feedback, refine over time
- **Smooth Animations:** 60fps animations for mode transitions

## Error Handling & Recovery

### Error Categories
- **Camera Errors:** Permission denied, hardware unavailable
- **Quality Errors:** Poor lighting, blur, positioning
- **Processing Errors:** Barcode not found, OCR failed, parsing errors
- **Timeout Errors:** Mode timeouts, processing delays

### Recovery Flows

```typescript
class ErrorRecoveryManager {
  handleError(error: ScanError): RecoveryAction {
    switch (error.code) {
      case 'CAMERA_PERMISSION_DENIED':
        return { type: 'show_settings', message: 'Enable camera access in Settings' };
      
      case 'BARCODE_NOT_FOUND':
        return { type: 'switch_mode', targetMode: 'ocr', message: 'Try front-side scanning' };
      
      case 'IMAGE_TOO_BLURRY':
        return { type: 'show_guidance', message: 'Hold camera steady' };
      
      case 'POOR_LIGHTING':
        return { type: 'show_guidance', message: 'Move to better lighting' };
        
      default:
        return { type: 'retry', message: 'Please try again' };
    }
  }
}
```

## Accessibility Features

### VoiceOver Support
- Descriptive labels for all UI elements
- Status announcements for scanning progress
- Audio feedback for successful scans
- Alternative text for visual indicators

### Visual Accessibility
- High contrast mode support
- Large text compatibility
- Color-blind friendly indicators
- Reduced motion options

```typescript
// Accessibility implementation
<TouchableOpacity 
  accessibilityRole="button"
  accessibilityLabel="Switch to barcode scanning mode"
  accessibilityHint="Scans the barcode on the back of your license"
  onPress={() => setMode('barcode')}
>
  <BarcodeIcon />
</TouchableOpacity>
```

## Testing Strategy

### UI Testing
- **Component Tests:** Individual component behavior and rendering
- **Integration Tests:** Full scanning flow with mocked camera
- **E2E Tests:** Complete user scenarios with Detox
- **Performance Tests:** Frame rate and memory usage validation

### User Testing Scenarios
1. **First-time User:** Complete scanning flow with guidance
2. **Mode Switching:** Manual and automatic mode transitions
3. **Error Recovery:** Various error conditions and recovery paths
4. **Accessibility:** VoiceOver navigation and usage
5. **Performance:** Scanning on older devices

## Integration Points

### Vision Camera Integration
```typescript
// Enhanced frame processor with UI feedback
const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  
  const quality = assessImageQuality(frame);
  const result = processFrame(frame, currentMode);
  
  runOnJS(updateQuality)(quality);
  
  if (result.success) {
    runOnJS(handleScanSuccess)(result.data);
  } else if (result.shouldSwitchMode) {
    runOnJS(switchToOCRMode)();
  }
}, [currentMode]);
```

### State Synchronization
- Bidirectional communication between UI and native processing
- Real-time quality updates from frame processor
- Smooth state transitions with animation coordination

## Success Metrics

- **Usability:** <30 seconds average time to successful scan
- **Performance:** 30fps camera preview, <100ms UI response time
- **Accessibility:** Full VoiceOver navigation support
- **Error Recovery:** Clear recovery path for all error scenarios
- **Mode Switching:** Smooth transitions with appropriate user guidance

## Dependencies

### Prerequisites
- **M01 completion:** Core PDF417 scanning infrastructure
- **M02 completion:** Front-side OCR fallback capability
- React Native Vision Camera integration
- Platform-specific UI framework setup

### External Dependencies
- Vision Camera frame processor performance
- iOS camera permission handling
- Device hardware capabilities (camera quality, processing power)

## Documentation Deliverables

- UI component documentation with examples
- Mode switching logic documentation
- Accessibility implementation guide
- Performance optimization guide
- User testing results and recommendations

## Next Milestone

This milestone prepares for **M04 - Testing, Optimization & Documentation** by providing:
- Complete user interface for all scanning modes
- Comprehensive error handling and recovery
- Performance-optimized scanning experience
- Accessibility-compliant implementation
- Production-ready UI components