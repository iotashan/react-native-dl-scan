// Mock for src/utils/StateTransitionManager.ts
class MockStateTransitionManager {
  constructor(config, events) {
    this.config = config;
    this.events = events;
    this.currentState = 'idle';
    this.currentMode = 'auto';
    this.scanStartTime = 0;
    this.barcodeAttempts = 0;
  }

  startScanSession(mode) {
    this.currentMode = mode;
    this.scanStartTime = Date.now();
    this.barcodeAttempts = 0;
    this.updateState('barcode');
  }

  updateState(newState) {
    const oldState = this.currentState;
    this.currentState = newState;
    this.events?.onStateChange(oldState, newState);
    this.notifyProgress();
  }

  switchMode(toMode, reason) {
    const fromMode = this.currentMode;
    this.currentMode = toMode;

    if (toMode === 'ocr') {
      this.updateState('fallback_transition');
      setTimeout(() => this.updateState('ocr'), 100);
    } else if (toMode === 'barcode') {
      this.updateState('barcode');
    }

    this.events?.onModeSwitch(fromMode, toMode, reason);
  }

  shouldTriggerFallback(error, timeElapsed) {
    if (this.currentMode !== 'auto') {
      return {
        shouldFallback: false,
        reason: 'mode_restriction',
        remainingTime: this.config.maxFallbackProcessingTimeMs - timeElapsed,
      };
    }

    const remainingTime = this.config.maxFallbackProcessingTimeMs - timeElapsed;
    if (remainingTime < 1000) {
      return {
        shouldFallback: false,
        reason: 'insufficient_time',
        remainingTime,
      };
    }

    if (timeElapsed >= this.config.barcodeTimeoutMs) {
      return {
        shouldFallback: true,
        reason: 'timeout',
        remainingTime,
      };
    }

    if (this.barcodeAttempts >= this.config.maxBarcodeAttempts) {
      return {
        shouldFallback: true,
        reason: 'max_attempts',
        remainingTime,
      };
    }

    return {
      shouldFallback: false,
      reason: 'error_type',
      remainingTime,
    };
  }

  incrementBarcodeAttempts() {
    this.barcodeAttempts++;
    return this.barcodeAttempts;
  }

  getProgress() {
    return {
      state: this.currentState,
      mode: this.currentMode,
      startTime: this.scanStartTime,
      barcodeAttempts: this.barcodeAttempts,
      timeElapsed: Date.now() - this.scanStartTime,
      message: this.getProgressMessage(),
    };
  }

  getProgressMessage() {
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

  notifyProgress() {
    if (this.events?.onProgressUpdate) {
      const progress = this.getProgress();
      this.events.onProgressUpdate(progress);
    }
  }

  getCurrentState() {
    return this.currentState;
  }

  getCurrentMode() {
    return this.currentMode;
  }

  getElapsedTime() {
    return this.scanStartTime > 0 ? Date.now() - this.scanStartTime : 0;
  }

  getBarcodeAttempts() {
    return this.barcodeAttempts;
  }

  shouldContinueScanning() {
    if (this.currentState === 'completed' || this.currentState === 'failed') {
      return false;
    }
    const timeElapsed = Date.now() - this.scanStartTime;
    return timeElapsed < this.config.maxFallbackProcessingTimeMs;
  }

  forceComplete() {
    this.updateState('completed');
  }

  forceFail() {
    this.updateState('failed');
  }

  reset() {
    this.currentState = 'idle';
    this.currentMode = 'auto';
    this.scanStartTime = 0;
    this.barcodeAttempts = 0;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  isAutoMode() {
    return this.currentMode === 'auto';
  }

  isFallbackAvailable() {
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

  getRemainingTime() {
    const timeElapsed = this.getElapsedTime();
    return Math.max(0, this.config.maxFallbackProcessingTimeMs - timeElapsed);
  }
}

module.exports = {
  StateTransitionManager: MockStateTransitionManager,
};
