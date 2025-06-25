/**
 * StateTransitionManager
 *
 * Extracted from FallbackController to handle mode switching and state logic.
 * Responsible for managing scanning states, mode transitions, and fallback decisions.
 */

import type { ScanMode, ScanningState, ScanProgress } from '../types/license';
import { ScanError } from '../index.js';

export interface StateConfig {
  maxBarcodeAttempts: number;
  barcodeTimeoutMs: number;
  maxFallbackProcessingTimeMs: number;
  enableAutoFallback: boolean;
}

export interface StateEvents {
  onStateChange: (oldState: ScanningState, newState: ScanningState) => void;
  onModeSwitch: (fromMode: ScanMode, toMode: ScanMode, reason: string) => void;
  onProgressUpdate: (progress: ScanProgress) => void;
}

export interface FallbackDecision {
  shouldFallback: boolean;
  reason:
    | 'timeout'
    | 'max_attempts'
    | 'error_type'
    | 'insufficient_time'
    | 'mode_restriction';
  remainingTime: number;
}

export class StateTransitionManager {
  private currentState: ScanningState = 'idle';
  private currentMode: ScanMode = 'auto';
  private scanStartTime: number = 0;
  private barcodeAttempts: number = 0;

  constructor(
    private config: StateConfig,
    private events?: StateEvents
  ) {}

  /**
   * Initialize a new scan session
   */
  startScanSession(mode: ScanMode): void {
    this.currentMode = mode;
    this.scanStartTime = Date.now();
    this.barcodeAttempts = 0;
    this.updateState('barcode');
  }

  /**
   * Update current scanning state with event notification
   */
  updateState(newState: ScanningState): void {
    const oldState = this.currentState;
    this.currentState = newState;

    this.events?.onStateChange(oldState, newState);
    this.notifyProgress();
  }

  /**
   * Switch to a different scanning mode
   */
  switchMode(toMode: ScanMode, reason: string): void {
    const fromMode = this.currentMode;
    this.currentMode = toMode;

    // Update state based on new mode
    if (toMode === 'ocr') {
      this.updateState('fallback_transition');
      // Transition to OCR state after a brief delay for UI feedback
      setTimeout(() => this.updateState('ocr'), 100);
    } else if (toMode === 'barcode') {
      this.updateState('barcode');
    }

    this.events?.onModeSwitch(fromMode, toMode, reason);
  }

  /**
   * Determine if fallback should be triggered based on error and timing
   */
  shouldTriggerFallback(error: unknown, timeElapsed: number): FallbackDecision {
    // Don't fallback if we're not in auto mode
    if (this.currentMode !== 'auto') {
      return {
        shouldFallback: false,
        reason: 'mode_restriction',
        remainingTime: this.config.maxFallbackProcessingTimeMs - timeElapsed,
      };
    }

    // Don't fallback if total time would exceed limit
    const remainingTime = this.config.maxFallbackProcessingTimeMs - timeElapsed;
    if (remainingTime < 1000) {
      // Need at least 1 second for OCR
      return {
        shouldFallback: false,
        reason: 'insufficient_time',
        remainingTime,
      };
    }

    // Fallback on timeout
    if (timeElapsed >= this.config.barcodeTimeoutMs) {
      return {
        shouldFallback: true,
        reason: 'timeout',
        remainingTime,
      };
    }

    // Fallback on max attempts reached
    if (this.barcodeAttempts >= this.config.maxBarcodeAttempts) {
      return {
        shouldFallback: true,
        reason: 'max_attempts',
        remainingTime,
      };
    }

    // Fallback on specific error types
    if (error instanceof ScanError) {
      const fallbackCodes = [
        'INVALID_BARCODE_FORMAT',
        'BARCODE_NOT_FOUND',
        'POOR_IMAGE_QUALITY',
        'DECODING_ERROR',
      ];

      if (fallbackCodes.includes(error.code)) {
        return {
          shouldFallback: true,
          reason: 'error_type',
          remainingTime,
        };
      }
    } else if (error && typeof error === 'object' && 'code' in error) {
      // Handle errors that have a code property but aren't ScanError instances
      const errorCode = String((error as any).code);
      const fallbackCodes = [
        'INVALID_BARCODE_FORMAT',
        'BARCODE_NOT_FOUND',
        'POOR_IMAGE_QUALITY',
        'DECODING_ERROR',
      ];

      if (fallbackCodes.includes(errorCode)) {
        return {
          shouldFallback: true,
          reason: 'error_type',
          remainingTime,
        };
      }
    }

    return {
      shouldFallback: false,
      reason: 'error_type',
      remainingTime,
    };
  }

  /**
   * Increment barcode attempt counter
   */
  incrementBarcodeAttempts(): number {
    this.barcodeAttempts++;
    return this.barcodeAttempts;
  }

  /**
   * Get progress message for current state
   */
  getProgressMessage(): string {
    switch (this.currentState) {
      case 'idle':
        return 'Ready to scan';
      case 'barcode':
        return 'Scanning barcode...';
      case 'ocr':
        return 'Reading license text...';
      case 'fallback_transition':
        return 'Switching to text recognition...';
      case 'completed':
        return 'Scan completed successfully';
      case 'failed':
        return 'Scan failed';
      default:
        return 'Processing...';
    }
  }

  /**
   * Get current progress information
   */
  getProgress(): ScanProgress {
    return {
      state: this.currentState,
      mode: this.currentMode,
      startTime: this.scanStartTime,
      barcodeAttempts: this.barcodeAttempts,
      timeElapsed: Date.now() - this.scanStartTime,
      message: this.getProgressMessage(),
    };
  }

  /**
   * Check if scan should continue based on current state and timing
   */
  shouldContinueScanning(): boolean {
    if (this.currentState === 'completed' || this.currentState === 'failed') {
      return false;
    }

    const timeElapsed = Date.now() - this.scanStartTime;
    if (timeElapsed >= this.config.maxFallbackProcessingTimeMs) {
      return false;
    }

    return true;
  }

  /**
   * Determine next recommended mode based on current state and performance
   */
  getRecommendedMode(currentPerformance?: {
    barcodeSuccessRate: number;
    ocrSuccessRate: number;
    averageBarcodeTime: number;
    averageOcrTime: number;
  }): ScanMode {
    // If no performance data, stick with auto mode
    if (!currentPerformance) {
      return 'auto';
    }

    // If barcode is consistently faster and reliable, prefer barcode
    if (
      currentPerformance.barcodeSuccessRate > 0.8 &&
      currentPerformance.averageBarcodeTime < 1000
    ) {
      return 'barcode';
    }

    // If OCR is more reliable than barcode, prefer OCR
    if (
      currentPerformance.ocrSuccessRate >
        currentPerformance.barcodeSuccessRate &&
      currentPerformance.ocrSuccessRate > 0.7
    ) {
      return 'ocr';
    }

    // Default to auto mode for best of both worlds
    return 'auto';
  }

  /**
   * Reset state for new scan session
   */
  reset(): void {
    this.currentState = 'idle';
    this.currentMode = 'auto';
    this.scanStartTime = 0;
    this.barcodeAttempts = 0;
  }

  /**
   * Notify progress update to listeners
   */
  private notifyProgress(): void {
    if (!this.events?.onProgressUpdate) return;

    const progress = this.getProgress();
    this.events.onProgressUpdate(progress);
  }

  /**
   * Get current state
   */
  getCurrentState(): ScanningState {
    return this.currentState;
  }

  /**
   * Get current mode
   */
  getCurrentMode(): ScanMode {
    return this.currentMode;
  }

  /**
   * Get elapsed time since scan start
   */
  getElapsedTime(): number {
    return this.scanStartTime > 0 ? Date.now() - this.scanStartTime : 0;
  }

  /**
   * Get current barcode attempts
   */
  getBarcodeAttempts(): number {
    return this.barcodeAttempts;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<StateConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): StateConfig {
    return { ...this.config };
  }

  /**
   * Check if currently in auto mode
   */
  isAutoMode(): boolean {
    return this.currentMode === 'auto';
  }

  /**
   * Check if fallback is available based on current state
   */
  isFallbackAvailable(): boolean {
    const timeElapsed = this.getElapsedTime();
    const remainingTime = this.config.maxFallbackProcessingTimeMs - timeElapsed;

    return (
      this.config.enableAutoFallback &&
      this.currentMode === 'auto' &&
      remainingTime >= 1000 &&
      this.currentState !== 'completed' &&
      this.currentState !== 'failed'
    );
  }

  /**
   * Get time remaining for current scan session
   */
  getRemainingTime(): number {
    const timeElapsed = this.getElapsedTime();
    return Math.max(0, this.config.maxFallbackProcessingTimeMs - timeElapsed);
  }

  /**
   * Force complete current scan session
   */
  forceComplete(): void {
    this.updateState('completed');
  }

  /**
   * Force fail current scan session
   */
  forceFail(): void {
    this.updateState('failed');
  }
}
