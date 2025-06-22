# T03_S07: Animations and Smooth Transitions

## Context
**Sprint**: S07 - M04 Advanced Features  
**Module**: M04 - Dual-Mode UI Integration  
**Previous Sprint**: S06 - Core UI Components  

## Dependencies
- S06.T03: Scanning Overlay Components (base UI)
- S06.T04: Result Screen Foundation (success animations)
- React Native Reanimated (animation library)

## Description
Implement smooth animations and transitions throughout the scanning experience using react-native-reanimated. Focus on creating fluid, performant animations that enhance usability while respecting user preferences for reduced motion. Include success/error animations and mode transition effects.

## Technical Specifications

### 1. Animation Library Setup
```typescript
// Shared animation configuration
export const AnimationConfig = {
  duration: {
    fast: 200,
    normal: 300,
    slow: 500
  },
  easing: {
    standard: Easing.bezier(0.4, 0.0, 0.2, 1), // Material Design
    decelerate: Easing.bezier(0.0, 0.0, 0.2, 1),
    accelerate: Easing.bezier(0.4, 0.0, 1, 1)
  }
};

// Respect reduced motion preference
const useAnimationConfig = () => {
  const reducedMotion = useReducedMotion();
  return reducedMotion ? 
    { duration: 0, easing: Easing.linear } : 
    AnimationConfig;
};
```

### 2. Core Animation Components

#### Mode Transition Animation
```typescript
const ModeTransitionAnimation = () => {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value
  }));
  
  // Smooth slide and fade between PDF417 and OCR modes
  const transitionToMode = (mode: ScanMode) => {
    translateY.value = withSequence(
      withTiming(-20, { duration: 150 }),
      withTiming(0, { duration: 150 })
    );
    opacity.value = withSequence(
      withTiming(0.5, { duration: 150 }),
      withTiming(1, { duration: 150 })
    );
  };
};
```

#### Success Animation
```typescript
const SuccessAnimation = () => {
  const scale = useSharedValue(0);
  const rotation = useSharedValue(0);
  
  const playSuccess = () => {
    scale.value = withSpring(1, {
      damping: 15,
      stiffness: 150
    });
    rotation.value = withTiming(360, {
      duration: 600,
      easing: Easing.ease
    });
  };
};
```

#### Error Animation
```typescript
const ErrorAnimation = () => {
  const translateX = useSharedValue(0);
  
  const shake = () => {
    translateX.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(0, { duration: 50 })
    );
  };
};
```

### 3. Scanning Overlay Animations
- Pulsing scan line for active scanning
- Smooth corner bracket animations
- Quality indicator transitions
- Document detection feedback

### 4. Gesture-based Animations
```typescript
// Swipe to dismiss result screen
const ResultScreenGestures = () => {
  const translateY = useSharedValue(0);
  
  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 100) {
        translateY.value = withSpring(height);
        runOnJS(onDismiss)();
      } else {
        translateY.value = withSpring(0);
      }
    });
};
```

### 5. Performance Considerations
- Use `react-native-reanimated` v3 for optimal performance
- Run animations on UI thread when possible
- Implement frame budget monitoring
- Preload animation assets

### 6. Accessibility Integration
```typescript
const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);
  
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion);
      
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion
    );
    
    return () => subscription.remove();
  }, []);
  
  return reducedMotion;
};
```

## Implementation Tasks
1. [ ] Install and configure react-native-reanimated v3
2. [ ] Create shared animation configuration and utilities
3. [ ] Implement mode transition animations
4. [ ] Build success/error animation components
5. [ ] Add scanning overlay animations
6. [ ] Implement gesture-based interactions
7. [ ] Add reduced motion support
8. [ ] Create animation showcase/demo screen

## Acceptance Criteria
- [ ] All animations run at 60fps consistently
- [ ] Reduced motion preference disables animations
- [ ] Mode transitions feel smooth and natural
- [ ] Success/error animations provide clear feedback
- [ ] Gesture interactions feel responsive
- [ ] No animation jank or frame drops
- [ ] Animations enhance rather than distract

## Technical Notes
- Use `useSharedValue` for all animated values
- Prefer `withSpring` for natural motion
- Implement `cancelAnimation` for interrupted states
- Test on lower-end devices for performance
- Consider using `react-native-lottie` for complex animations

## Complexity Assessment
**Estimated Complexity**: Low
- Well-established patterns with reanimated
- Clear animation requirements
- Minimal integration complexity
- Good library documentation available