// Mock for src/utils/ScanTimeoutManager.ts
class MockScanTimeoutManager {
  constructor(config, events) {
    this.config = config;
    this.events = events;
    this.activeTimers = new Set();
    this.startTime = 0;
    this.retryCount = 0;
  }

  startTimeout(type, onTimeout) {
    const timer = setTimeout(() => {
      this.events?.onTimeout(type, Date.now() - this.startTime);
      onTimeout();
    }, this.config.barcodeTimeout || this.config.ocrTimeout);

    this.activeTimers.add(timer);
    return timer;
  }

  async optimizedRetry(operation, maxAttempts = 3) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        if (attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  shouldTriggerFallback(error, timeElapsed) {
    return timeElapsed >= this.config.barcodeTimeout;
  }

  getElapsedTime() {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }

  clearTimer(timer) {
    if (this.activeTimers.has(timer)) {
      clearTimeout(timer);
      this.activeTimers.delete(timer);
    }
  }

  clearAllTimers() {
    this.activeTimers.forEach((timer) => clearTimeout(timer));
    this.activeTimers.clear();
  }

  reset() {
    this.clearAllTimers();
    this.startTime = 0;
    this.retryCount = 0;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  destroy() {
    this.clearAllTimers();
  }

  getRetryCount() {
    return this.retryCount;
  }
}

module.exports = {
  ScanTimeoutManager: MockScanTimeoutManager,
};
