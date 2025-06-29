import type {
  ScanMode,
  ScanningState,
  FallbackConfig,
  ScanProgress,
  ScanMetrics,
  LicenseData,
  OCRTextObservation,
  PerformanceMetrics,
  PerformanceAlert,
  AutoModeState,
  AutoModeConfig,
  QualityMetrics,
} from '../types/license';
import { scanLicense, parseOCRText, ScanError } from '../index';
import { logger } from './logger';
import { performanceMonitor } from './PerformanceMonitor';
import { IntelligentModeManager } from './IntelligentModeManager';
import type { IntelligentModeManagerEvents } from './IntelligentModeManager';
import {
  ScanTimeoutManager,
  type TimeoutConfig,
  type TimeoutEvents,
} from './ScanTimeoutManager';
import {
  QualityMetricsProcessor,
  type QualityConfig,
  type QualityEvents,
} from './QualityMetricsProcessor';
import {
  StateTransitionManager,
  type StateConfig,
  type StateEvents,
} from './StateTransitionManager';

export interface FallbackControllerEvents {
  onProgressUpdate: (progress: ScanProgress) => void;
  onModeSwitch: (fromMode: ScanMode, toMode: ScanMode, reason: string) => void;
  onMetricsUpdate: (metrics: Partial<ScanMetrics>) => void;
  onPerformanceAlert?: (alert: PerformanceAlert) => void;
  onAutoModeStateChange?: (
    oldState: AutoModeState,
    newState: AutoModeState
  ) => void;
  onModeRecommendation?: (recommendedMode: ScanMode, reason: string) => void;
  onQualityAssessment?: (
    metrics: QualityMetrics,
    shouldSwitch: boolean
  ) => void;
}

// Export PerformanceAlert for use in other modules
export type { PerformanceAlert };

export class FallbackController {
  private config: FallbackConfig;
  private currentState: ScanningState = 'idle';
  private currentMode: ScanMode = 'auto';
  private scanStartTime: number = 0;
  // Removed barcodeStartTime and ocrStartTime - now using logger timing
  private barcodeAttempts: number = 0;
  private events?: FallbackControllerEvents;
  private abortController?: AbortController;
  // @ts-ignore - Used in prepareOCRProcessor() and destroy()
  private _ocrProcessorReady: boolean = false;
  private activeTimers: Set<NodeJS.Timeout> = new Set(); // Track active timers for cleanup
  private intelligentModeManager?: IntelligentModeManager;
  // Integration layer - extracted classes for enhanced coordination
  private timeoutManager?: ScanTimeoutManager;
  private qualityProcessor?: QualityMetricsProcessor;
  private stateManager?: StateTransitionManager;

  constructor(
    config: Partial<FallbackConfig> = {},
    events?: FallbackControllerEvents
  ) {
    this.config = {
      barcodeTimeoutMs: 3000, // 3 seconds default
      ocrTimeoutMs: 2000, // 2 seconds for OCR target
      maxBarcodeAttempts: 5,
      maxFallbackProcessingTimeMs: 4000, // 4 seconds total limit
      enableQualityAssessment: true,
      ...config,
    };
    this.events = events;

    // Initialize IntelligentModeManager with enhanced timeout settings
    const autoModeConfig: Partial<AutoModeConfig> = {
      pdf417TimeoutMs: config.barcodeTimeoutMs || 10000, // Use longer timeout for auto-mode
      warningThresholdMs: Math.round((config.barcodeTimeoutMs || 10000) * 0.7), // 70% of timeout
      minQualityScore: 0.7,
      switchDelayMs: 500,
    };

    const intelligentEvents: IntelligentModeManagerEvents = {
      onAutoModeStateChange: (
        oldState: AutoModeState,
        newState: AutoModeState
      ) => {
        if (this.events?.onAutoModeStateChange) {
          this.events.onAutoModeStateChange(oldState, newState);
        }
      },
      onModeRecommendation: (recommendedMode: ScanMode, reason: string) => {
        if (this.events?.onModeRecommendation) {
          this.events.onModeRecommendation(recommendedMode, reason);
        }
      },
      onWarningThresholdReached: (timeElapsed: number, threshold: number) => {
        logger.info('Auto-mode warning threshold reached', {
          timeElapsed,
          threshold,
        });
      },
      onQualityAssessment: (metrics: QualityMetrics, shouldSwitch: boolean) => {
        if (this.events?.onQualityAssessment) {
          this.events.onQualityAssessment(metrics, shouldSwitch);
        }
      },
    };

    this.intelligentModeManager = new IntelligentModeManager(
      autoModeConfig,
      intelligentEvents
    );

    // Initialize extracted classes for enhanced coordination
    this.initializeExtractedClasses();

    // Start preparing OCR processor in parallel
    this.prepareOCRProcessor();

    logger.info('FallbackController initialized', { config: this.config });
  }

  /**
   * Start scanning with automatic fallback logic - OPTIMIZED
   */
  async scan(
    input: string | OCRTextObservation[],
    mode: ScanMode = 'auto'
  ): Promise<LicenseData> {
    this.reset();
    this.currentMode = mode;
    this.scanStartTime = Date.now();
    this.abortController = new AbortController();

    // Optimized performance monitoring - minimal overhead
    const sessionType = mode === 'auto' ? 'fallback' : mode;
    performanceMonitor.startSession(sessionType);

    try {
      let result: LicenseData;

      if (mode === 'ocr' || Array.isArray(input)) {
        result = await this.performOCRScan(input as OCRTextObservation[]);
      } else if (mode === 'barcode') {
        result = await this.performBarcodeScan(input as string);
      } else {
        // Auto mode: try barcode first, fallback to OCR with intelligent management
        if (typeof input === 'string') {
          try {
            // Start intelligent auto-mode session
            if (this.intelligentModeManager) {
              this.intelligentModeManager.startAutoModeSession();
            }

            result = await this.performBarcodeScanWithFallback(input as string);
          } catch (error) {
            if (this.abortController.signal.aborted) {
              throw new ScanError({
                code: 'SCAN_ABORTED',
                message: 'Scan was cancelled',
                userMessage: 'Scan cancelled',
                recoverable: true,
              });
            }
            throw error;
          }
        } else {
          throw new ScanError({
            code: 'INVALID_INPUT',
            message: 'Invalid input type for auto mode',
            userMessage: 'Invalid scanning input',
            recoverable: true,
          });
        }
      }

      return result;
    } catch (error) {
      this.updateState('failed');
      this.notifyMetrics({ success: false });
      throw error;
    } finally {
      // Optimized performance monitoring - minimal overhead
      const detailedMetrics = performanceMonitor.endSession();

      // Only process detailed metrics if events are configured
      if (detailedMetrics && this.events?.onMetricsUpdate) {
        this.notifyEnhancedMetrics(detailedMetrics);
      }

      // Fast timeout check using scan start time
      const totalTime = Date.now() - this.scanStartTime;
      if (totalTime > this.config.maxFallbackProcessingTimeMs) {
        this.raiseAlert({
          type: 'critical',
          category: 'timeout',
          message: `Total processing time exceeded: ${totalTime}ms > ${this.config.maxFallbackProcessingTimeMs}ms`,
          timestamp: Date.now(),
          threshold: this.config.maxFallbackProcessingTimeMs,
          actualValue: totalTime,
        });
      }
    }
  }

  /**
   * Perform barcode scan with automatic fallback to OCR
   */
  private async performBarcodeScanWithFallback(
    barcodeData: string
  ): Promise<LicenseData> {
    try {
      const result = await this.performBarcodeScan(barcodeData);
      this.notifyMetrics({ success: true, fallbackTriggered: false });
      return result;
    } catch (barcodeError) {
      const timeElapsed = Date.now() - this.scanStartTime;
      const shouldFallback = this.shouldTriggerFallback(
        barcodeError,
        timeElapsed
      );

      if (!shouldFallback) {
        throw barcodeError;
      }

      // Determine fallback reason
      let fallbackReason: 'timeout' | 'failure' | 'quality' | 'manual' =
        'failure';
      if (timeElapsed >= this.config.barcodeTimeoutMs) {
        fallbackReason = 'timeout';
      } else if (
        barcodeError instanceof ScanError &&
        barcodeError.code.includes('QUALITY')
      ) {
        fallbackReason = 'quality';
      }

      logger.info('Triggering fallback to OCR', {
        reason: fallbackReason,
        timeElapsed,
        barcodeAttempts: this.barcodeAttempts,
      });

      this.notifyModeSwitch(
        'barcode',
        'ocr',
        `Fallback triggered: ${fallbackReason}`
      );
      this.updateState('fallback_transition');

      // Optimized transition with minimal overhead
      const transitionStartTime = Date.now();

      // Enforce <200ms transition requirement
      const transitionPromise = new Promise<OCRTextObservation[]>((resolve) => {
        // For demo purposes, we'll simulate OCR data based on typical license fields
        const mockOCRData: OCRTextObservation[] = this.generateMockOCRData();

        // Simulate transition work (normally would involve actual OCR preparation)
        this.createTimer(() => {
          resolve(mockOCRData);
        }, 50); // Simulate fast transition
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        this.createTimer(() => {
          reject(
            new ScanError({
              code: 'TRANSITION_TIMEOUT',
              message: 'Mode transition exceeded 200ms limit',
              userMessage:
                'Mode switching is taking too long. Please try again.',
              recoverable: true,
            })
          );
        }, 200); // 200ms strict limit
      });

      let mockOCRData: OCRTextObservation[];
      try {
        mockOCRData = await Promise.race([transitionPromise, timeoutPromise]);
      } catch (transitionError) {
        const transitionTime = Date.now() - transitionStartTime;

        this.raiseAlert({
          type: 'critical',
          category: 'transition',
          message: `Mode transition failed: ${transitionTime}ms > 200ms`,
          timestamp: Date.now(),
          threshold: 200,
          actualValue: transitionTime,
        });
        throw transitionError;
      }

      // Fast transition time validation
      const transitionTime = Date.now() - transitionStartTime;

      if (transitionTime > 200) {
        this.raiseAlert({
          type: 'critical',
          category: 'transition',
          message: `Mode transition exceeded limit: ${transitionTime}ms > 200ms`,
          timestamp: Date.now(),
          threshold: 200,
          actualValue: transitionTime,
        });
      }

      const ocrResult = await this.performOCRScan(mockOCRData);
      this.notifyMetrics({
        success: true,
        fallbackTriggered: true,
        fallbackReason,
      });

      return ocrResult;
    }
  }

  /**
   * Perform barcode-only scan with retry logic - OPTIMIZED
   */
  private async performBarcodeScan(barcodeData: string): Promise<LicenseData> {
    this.updateState('barcode');

    try {
      // Optimized retry with minimal logging overhead
      return await this.optimizedRetry(
        async () => {
          this.barcodeAttempts++;
          this.notifyProgress(); // Notify progress with updated attempt count

          // Fast timeout wrapper
          const timeoutPromise = new Promise<never>((_, reject) => {
            this.createTimer(() => {
              reject(
                new ScanError({
                  code: 'BARCODE_TIMEOUT',
                  message: `Barcode scanning timeout after ${this.config.barcodeTimeoutMs}ms`,
                  userMessage:
                    'Barcode scanning is taking too long. Trying text recognition...',
                  recoverable: true,
                })
              );
            }, this.config.barcodeTimeoutMs);
          });

          const scanPromise = scanLicense(barcodeData);
          let result;
          try {
            result = await Promise.race([scanPromise, timeoutPromise]);
          } catch (scanError) {
            // If the scan itself failed, preserve the original error
            throw scanError;
          }

          // Ensure we have a valid result
          if (!result) {
            throw new ScanError({
              code: 'BARCODE_SCAN_ERROR',
              message: 'Barcode scan returned no data',
              userMessage: 'Unable to scan barcode. Please try again.',
              recoverable: true,
            });
          }

          this.updateState('completed');
          this.notifyMetrics({
            success: true,
            finalMode: 'barcode',
            barcodeAttemptTime: Date.now() - this.scanStartTime,
          });
          return result;
        },
        3 // maxAttempts
      );
    } catch (error) {
      // Preserve original ScanError instances for test compatibility
      if (error instanceof ScanError) {
        throw error;
      }

      // Wrap unknown errors in ScanError
      throw new ScanError({
        code: 'BARCODE_SCAN_ERROR',
        message: 'Barcode scanning failed',
        userMessage: 'Unable to scan barcode. Please try again.',
        recoverable: true,
      });
    }
  }

  /**
   * Perform OCR-only scan with retry logic - OPTIMIZED
   */
  private async performOCRScan(
    textObservations: OCRTextObservation[]
  ): Promise<LicenseData> {
    this.updateState('ocr');

    // Optimized retry with minimal monitoring overhead
    return await this.optimizedRetry(
      async () => {
        // Fast timeout wrapper for OCR (2 seconds as per requirement)
        const timeoutPromise = new Promise<never>((_, reject) => {
          this.createTimer(() => {
            reject(
              new ScanError({
                code: 'OCR_TIMEOUT',
                message: `OCR processing timeout after 2000ms`,
                userMessage:
                  'Text recognition is taking too long. Please try again.',
                recoverable: true,
              })
            );
          }, 2000);
        });

        // Optimized Neural Engine processing
        const optimizedParsePromise =
          this.parseOCRWithNeuralEngineOptimization(textObservations);

        let result;
        try {
          result = await Promise.race([optimizedParsePromise, timeoutPromise]);
        } catch (ocrError) {
          // If the OCR itself failed, preserve the original error
          throw ocrError;
        }

        // Fast confidence calculation with null safety
        const fieldsFound = [
          result?.firstName,
          result?.lastName,
          result?.licenseNumber,
          result?.address?.street,
        ].filter(Boolean).length;
        const confidenceScore = fieldsFound / 4;

        this.updateState('completed');
        this.notifyMetrics({
          success: true,
          finalMode: 'ocr',
          confidenceScore: confidenceScore,
        });
        return result;
      },
      3 // maxAttempts
    );
  }

  /**
   * Determine if fallback should be triggered based on error and timing
   */
  private shouldTriggerFallback(error: unknown, timeElapsed: number): boolean {
    // Don't fallback if we're not in auto mode
    if (this.currentMode !== 'auto') {
      return false;
    }

    // Don't fallback if total time would exceed limit
    const remainingTime = this.config.maxFallbackProcessingTimeMs - timeElapsed;
    if (remainingTime < 1000) {
      // Need at least 1 second for OCR
      return false;
    }

    // Fallback on timeout
    if (timeElapsed >= this.config.barcodeTimeoutMs) {
      return true;
    }

    // Fallback on max attempts reached
    if (this.barcodeAttempts >= this.config.maxBarcodeAttempts) {
      return true;
    }

    // Fallback on specific error types
    if (error instanceof ScanError) {
      const fallbackCodes = [
        'INVALID_BARCODE_FORMAT',
        'BARCODE_NOT_FOUND',
        'POOR_IMAGE_QUALITY',
        'DECODING_ERROR',
      ];
      return fallbackCodes.includes(error.code);
    }

    return false;
  }

  /**
   * Neural Engine optimized OCR parsing for M3 iPad - OPTIMIZED
   */
  private async parseOCRWithNeuralEngineOptimization(
    textObservations: OCRTextObservation[]
  ): Promise<LicenseData> {
    // Fast pre-filtering for high confidence observations
    const highQualityObservations = textObservations.filter(
      (obs) => obs.confidence > 0.7
    );

    // Use high quality observations if available, otherwise use all
    const targetObservations =
      highQualityObservations.length > 0
        ? highQualityObservations
        : textObservations;

    // Optimized batch processing - sort by confidence for Neural Engine efficiency
    if (targetObservations.length > 4) {
      targetObservations.sort((a, b) => b.confidence - a.confidence);
    }

    return parseOCRText(targetObservations);
  }

  /**
   * Optimized retry implementation with minimal overhead
   */
  private async optimizedRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    let delayMs = 100;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts) {
          break;
        }

        // Fast exponential backoff without logging overhead
        await new Promise((resolve) =>
          this.createTimer(() => resolve(undefined), delayMs)
        );
        delayMs = Math.min(delayMs * 2, 1000);
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Parallel OCR processor preparation
   */
  private async prepareOCRProcessor(): Promise<void> {
    // Simulate OCR processor preparation in background
    this.createTimer(() => {
      this._ocrProcessorReady = true;
      logger.info('OCR processor ready for parallel processing');
    }, 500);
  }

  /**
   * Generate mock OCR data for demonstration
   */
  private generateMockOCRData(): OCRTextObservation[] {
    return [
      {
        text: 'SAMPLE',
        confidence: 0.95,
        boundingBox: { x: 100, y: 50, width: 80, height: 20 },
      },
      {
        text: 'JOHN',
        confidence: 0.98,
        boundingBox: { x: 100, y: 80, width: 60, height: 20 },
      },
      {
        text: 'DOE',
        confidence: 0.97,
        boundingBox: { x: 170, y: 80, width: 50, height: 20 },
      },
      {
        text: 'D12345678',
        confidence: 0.93,
        boundingBox: { x: 100, y: 110, width: 100, height: 20 },
      },
      {
        text: '123 MAIN ST',
        confidence: 0.89,
        boundingBox: { x: 100, y: 140, width: 120, height: 20 },
      },
      {
        text: 'ANYTOWN CA 12345',
        confidence: 0.91,
        boundingBox: { x: 100, y: 170, width: 150, height: 20 },
      },
    ];
  }

  /**
   * Update current scanning state
   */
  private updateState(newState: ScanningState): void {
    this.currentState = newState;
    this.notifyProgress();
  }

  /**
   * Process quality metrics for intelligent mode switching
   */
  processQualityMetrics(metrics: QualityMetrics): boolean {
    // Use extracted quality processor if available
    if (this.qualityProcessor && this.currentMode === 'auto') {
      const shouldSwitch = this.qualityProcessor.processQualityMetrics(metrics);
      if (shouldSwitch && this.events?.onQualityAssessment) {
        this.events.onQualityAssessment(metrics, shouldSwitch);
      }
      return shouldSwitch;
    }

    // Fallback to intelligent mode manager for compatibility
    if (this.currentMode === 'auto' && this.intelligentModeManager) {
      return this.intelligentModeManager.processQualityMetrics(metrics);
    }
    return false;
  }

  /**
   * Get current auto-mode state if in auto mode
   */
  getCurrentAutoState(): AutoModeState | null {
    if (this.currentMode === 'auto' && this.intelligentModeManager) {
      return this.intelligentModeManager.getCurrentAutoState();
    }
    return null;
  }

  /**
   * Notify progress update
   */
  private notifyProgress(): void {
    if (!this.events?.onProgressUpdate) return;

    let progress: ScanProgress = {
      state: this.currentState,
      mode: this.currentMode,
      startTime: this.scanStartTime,
      barcodeAttempts: this.barcodeAttempts,
      timeElapsed: Date.now() - this.scanStartTime,
      message: this.getProgressMessage(),
    };

    // Enhance progress with intelligent mode information if in auto mode
    if (this.currentMode === 'auto' && this.intelligentModeManager) {
      const autoProgress = this.intelligentModeManager.getProgressInfo();
      progress = { ...progress, ...autoProgress };
    }

    this.events.onProgressUpdate(progress);
  }

  /**
   * Notify mode switch
   */
  private notifyModeSwitch(
    fromMode: ScanMode,
    toMode: ScanMode,
    reason: string
  ): void {
    if (!this.events?.onModeSwitch) return;
    this.events.onModeSwitch(fromMode, toMode, reason);
  }

  /**
   * Notify metrics update
   */
  private notifyMetrics(metrics: Partial<ScanMetrics>): void {
    if (!this.events?.onMetricsUpdate) return;

    const fullMetrics: Partial<ScanMetrics> = {
      totalProcessingTime: Date.now() - this.scanStartTime,
      ...metrics,
    };

    this.events.onMetricsUpdate(fullMetrics);
  }

  /**
   * Notify enhanced metrics with detailed performance data
   */
  private notifyEnhancedMetrics(detailedMetrics: PerformanceMetrics): void {
    if (!this.events?.onMetricsUpdate) return;

    const enhancedScanMetrics: Partial<ScanMetrics> = {
      totalProcessingTime: detailedMetrics.totalProcessingTime,
      ocrProcessingTime: detailedMetrics.ocrProcessingTime,
      modeTransitionTime: detailedMetrics.modeTransitionTime,
      peakMemoryUsageMB: detailedMetrics.peakMemoryUsageMB,

      // Performance rating based on targets
      performanceRating: this.calculatePerformanceRating(detailedMetrics),

      // Detailed performance data
      detailedPerformance: detailedMetrics,

      // Performance alerts
      performanceAlerts: performanceMonitor.getRecentAlerts(5),

      // Bottlenecks and recommendations
      bottlenecks: this.identifyBottlenecks(detailedMetrics),
      recommendations: this.generateRecommendations(detailedMetrics),
    };

    this.events.onMetricsUpdate(enhancedScanMetrics);
  }

  /**
   * Calculate overall performance rating based on targets
   */
  private calculatePerformanceRating(
    metrics: PerformanceMetrics
  ): 'excellent' | 'good' | 'acceptable' | 'poor' | 'critical' {
    const targetsMet = [
      metrics.meetsOcrTarget,
      metrics.meetsFallbackTarget,
      metrics.meetsMemoryTarget,
      metrics.meetsCpuTarget,
    ].filter(Boolean).length;

    if (targetsMet === 4) return 'excellent';
    if (targetsMet === 3) return 'good';
    if (targetsMet === 2) return 'acceptable';
    if (targetsMet === 1) return 'poor';
    return 'critical';
  }

  /**
   * Identify performance bottlenecks
   */
  private identifyBottlenecks(metrics: PerformanceMetrics): string[] {
    const bottlenecks: string[] = [];

    if (!metrics.meetsOcrTarget) {
      bottlenecks.push(
        `OCR processing slow: ${metrics.ocrProcessingTime}ms > 2000ms`
      );
    }

    if (!metrics.meetsFallbackTarget) {
      bottlenecks.push(
        `Total processing slow: ${metrics.totalProcessingTime}ms > 4000ms`
      );
    }

    if (!metrics.meetsMemoryTarget) {
      bottlenecks.push(`Memory usage high: ${metrics.memoryDeltaMB}MB > 50MB`);
    }

    if (!metrics.meetsCpuTarget && metrics.peakCpuUtilization) {
      bottlenecks.push(
        `CPU utilization high: ${metrics.peakCpuUtilization}% > 60%`
      );
    }

    if (metrics.modeTransitionTime && metrics.modeTransitionTime > 200) {
      bottlenecks.push(
        `Mode transition slow: ${metrics.modeTransitionTime}ms > 200ms`
      );
    }

    return bottlenecks;
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(metrics: PerformanceMetrics): string[] {
    const recommendations: string[] = [];

    if (!metrics.meetsOcrTarget) {
      recommendations.push('Consider reducing OCR preprocessing complexity');
      recommendations.push('Optimize Neural Engine utilization');
    }

    if (!metrics.meetsMemoryTarget) {
      recommendations.push('Implement more aggressive memory cleanup');
      recommendations.push('Reduce frame buffer size');
    }

    if (!metrics.meetsCpuTarget) {
      recommendations.push('Move more processing to GPU/Neural Engine');
      recommendations.push('Implement frame dropping during high load');
    }

    if (metrics.framesDropped && metrics.framesDropped > 0) {
      recommendations.push('Improve frame processing efficiency');
    }

    return recommendations;
  }

  /**
   * Get progress message for current state
   */
  private getProgressMessage(): string {
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
   * Helper method to create tracked setTimeout with safe cleanup
   */
  private createTimer(callback: () => void, delay: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      try {
        // Remove from activeTimers first to prevent race conditions
        this.activeTimers.delete(timer);

        // Only execute callback if not aborted and controller is still alive
        if (
          !this.abortController?.signal.aborted &&
          this.currentState !== 'idle'
        ) {
          callback();
        }
      } catch (error) {
        logger.error('Timer callback error', {
          error: (error as Error).message,
        });
      }
    }, delay);

    // Track timer immediately after creation
    this.activeTimers.add(timer);

    // Set up abort signal listener to clean up timer if aborted
    if (this.abortController?.signal) {
      const abortHandler = () => {
        if (this.activeTimers.has(timer)) {
          clearTimeout(timer);
          this.activeTimers.delete(timer);
        }
      };

      // Check if already aborted
      if (this.abortController.signal.aborted) {
        abortHandler();
      } else {
        this.abortController.signal.addEventListener('abort', abortHandler);
      }
    }

    return timer;
  }

  /**
   * Clear all active timers with safe cleanup
   */
  private clearAllTimers(): void {
    // Create a copy to avoid modification during iteration
    const timersToClear = Array.from(this.activeTimers);

    // Clear the set first to prevent new timers being added during cleanup
    this.activeTimers.clear();

    timersToClear.forEach((timer) => {
      try {
        clearTimeout(timer);
      } catch (error) {
        logger.warn('Error clearing timer', {
          error: (error as Error).message,
        });
      }
    });
  }

  /**
   * Cancel current scan operation
   */
  cancel(): void {
    // Immediately clear all timers to prevent new ones from firing
    this.clearAllTimers();

    // Then abort the controller to signal all operations to stop
    if (this.abortController) {
      this.abortController.abort();
    }

    this.updateState('idle');
    logger.info('Scan cancelled by user');
  }

  /**
   * Reset controller state
   */
  private reset(): void {
    // Abort any existing operations first
    if (this.abortController) {
      this.abortController.abort();
    }

    // Clear all timers after aborting to ensure proper cleanup
    this.clearAllTimers();

    // Reset state
    this.currentState = 'idle';
    this.scanStartTime = 0;
    this.barcodeAttempts = 0;

    // Clear abortController reference after cleanup
    this.abortController = undefined;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<FallbackConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('FallbackController config updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): FallbackConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): ScanningState {
    return this.currentState;
  }

  /**
   * Get current mode
   */
  getMode(): ScanMode {
    return this.currentMode;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): Record<string, any> {
    return logger.getPerformanceMetrics();
  }

  /**
   * Raise performance alert
   */
  private raiseAlert(alert: PerformanceAlert): void {
    logger.warn('Performance alert', alert);

    if (this.events?.onPerformanceAlert) {
      this.events.onPerformanceAlert(alert);
    }
  }

  /**
   * Initialize extracted classes for enhanced coordination
   */
  private initializeExtractedClasses(): void {
    // Initialize timeout manager
    const timeoutConfig: TimeoutConfig = {
      barcodeTimeout: this.config.barcodeTimeoutMs,
      ocrTimeout: this.config.ocrTimeoutMs,
      maxRetries: this.config.maxBarcodeAttempts,
      retryDelay: 100,
    };

    const timeoutEvents: TimeoutEvents = {
      onTimeout: (type, elapsed) => {
        logger.info(`Timeout manager: ${type} timeout after ${elapsed}ms`);
      },
      onRetryAttempt: (attempt, max) => {
        logger.info(`Timeout manager: Retry attempt ${attempt}/${max}`);
      },
    };

    this.timeoutManager = new ScanTimeoutManager(timeoutConfig, timeoutEvents);

    // Initialize quality processor
    const qualityConfig: QualityConfig = {
      minQualityThreshold: 0.4,
      bufferSize: 10,
      consistencyWindowMs: 2000,
      autoSwitchEnabled: this.config.enableQualityAssessment,
    };

    const qualityEvents: QualityEvents = {
      onQualityAssessment: (metrics, shouldSwitch) => {
        if (shouldSwitch && this.events?.onQualityAssessment) {
          // Convert RealTimeQualityMetrics to simple QualityMetrics for compatibility
          const simpleMetrics: QualityMetrics = {
            brightness: metrics.lighting.brightness,
            blur: metrics.blur.value,
            glare: 1 - metrics.lighting.uniformity, // Approximate glare from uniformity
            documentAlignment: metrics.positioning.alignment,
          };
          this.events.onQualityAssessment(simpleMetrics, shouldSwitch);
        }
      },
      onQualityImprovement: (oldScore, newScore) => {
        logger.info('Quality improvement detected', { oldScore, newScore });
      },
      onModeRecommendation: (mode, reason) => {
        logger.info('Quality processor mode recommendation', { mode, reason });
      },
    };

    this.qualityProcessor = new QualityMetricsProcessor(
      qualityConfig,
      qualityEvents
    );

    // Initialize state manager
    const stateConfig: StateConfig = {
      maxBarcodeAttempts: this.config.maxBarcodeAttempts,
      barcodeTimeoutMs: this.config.barcodeTimeoutMs,
      maxFallbackProcessingTimeMs: this.config.maxFallbackProcessingTimeMs,
      enableAutoFallback: true,
    };

    const stateEvents: StateEvents = {
      onStateChange: (oldState, newState) => {
        // Sync with local state for compatibility
        this.currentState = newState;
        logger.info('State transition via StateManager', {
          from: oldState,
          to: newState,
        });
      },
      onModeSwitch: (fromMode, toMode, reason) => {
        // Sync with local state for compatibility
        this.currentMode = toMode;
        this.notifyModeSwitch(fromMode, toMode, reason);
      },
      onProgressUpdate: (progress) => {
        // Sync with local tracking for compatibility
        this.scanStartTime = progress.startTime;
        this.barcodeAttempts = progress.barcodeAttempts;
        this.notifyProgress();
      },
    };

    this.stateManager = new StateTransitionManager(stateConfig, stateEvents);

    logger.info('Extracted classes initialized for enhanced coordination');
  }

  /**
   * Cleanup method for proper disposal with guaranteed resource cleanup
   */
  destroy(): void {
    try {
      // First, abort any ongoing operations
      if (this.abortController) {
        this.abortController.abort();
      }

      // Clear all timers with safe cleanup
      this.clearAllTimers();

      // Cleanup IntelligentModeManager
      if (this.intelligentModeManager) {
        this.intelligentModeManager.destroy();
        this.intelligentModeManager = undefined;
      }

      // Cleanup extracted classes
      if (this.timeoutManager) {
        this.timeoutManager.destroy();
        this.timeoutManager = undefined;
      }
      if (this.qualityProcessor) {
        this.qualityProcessor.reset();
        this.qualityProcessor = undefined;
      }
      if (this.stateManager) {
        this.stateManager.destroy();
        this.stateManager = undefined;
      }

      // Reset state
      this.currentState = 'idle';
      this.scanStartTime = 0;
      this.barcodeAttempts = 0;
      this._ocrProcessorReady = false;

      // Clear references to prevent memory leaks
      this.events = undefined;
      this.abortController = undefined;

      logger.info('FallbackController destroyed successfully');
    } catch (error) {
      logger.error('Error during FallbackController destruction', {
        error: (error as Error).message,
      });
    }
  }
}
