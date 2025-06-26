# Animation Components

This directory contains comprehensive animation components for the React Native DL Scan library, built with React Native Reanimated v3.

## Overview

The animation system follows Material Design principles and provides:

- **Accessibility Support**: Respects system-wide reduced motion preferences
- **Performance Optimized**: Uses native-driven animations via Reanimated v3
- **Consistent Timing**: Shared configuration ensures consistent animation feel
- **Gesture Support**: Smooth gesture-based interactions
- **Type Safety**: Full TypeScript support with proper ref forwarding

## Components

### 1. ModeTransitionAnimation
Smooth transitions between scanning modes with slide/fade/scale effects.

```tsx
import { ModeTransitionAnimation } from './animations';

const ref = useRef<ModeTransitionAnimationRef>(null);

<ModeTransitionAnimation 
  ref={ref}
  onTransitionComplete={(mode) => console.log('New mode:', mode)}
>
  {/* Your content */}
</ModeTransitionAnimation>

// Trigger transition
ref.current?.transitionToMode('manual');
```

### 2. FeedbackAnimations
Success and error feedback animations with bounce/shake effects.

```tsx
import { FeedbackAnimation, SuccessAnimation, ErrorAnimation } from './animations';

const ref = useRef<FeedbackAnimationRef>(null);

// Combined component
<FeedbackAnimation ref={ref}>
  {/* Your content */}
</FeedbackAnimation>

// Individual components
<SuccessAnimation ref={successRef}>
  {/* Success-only content */}
</SuccessAnimation>

<ErrorAnimation ref={errorRef}>
  {/* Error-only content */}
</ErrorAnimation>

// Trigger animations
ref.current?.playSuccess();
ref.current?.playError();
ref.current?.reset();
```

### 3. ScanningOverlayAnimations
Comprehensive scanning overlay with:
- Animated scan line
- Corner brackets
- Quality indicators
- Document detection feedback

```tsx
import { ScanningOverlayAnimations } from './animations';

const ref = useRef<ScanningOverlayAnimationsRef>(null);

<ScanningOverlayAnimations
  ref={ref}
  isScanning={isScanning}
  onDocumentDetected={() => console.log('Document found!')}
  cornerBracketColor="#00FF00"
  scanLineColor="#FF4444"
/>

// Control animations
ref.current?.startScanning();
ref.current?.showDocumentDetected();
ref.current?.updateQualityIndicator('excellent');
```

### 4. GestureAnimations
Gesture-based interactions with pinch-to-zoom and pan support.

```tsx
import { GestureAnimations } from './animations';

const ref = useRef<GestureAnimationsRef>(null);

<GestureAnimations
  ref={ref}
  onZoomChange={(scale) => setZoom(scale)}
  onPanChange={(x, y) => setPan({ x, y })}
  onDoubleTap={() => console.log('Double tap!')}
  minZoom={0.5}
  maxZoom={3}
>
  {/* Your zoomable/pannable content */}
</GestureAnimations>

// Programmatic control
ref.current?.zoomTo(2, 100, 100);
ref.current?.resetTransform();
```

### 5. AnimationShowcase
Development component showcasing all animations.

```tsx
import { AnimationShowcase } from './animations';

// Use for testing and demonstration
<AnimationShowcase />
```

## Animation Utilities

### Configuration
```tsx
import { AnimationConfig, useAnimationConfig } from './animations';

// Static configuration
const duration = AnimationConfig.duration.normal; // 300ms
const easing = AnimationConfig.easing.standard;   // Material Design bezier

// Accessibility-aware configuration
const config = useAnimationConfig(); // Returns duration: 0 if reduced motion enabled
```

### Timing Presets
```tsx
import { AnimationTimings } from './animations';

const feedbackTiming = AnimationTimings.feedback;   // Fast feedback (200ms)
const transitionTiming = AnimationTimings.transition; // Mode changes (300ms)
const successTiming = AnimationTimings.success;     // Success feedback (500ms)
```

### Common Values
```tsx
import { AnimationValues } from './animations';

const slideDistance = AnimationValues.slideDistance.medium; // 20px
const scaleValue = AnimationValues.scale.medium;           // 1.1x
const opacity = AnimationValues.opacity.semi;             // 0.5
```

### Sequence Helpers
```tsx
import { createSequence } from './animations';

const bounceSequence = createSequence.bounce(1.2);
const shakeSequence = createSequence.shake(10);
const fadeSequence = createSequence.fade(0, 1);
```

## Dependencies

### Required
- `react-native-reanimated` ^3.18.0 (included in package dependencies)
- `react-native-gesture-handler` >=2.0.0 (peer dependency for GestureAnimations)

### Installation
The library includes Reanimated v3. For gesture support, install:

```bash
npm install react-native-gesture-handler
# or
yarn add react-native-gesture-handler
```

### Babel Configuration
Ensure your `babel.config.js` includes the Reanimated plugin:

```javascript
module.exports = {
  plugins: ['react-native-reanimated/plugin'], // Must be last
};
```

## Accessibility

All animations automatically respect the system's reduced motion preference via `AccessibilityInfo.isReduceMotionEnabled()`. When reduced motion is enabled:

- Animation durations become 0 (instant)
- Complex sequences are simplified
- Essential feedback is preserved without motion

## Performance

- Uses native-driven animations via Reanimated v3
- Minimal JavaScript bridge communication
- Optimized for 60fps performance
- Includes performance monitoring utilities in `AnimationPerformance`

## Examples

See `AnimationShowcase.tsx` for comprehensive examples of all animation components in action.

## TypeScript Support

All components include proper TypeScript definitions with:
- Ref interfaces for imperative control
- Props interfaces with optional callbacks
- Proper generic typing for animation values
- Exported types for custom implementations