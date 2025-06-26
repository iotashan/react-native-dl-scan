// Animation Components
export { default as ModeTransitionAnimation } from './ModeTransitionAnimation';
export type { ModeTransitionAnimationRef } from './ModeTransitionAnimation';

export {
  FeedbackAnimation,
  SuccessAnimation,
  ErrorAnimation,
} from './FeedbackAnimations';
export type { FeedbackAnimationRef } from './FeedbackAnimations';

export { default as ScanningOverlayAnimations } from './ScanningOverlayAnimations';
export type { ScanningOverlayAnimationsRef } from './ScanningOverlayAnimations';

export { default as GestureAnimations } from './GestureAnimations';
export type { GestureAnimationsRef } from './GestureAnimations';

export { default as AnimationShowcase } from './AnimationShowcase';

// Animation Utilities
export {
  AnimationConfig,
  AnimationTimings,
  AnimationValues,
  createSequence,
  AnimationPerformance,
  useReducedMotion,
  useAnimationConfig,
} from '../../utils/animations';

export type {
  AnimationDuration,
  AnimationEasing,
  SpringConfig,
  AnimationTiming,
} from '../../utils/animations';
