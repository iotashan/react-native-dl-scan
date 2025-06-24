import type {
  ScanMode,
  AutoModeConfig,
  QualityMetrics,
  ScanProgress,
} from '../types/license';
import { AutoModeState } from '../types/license';
import { logger } from './logger';

export interface IntelligentModeManagerEvents {
  onAutoModeStateChange: (
    oldState: AutoModeState,
    newState: AutoModeState
  ) => void;
  onModeRecommendation: (recommendedMode: ScanMode, reason: string) => void;
  onWarningThresholdReached: (timeElapsed: number, threshold: number) => void;
  onQualityAssessment: (metrics: QualityMetrics, shouldSwitch: boolean) => void;
}

export class IntelligentModeManager {
  private config: AutoModeConfig;
  private currentAutoState: AutoModeState = AutoModeState.INITIAL_PDF417;
  private events?: IntelligentModeManagerEvents;
  private scanStartTime: number = 0;
  private qualityHistoryBuffer: QualityMetrics[] = [];
  private warningTimer?: NodeJS.Timeout;
  private timeoutTimer?: NodeJS.Timeout;

  constructor(
    config: Partial<AutoModeConfig> = {},
    events?: IntelligentModeManagerEvents
  ) {
    this.config = {
      pdf417TimeoutMs: 10000, // 10 seconds default
      warningThresholdMs: 7000, // 7 seconds warning
      minQualityScore: 0.7, // 70% quality threshold
      switchDelayMs: 500, // 500ms smooth transition
      ...config,
    };
    this.events = events;

    logger.info('IntelligentModeManager initialized', { config: this.config });
  }

  /**
   * Start intelligent mode management for an auto-mode scan
   */
  startAutoModeSession(): void {
    this.reset();
    this.scanStartTime = Date.now();
    this.currentAutoState = AutoModeState.INITIAL_PDF417;

    this.setupTimers();

    logger.info('Auto-mode session started', {
      state: this.currentAutoState,
      warningThreshold: this.config.warningThresholdMs,
      timeoutThreshold: this.config.pdf417TimeoutMs,
    });
  }

  /**
   * Setup warning and timeout timers
   */
  private setupTimers(): void {
    // Clear existing timers first
    this.clearTimers();

    // Only setup timers if we have a valid scan start time
    if (this.scanStartTime === 0) {
      logger.warn('Attempted to setup timers without valid scan start time');
      return;
    }

    // Warning timer - notify when approaching timeout
    this.warningTimer = setTimeout(() => {
      try {
        const timeElapsed = Date.now() - this.scanStartTime;
        this.transitionToState(AutoModeState.PDF417_TIMEOUT_WARNING);

        if (this.events?.onWarningThresholdReached) {
          this.events.onWarningThresholdReached(
            timeElapsed,
            this.config.warningThresholdMs
          );
        }

        logger.info('PDF417 timeout warning triggered', {
          timeElapsed,
          threshold: this.config.warningThresholdMs,
        });
      } catch (error) {
        logger.error('Error in warning timer callback', {
          error: (error as Error).message,
        });
      }
    }, this.config.warningThresholdMs);

    // Timeout timer - trigger automatic switch to OCR
    this.timeoutTimer = setTimeout(() => {
      try {
        const timeElapsed = Date.now() - this.scanStartTime;
        this.triggerTimeoutFallback(timeElapsed);
      } catch (error) {
        logger.error('Error in timeout timer callback', {
          error: (error as Error).message,
        });
      }
    }, this.config.pdf417TimeoutMs);

    logger.debug('Timers setup successfully', {
      warningThreshold: this.config.warningThresholdMs,
      timeoutThreshold: this.config.pdf417TimeoutMs,
    });
  }

  /**
   * Process quality metrics for current frame
   */
  processQualityMetrics(metrics: QualityMetrics): boolean {
    // Add to history buffer (keep last 5 frames)
    this.qualityHistoryBuffer.push(metrics);
    if (this.qualityHistoryBuffer.length > 5) {
      this.qualityHistoryBuffer.shift();
    }

    // Calculate quality-based switching decision
    const shouldSwitchToOCR = this.shouldSwitchToOCR(this.qualityHistoryBuffer);

    if (this.events?.onQualityAssessment) {
      this.events.onQualityAssessment(metrics, shouldSwitchToOCR);
    }

    if (
      shouldSwitchToOCR &&
      this.currentAutoState === AutoModeState.INITIAL_PDF417
    ) {
      this.triggerQualityBasedFallback(metrics);
      return true;
    }

    return false;
  }

  /**
   * Determine if we should switch to OCR based on quality metrics
   */
  private shouldSwitchToOCR(metrics: QualityMetrics[]): boolean {
    if (metrics.length < 3) {
      // Need at least 3 frames for reliable assessment
      return false;
    }

    const recentMetrics = metrics.slice(-5); // Last 5 frames
    const avgQuality = this.calculateAverageQuality(recentMetrics);

    return avgQuality < this.config.minQualityScore;
  }

  /**
   * Calculate average quality score from metrics array
   */
  private calculateAverageQuality(metrics: QualityMetrics[]): number {
    if (metrics.length === 0) return 1.0;

    const totalScore = metrics.reduce((sum, metric) => {
      // Quality score calculation: higher brightness and alignment are better,
      // lower blur and glare are better
      const score =
        (metric.brightness +
          metric.documentAlignment +
          (1 - metric.blur) +
          (1 - metric.glare)) /
        4;

      return sum + score;
    }, 0);

    return totalScore / metrics.length;
  }

  /**
   * Trigger timeout-based fallback to OCR
   */
  private triggerTimeoutFallback(timeElapsed: number): void {
    logger.info('Triggering timeout-based fallback to OCR', {
      timeElapsed,
      threshold: this.config.pdf417TimeoutMs,
      currentState: this.currentAutoState,
    });

    this.transitionToOCRMode('timeout');
  }

  /**
   * Trigger quality-based fallback to OCR
   */
  private triggerQualityBasedFallback(metrics: QualityMetrics): void {
    const avgQuality = this.calculateAverageQuality(this.qualityHistoryBuffer);

    logger.info('Triggering quality-based fallback to OCR', {
      avgQuality,
      threshold: this.config.minQualityScore,
      metrics,
      currentState: this.currentAutoState,
    });

    this.transitionToOCRMode('quality');
  }

  /**
   * Transition to OCR mode with smooth switching
   */
  private transitionToOCRMode(reason: 'timeout' | 'quality'): void {
    this.transitionToState(AutoModeState.SWITCHING_TO_OCR);

    // Clear existing timers since we're switching modes
    this.clearTimers();

    // Smooth transition delay
    setTimeout(() => {
      this.transitionToState(AutoModeState.OCR_ACTIVE);

      if (this.events?.onModeRecommendation) {
        this.events.onModeRecommendation(
          'ocr',
          `Auto-mode switching due to ${reason}`
        );
      }
    }, this.config.switchDelayMs);
  }

  /**
   * Transition to a new auto-mode state
   */
  private transitionToState(newState: AutoModeState): void {
    const oldState = this.currentAutoState;
    this.currentAutoState = newState;

    if (this.events?.onAutoModeStateChange) {
      this.events.onAutoModeStateChange(oldState, newState);
    }

    logger.debug('Auto-mode state transition', {
      from: oldState,
      to: newState,
      timeElapsed: Date.now() - this.scanStartTime,
    });
  }

  /**
   * Mark scan as successful and complete
   */
  markSuccess(): void {
    this.transitionToState(AutoModeState.SUCCESS);
    this.clearTimers();

    logger.info('Auto-mode scan completed successfully', {
      finalState: this.currentAutoState,
      totalTime: Date.now() - this.scanStartTime,
    });
  }

  /**
   * Get current auto-mode state
   */
  getCurrentAutoState(): AutoModeState {
    return this.currentAutoState;
  }

  /**
   * Get time elapsed since scan start
   */
  getTimeElapsed(): number {
    return this.scanStartTime > 0 ? Date.now() - this.scanStartTime : 0;
  }

  /**
   * Get remaining time before timeout
   */
  getTimeRemaining(): number {
    const elapsed = this.getTimeElapsed();
    return Math.max(0, this.config.pdf417TimeoutMs - elapsed);
  }

  /**
   * Check if warning threshold has been reached
   */
  isWarningThresholdReached(): boolean {
    return this.getTimeElapsed() >= this.config.warningThresholdMs;
  }

  /**
   * Check if timeout threshold has been reached
   */
  isTimeoutReached(): boolean {
    return this.getTimeElapsed() >= this.config.pdf417TimeoutMs;
  }

  /**
   * Get progress information for UI updates
   */
  getProgressInfo(): Partial<ScanProgress> {
    const timeElapsed = this.getTimeElapsed();
    const timeRemaining = this.getTimeRemaining();
    const progressPercentage = Math.min(
      100,
      (timeElapsed / this.config.pdf417TimeoutMs) * 100
    );

    return {
      timeElapsed,
      estimatedTimeRemaining: timeRemaining,
      progressPercentage,
      isTransitioning: this.currentAutoState === AutoModeState.SWITCHING_TO_OCR,
      message: this.getStateMessage(),
      accessibilityAnnouncement: this.getAccessibilityMessage(),
    };
  }

  /**
   * Get user-friendly message for current state
   */
  private getStateMessage(): string {
    switch (this.currentAutoState) {
      case AutoModeState.INITIAL_PDF417:
        return 'Scanning barcode on back of license...';
      case AutoModeState.PDF417_TIMEOUT_WARNING:
        return 'Still scanning barcode... may switch to text mode soon';
      case AutoModeState.SWITCHING_TO_OCR:
        return 'Switching to text recognition mode...';
      case AutoModeState.OCR_ACTIVE:
        return 'Scanning text on front of license...';
      case AutoModeState.SUCCESS:
        return 'Scan completed successfully!';
      default:
        return 'Processing...';
    }
  }

  /**
   * Get accessibility announcement for screen readers
   */
  private getAccessibilityMessage(): string {
    switch (this.currentAutoState) {
      case AutoModeState.INITIAL_PDF417:
        return 'Auto-mode: scanning barcode';
      case AutoModeState.PDF417_TIMEOUT_WARNING:
        return 'Warning: may switch to text scanning soon';
      case AutoModeState.SWITCHING_TO_OCR:
        return 'Switching to text recognition mode';
      case AutoModeState.OCR_ACTIVE:
        return 'Now scanning license text';
      case AutoModeState.SUCCESS:
        return 'Scan completed successfully';
      default:
        return 'Processing';
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AutoModeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('IntelligentModeManager config updated', {
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoModeConfig {
    return { ...this.config };
  }

  /**
   * Cancel current auto-mode session
   */
  cancel(): void {
    this.clearTimers();
    this.reset();
    logger.info('Auto-mode session cancelled');
  }

  /**
   * Clear all active timers
   */
  private clearTimers(): void {
    if (this.warningTimer) {
      try {
        clearTimeout(this.warningTimer);
      } catch (error) {
        logger.warn('Error clearing warning timer', {
          error: (error as Error).message,
        });
      }
      this.warningTimer = undefined;
    }

    if (this.timeoutTimer) {
      try {
        clearTimeout(this.timeoutTimer);
      } catch (error) {
        logger.warn('Error clearing timeout timer', {
          error: (error as Error).message,
        });
      }
      this.timeoutTimer = undefined;
    }

    logger.debug('All timers cleared successfully');
  }

  /**
   * Reset manager state
   */
  private reset(): void {
    this.currentAutoState = AutoModeState.INITIAL_PDF417;
    this.scanStartTime = 0;
    this.qualityHistoryBuffer = [];
    this.clearTimers();
  }

  /**
   * Cleanup and destroy manager
   */
  destroy(): void {
    try {
      // Clear timers first to prevent any callbacks during destruction
      this.clearTimers();
      
      // Reset state
      this.reset();
      
      // Clear event references to prevent memory leaks
      this.events = undefined;
      
      logger.info('IntelligentModeManager destroyed successfully');
    } catch (error) {
      logger.error('Error during IntelligentModeManager destruction', {
        error: (error as Error).message,
      });
    }
  }
}
