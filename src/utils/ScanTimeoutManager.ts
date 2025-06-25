/**
 * ScanTimeoutManager
 *
 * Extracted from FallbackController to handle timeout logic and retry mechanisms.
 * Responsible for managing scan timeouts, retries, and timer cleanup.
 */

export interface TimeoutConfig {
  barcodeTimeout: number;
  ocrTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

export interface TimeoutEvents {
  onTimeout: (type: 'barcode' | 'ocr', elapsed: number) => void;
  onRetryAttempt: (attempt: number, maxAttempts: number) => void;
}

export class ScanTimeoutManager {
  private activeTimers: Set<NodeJS.Timeout> = new Set();
  private startTime: number = 0;
  private retryCount: number = 0;

  constructor(
    private config: TimeoutConfig,
    private events?: TimeoutEvents
  ) {}

  /**
   * Start a timeout timer for the given scan type
   */
  startTimeout(type: 'barcode' | 'ocr', onTimeout: () => void): NodeJS.Timeout {
    this.startTime = Date.now();
    const timeoutMs =
      type === 'barcode' ? this.config.barcodeTimeout : this.config.ocrTimeout;

    const timer = this.createTimer(() => {
      const elapsed = Date.now() - this.startTime;
      this.events?.onTimeout(type, elapsed);
      onTimeout();
    }, timeoutMs);

    return timer;
  }

  /**
   * Check if we should trigger fallback based on error and elapsed time
   */
  shouldTriggerFallback(error: unknown, timeElapsed: number): boolean {
    const isTimeoutError =
      error instanceof Error &&
      (error.message.includes('timeout') || error.message.includes('Timeout'));

    const hasExceededTimeout = timeElapsed >= this.config.barcodeTimeout;

    return isTimeoutError || hasExceededTimeout;
  }

  /**
   * Execute operation with retry logic
   */
  async optimizedRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = this.config.maxRetries
  ): Promise<T> {
    this.retryCount = 0;

    while (this.retryCount < maxAttempts) {
      try {
        const result = await operation();
        this.retryCount = 0; // Reset on success
        return result;
      } catch (error) {
        this.retryCount++;

        if (this.retryCount >= maxAttempts) {
          throw error;
        }

        this.events?.onRetryAttempt(this.retryCount, maxAttempts);

        // Exponential backoff with jitter
        const delay = this.config.retryDelay * Math.pow(2, this.retryCount - 1);
        const jitter = Math.random() * 0.1 * delay;
        await this.delay(delay + jitter);
      }
    }

    throw new Error('Max retry attempts exceeded');
  }

  /**
   * Get elapsed time since scan start
   */
  getElapsedTime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }

  /**
   * Create and track a timer
   */
  private createTimer(callback: () => void, delay: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      callback();
    }, delay);

    this.activeTimers.add(timer);
    return timer;
  }

  /**
   * Clear a specific timer
   */
  clearTimer(timer: NodeJS.Timeout): void {
    if (this.activeTimers.has(timer)) {
      clearTimeout(timer);
      this.activeTimers.delete(timer);
    }
  }

  /**
   * Clear all active timers
   */
  clearAllTimers(): void {
    this.activeTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.activeTimers.clear();
  }

  /**
   * Promise-based delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.createTimer(resolve, ms);
    });
  }

  /**
   * Get current retry count
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Reset timeout manager state
   */
  reset(): void {
    this.clearAllTimers();
    this.startTime = 0;
    this.retryCount = 0;
  }

  /**
   * Update timeout configuration
   */
  updateConfig(newConfig: Partial<TimeoutConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearAllTimers();
  }
}
