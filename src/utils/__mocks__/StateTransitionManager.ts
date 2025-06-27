/**
 * Mock for StateTransitionManager
 * Provides a test-friendly implementation with spy capabilities
 */

import type { ScanMode, ScanningState } from '../../types/license';

export const mockStateTransitionManager = {
  startScanSession: jest.fn(),
  transitionToState: jest.fn(),
  transitionToMode: jest.fn(),
  evaluateFallbackDecision: jest.fn().mockReturnValue({
    shouldFallback: false,
    reason: 'mode_restriction',
    remainingTime: 5000,
  }),
  handleBarcodeAttempt: jest.fn(),
  canTransitionTo: jest.fn().mockReturnValue(true),
  getCurrentState: jest.fn().mockReturnValue('idle'),
  getCurrentMode: jest.fn().mockReturnValue('auto'),
  getProgress: jest.fn().mockReturnValue({
    mode: 'auto',
    state: 'idle',
    elapsed: 0,
    attempts: 0,
  }),
  reset: jest.fn(),
  destroy: jest.fn(),
};

export class StateTransitionManager {
  private currentState: ScanningState = 'idle';
  private currentMode: ScanMode = 'auto';

  constructor(
    private config: any,
    private events?: any
  ) {
    Object.assign(this, mockStateTransitionManager);
  }

  // Ensure all methods are available
  startScanSession = mockStateTransitionManager.startScanSession;
  transitionToState = mockStateTransitionManager.transitionToState;
  transitionToMode = mockStateTransitionManager.transitionToMode;
  evaluateFallbackDecision =
    mockStateTransitionManager.evaluateFallbackDecision;
  handleBarcodeAttempt = mockStateTransitionManager.handleBarcodeAttempt;
  canTransitionTo = mockStateTransitionManager.canTransitionTo;
  getCurrentState = mockStateTransitionManager.getCurrentState;
  getCurrentMode = mockStateTransitionManager.getCurrentMode;
  getProgress = mockStateTransitionManager.getProgress;
  reset = mockStateTransitionManager.reset;
  destroy = mockStateTransitionManager.destroy;
}
