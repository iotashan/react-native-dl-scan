# Accessibility Implementation

Comprehensive accessibility support for the React Native DL Scan library, ensuring full usability with VoiceOver and other assistive technologies.

## Overview

This accessibility system provides:

- **VoiceOver Support**: Complete screen reader integration with semantic labels and announcements
- **Focus Management**: Logical focus order and focus trapping for modals
- **Voice Guidance**: Real-time audio feedback for scanning process
- **High Contrast**: Support for high contrast mode with appropriate color schemes
- **Dynamic Type**: Text scaling support for users with vision impairments
- **Custom Gestures**: VoiceOver-compatible gesture shortcuts
- **Testing Utilities**: Comprehensive accessibility testing and validation tools

## Core Components

### 1. VoiceGuidanceSystem

Provides real-time audio feedback during the scanning process.

```tsx
import { VoiceGuidanceSystem } from './accessibility';

<VoiceGuidanceSystem
  isScanning={isScanning}
  currentMode={scanMode}
  qualityMetrics={qualityMetrics}
  documentDetected={documentDetected}
  scanResult={scanResult}
  errorMessage={errorMessage}
  onGuidanceComplete={() => console.log('Guidance complete')}
/>
```

**Features:**
- Real-time positioning guidance ("Move closer", "Hold steady")
- Quality feedback announcements
- Document detection notifications
- Scan result announcements
- Throttled announcements to prevent spam

### 2. AccessibilityGestures

Custom gestures that work alongside VoiceOver.

```tsx
import { AccessibilityGestures } from './accessibility';

<AccessibilityGestures
  onModeToggle={() => toggleScanMode()}
  onHelp={() => showHelp()}
  onScanTrigger={() => startScanning()}
  onReset={() => resetScanner()}
  currentMode={scanMode}
  isVoiceOverEnabled={isVoiceOverEnabled}
>
  {/* Your content */}
</AccessibilityGestures>
```

**Available Gestures:**
- **Two-finger double tap**: Toggle scanning modes
- **Three-finger swipe up**: Show help
- **Three-finger swipe down**: Trigger scan
- **Four-finger tap**: Reset

### 3. Accessible Components

Pre-built components with accessibility features built-in.

#### AccessibleButton
```tsx
import { AccessibleButton } from './accessibility';

<AccessibleButton
  label="Start Scanning"
  hint="Double tap to begin scanning process"
  variant="primary"
  size="large"
  onPress={startScanning}
/>
```

#### AccessibleCameraView
```tsx
import { AccessibleCameraView } from './accessibility';

<AccessibleCameraView
  isScanning={isScanning}
  qualityDescription="Good image quality"
  documentDetected={documentDetected}
  currentMode={scanMode}
>
  {/* Camera content */}
</AccessibleCameraView>
```

#### AccessibleModeSelector
```tsx
import { AccessibleModeSelector } from './accessibility';

<AccessibleModeSelector
  currentMode={scanMode}
  availableModes={['auto', 'manual', 'batch']}
  onModeChange={setScanMode}
/>
```

## Accessibility Utilities

### Voice Over Support

```tsx
import { useVoiceOver, AccessibilityConfig } from './accessibility';

const { isVoiceOverEnabled, announce } = useVoiceOver();

// Announce important events
announce(AccessibilityConfig.announcements.scanSuccess);
```

### High Contrast Support

```tsx
import { useHighContrast, getHighContrastColors } from './accessibility';

const isHighContrast = useHighContrast();
const highContrastColors = getHighContrastColors(isHighContrast);

// Apply high contrast colors
const styles = {
  backgroundColor: highContrastColors?.background || defaultBackground,
  color: highContrastColors?.text || defaultText,
};
```

### Dynamic Type Support

```tsx
import { useDynamicType } from './accessibility';

const { fontSize, lineHeight } = useDynamicType();

const styles = {
  fontSize: fontSize(16), // Scales with user's text size preference
  lineHeight: lineHeight(16),
};
```

### Focus Management

```tsx
import { useFocusManagement, useFocusTrap } from './accessibility';

const { focusElement } = useFocusManagement();
const { firstElementRef, lastElementRef } = useFocusTrap(isModalVisible);

// Focus specific element
useEffect(() => {
  if (shouldFocus) {
    focusElement(buttonRef);
  }
}, [shouldFocus]);
```

## Voice Guidance Integration

### Basic Integration

```tsx
import { useVoiceGuidance } from './accessibility';

const {
  isVoiceOverEnabled,
  announceInstructions,
  announceError,
  announceSuccess,
} = useVoiceGuidance();

// Announce scanning instructions
useEffect(() => {
  if (isScanning) {
    announceInstructions();
  }
}, [isScanning]);

// Handle scan results
useEffect(() => {
  if (scanResult === 'success') {
    announceSuccess();
  } else if (scanResult === 'error') {
    announceError(errorMessage);
  }
}, [scanResult]);
```

### Advanced Voice Guidance

```tsx
import { VoiceGuidanceScenarios } from './accessibility';

// Mode-specific guidance
if (scanMode === 'auto') {
  VoiceGuidanceScenarios.autoMode(announce);
} else if (scanMode === 'manual') {
  VoiceGuidanceScenarios.manualMode(announce);
}

// Error recovery guidance
if (scanError) {
  VoiceGuidanceScenarios.errorRecovery(announce, scanError);
}
```

## Accessibility Configuration

### Labels and Announcements

```tsx
import { AccessibilityConfig } from './accessibility';

// Use predefined labels
const cameraLabel = AccessibilityConfig.labels.cameraView;
const scanButtonLabel = AccessibilityConfig.labels.scanButton;

// Use announcement helpers
const modeChangedMessage = AccessibilityConfig.announcements.modeChanged('auto');
const progressMessage = AccessibilityConfig.announcements.scanningProgress(0.8);
```

### Custom Accessibility Props

```tsx
import { getAccessibilityProps } from './accessibility';

const accessibilityProps = getAccessibilityProps({
  label: 'Scan Quality Indicator',
  hint: 'Shows current image quality level',
  role: 'progressbar',
  value: {
    min: 0,
    max: 100,
    now: Math.round(quality * 100),
    text: `${Math.round(quality * 100)}% quality`,
  },
  liveRegion: 'polite',
});

<View {...accessibilityProps}>
  {/* Quality indicator content */}
</View>
```

## Testing and Validation

### Automated Accessibility Testing

```tsx
import { AccessibilityTestSuite, AccessibilityTestHelpers } from './accessibility';

// Test component accessibility
const testSuite = new AccessibilityTestSuite();
const report = testSuite.audit(componentTree, 'ScanningScreen');

console.log(`Accessibility Score: ${report.score}/100`);
console.log(`Issues found: ${report.summary.errors} errors, ${report.summary.warnings} warnings`);

// Assert accessibility compliance in tests
AccessibilityTestHelpers.assertAccessible(component, 'ScanningScreen');
```

### Manual Testing with Mocks

```tsx
import { AccessibilityTestHelpers } from './accessibility';

// Mock VoiceOver for testing
AccessibilityTestHelpers.mockVoiceOverEnabled(true);

// Mock high contrast mode
AccessibilityTestHelpers.mockHighContrastEnabled(true);

// Mock announcements
const mockAnnounce = AccessibilityTestHelpers.mockAccessibilityAnnouncement();

// Test announcement behavior
expect(mockAnnounce).toHaveBeenCalledWith('Scanning started');
```

### Debug Utilities

```tsx
import { AccessibilityDebugUtils } from './accessibility';

// Log accessibility tree
AccessibilityDebugUtils.logAccessibilityTree(componentTree);

// Simulate screen reader navigation
const announcements = AccessibilityDebugUtils.simulateScreenReaderNavigation(componentTree);
console.log('Screen reader would announce:', announcements);
```

## Best Practices

### 1. Semantic Labels
- Use descriptive accessibility labels that explain the element's purpose
- Avoid redundant words like "button" (included in accessibilityRole)
- Update labels dynamically to reflect current state

```tsx
// Good
<TouchableOpacity
  accessibilityLabel={`Start ${scanMode} scanning`}
  accessibilityRole="button"
  accessibilityState={{ disabled: isScanning }}
/>

// Bad
<TouchableOpacity
  accessibilityLabel="Button to start scanning button"
/>
```

### 2. Focus Management
- Ensure logical focus order
- Use focus traps for modals
- Move focus to relevant content after navigation

```tsx
// Focus new content after navigation
useEffect(() => {
  if (showResults) {
    setTimeout(() => {
      focusElement(resultsHeaderRef);
    }, 100);
  }
}, [showResults]);
```

### 3. Live Regions
- Use live regions for dynamic content updates
- Choose appropriate politeness level (polite/assertive)
- Avoid excessive announcements

```tsx
<View
  accessibilityLiveRegion="polite"
  accessibilityLabel="Scan progress"
>
  <Text>Scanning: {Math.round(progress * 100)}%</Text>
</View>
```

### 4. High Contrast Support
- Test with high contrast mode enabled
- Ensure sufficient color contrast ratios
- Use border/outline for visual separation

```tsx
const styles = StyleSheet.create({
  button: {
    backgroundColor: '#007AFF',
    borderWidth: isHighContrast ? 2 : 0,
    borderColor: isHighContrast ? '#000000' : 'transparent',
  },
});
```

### 5. Touch Targets
- Ensure minimum 44×44pt touch targets
- Add padding around small interactive elements
- Use hitSlop for small buttons

```tsx
<TouchableOpacity
  style={styles.smallButton}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
/>
```

## iOS-Specific Considerations

### VoiceOver Gestures
- Single finger: Navigation and selection
- Two fingers: Reading and scrolling
- Three fingers: Navigation between sections
- Four fingers: App switching (avoid conflicts)

### Accessibility Traits
- Use appropriate `accessibilityRole` values
- Set `accessibilityState` for stateful elements
- Use `accessibilityValue` for progress/adjustable elements

### Custom Actions
```tsx
const accessibilityActions = [
  { name: 'toggle_mode', label: 'Toggle scanning mode' },
  { name: 'show_help', label: 'Show help' },
];

<View
  accessibilityActions={accessibilityActions}
  onAccessibilityAction={handleAccessibilityAction}
>
  {/* Content */}
</View>
```

## Common Issues and Solutions

### 1. Missing Labels
**Problem**: Interactive elements without accessibility labels
**Solution**: Add `accessibilityLabel` to all interactive elements

### 2. Poor Focus Order
**Problem**: VoiceOver navigation jumps around unexpectedly
**Solution**: Structure components logically, use `accessibilityElementsHidden` sparingly

### 3. Excessive Announcements
**Problem**: Too many announcements overwhelming users
**Solution**: Throttle announcements, use appropriate live region politeness

### 4. Inaccessible Custom Components
**Problem**: Custom components not working with VoiceOver
**Solution**: Add proper accessibility props, test with VoiceOver enabled

### 5. Modal Focus Issues
**Problem**: Focus escaping from modal content
**Solution**: Use `accessibilityViewIsModal={true}` and focus traps

## Performance Considerations

- Use `useCallback` for announcement functions to prevent re-renders
- Throttle frequent accessibility updates (quality metrics, progress)
- Cache accessibility strings to avoid repeated calculations
- Test performance with VoiceOver enabled

## Compliance

This implementation targets:
- **WCAG 2.1 Level AA** compliance
- **iOS Accessibility Guidelines**
- **React Native Accessibility Best Practices**

Key compliance areas:
- Perceivable: Alternative text, contrast, text scaling
- Operable: Keyboard navigation, gesture alternatives
- Understandable: Clear labels, error messages
- Robust: Assistive technology compatibility