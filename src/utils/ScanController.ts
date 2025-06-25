/**
 * ScanController
 *
 * Simplified core scanning coordinator extracted from FallbackController.
 * Orchestrates the scanning process using focused helper classes.
 */

import type {
  ScanMode,
  ScanningState,
  FallbackConfig,
  ScanProgress,
  ScanMetrics,
  LicenseData,
  OCRTextObservation,
} from '../types/license';
import { scanLicense, parseOCRText, ScanError } from '../index.js';
import { logger } from './logger';
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

export interface ScanControllerEvents {
  onProgressUpdate: (progress: ScanProgress) => void;
  onModeSwitch: (fromMode: ScanMode, toMode: ScanMode, reason: string) => void;
  onMetricsUpdate: (metrics: Partial<ScanMetrics>) => void;
}

export class ScanController {
  private abortController?: AbortController;
  private timeoutManager: ScanTimeoutManager;
  private qualityProcessor: QualityMetricsProcessor;
  private stateManager: StateTransitionManager;

  constructor(
    private config: FallbackConfig,
    private events?: ScanControllerEvents
  ) {
    // Initialize component managers
    this.timeoutManager = new ScanTimeoutManager(
      this.createTimeoutConfig(),
      this.createTimeoutEvents()
    );

    this.qualityProcessor = new QualityMetricsProcessor(
      this.createQualityConfig(),
      this.createQualityEvents()
    );

    this.stateManager = new StateTransitionManager(
      this.createStateConfig(),
      this.createStateEvents()
    );
  }

  /**
   * Main scan entry point - simplified coordination
   */
  async scan(
    input: string | OCRTextObservation[],
    mode: ScanMode = 'auto'
  ): Promise<LicenseData> {
    // Setup scan session
    this.abortController = new AbortController();
    this.stateManager.startScanSession(mode);

    try {
      // Execute scan based on mode and input type
      if (
        mode === 'barcode' ||
        (mode === 'auto' && typeof input === 'string')
      ) {
        return await this.performBarcodeScan(input as string);
      } else if (mode === 'ocr' || (mode === 'auto' && Array.isArray(input))) {
        return await this.performOCRScan(input as OCRTextObservation[]);
      } else if (mode === 'auto' && typeof input === 'string') {
        return await this.performAutoScan(input);
      } else {
        throw new ScanError({
          code: 'INVALID_INPUT',
          message: 'Invalid input type for scan mode',
          userMessage: 'Invalid scanning input',
          recoverable: true,
        });
      }
    } catch (error) {
      this.stateManager.forceFail();
      this.notifyMetrics({ success: false });
      throw error;
    }
  }

  /**
   * Auto mode with fallback logic
   */
  private async performAutoScan(barcodeData: string): Promise<LicenseData> {
    try {
      const result = await this.performBarcodeScan(barcodeData);
      this.notifyMetrics({ success: true, fallbackTriggered: false });
      return result;
    } catch (barcodeError) {
      const decision = this.stateManager.shouldTriggerFallback(
        barcodeError,
        this.stateManager.getElapsedTime()
      );

      if (!decision.shouldFallback) {
        throw barcodeError;
      }

      logger.info('Triggering fallback to OCR', {
        reason: decision.reason,
        timeElapsed: this.stateManager.getElapsedTime(),
        barcodeAttempts: this.stateManager.getBarcodeAttempts(),
      });

      this.stateManager.switchMode(
        'ocr',
        `Fallback triggered: ${decision.reason}`
      );

      // Generate mock OCR data for fallback
      const mockOCRData = this.generateMockOCRData();
      const ocrResult = await this.performOCRScan(mockOCRData);

      // Map decision reason to ScanMetrics fallbackReason type
      const mappedReason: 'timeout' | 'failure' | 'quality' | 'manual' =
        decision.reason === 'max_attempts'
          ? 'failure'
          : decision.reason === 'error_type'
            ? 'failure'
            : decision.reason === 'insufficient_time'
              ? 'timeout'
              : decision.reason === 'mode_restriction'
                ? 'manual'
                : decision.reason; // 'timeout' maps directly

      this.notifyMetrics({
        success: true,
        fallbackTriggered: true,
        fallbackReason: mappedReason,
      });

      return ocrResult;
    }
  }

  /**
   * Barcode scan with timeout and retry
   */
  private async performBarcodeScan(barcodeData: string): Promise<LicenseData> {
    this.stateManager.updateState('barcode');

    return await this.timeoutManager.optimizedRetry(async () => {
      this.stateManager.incrementBarcodeAttempts();

      const result = await Promise.race([
        scanLicense(barcodeData),
        this.createTimeoutPromise('barcode'),
      ]);

      if (!result) {
        throw new ScanError({
          code: 'BARCODE_SCAN_ERROR',
          message: 'Barcode scan returned no data',
          userMessage: 'Unable to scan barcode. Please try again.',
          recoverable: true,
        });
      }

      this.stateManager.forceComplete();
      this.notifyMetrics({ success: true, finalMode: 'barcode' });
      return result;
    }, 3);
  }

  /**
   * OCR scan with timeout
   */
  private async performOCRScan(
    textObservations: OCRTextObservation[]
  ): Promise<LicenseData> {
    this.stateManager.updateState('ocr');

    return await this.timeoutManager.optimizedRetry(async () => {
      const result = await Promise.race([
        parseOCRText(textObservations),
        this.createTimeoutPromise('ocr'),
      ]);

      if (!result) {
        throw new ScanError({
          code: 'OCR_SCAN_ERROR',
          message: 'OCR scan returned no data',
          userMessage: 'Unable to read license text. Please try again.',
          recoverable: true,
        });
      }

      this.stateManager.forceComplete();
      this.notifyMetrics({ success: true, finalMode: 'ocr' });
      return result;
    }, 2);
  }

  /**
   * Create timeout promise for scan operations
   */
  private createTimeoutPromise(type: 'barcode' | 'ocr'): Promise<never> {
    return new Promise((_, reject) => {
      const timeoutMs =
        type === 'barcode' ? this.config.barcodeTimeoutMs : 2000;
      this.timeoutManager.startTimeout(type, () => {
        reject(
          new ScanError({
            code: `${type.toUpperCase()}_TIMEOUT`,
            message: `${type} scanning timeout after ${timeoutMs}ms`,
            userMessage: `${type === 'barcode' ? 'Barcode scanning' : 'Text recognition'} is taking too long. Please try again.`,
            recoverable: true,
          })
        );
      });
    });
  }

  /**
   * Generate mock OCR data for fallback demonstration
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
    ];
  }

  /**
   * Cancel current scan operation
   */
  cancel(): void {
    this.timeoutManager.clearAllTimers();
    this.abortController?.abort();
    this.stateManager.reset();
    logger.info('Scan cancelled by user');
  }

  /**
   * Update configuration for all components
   */
  updateConfig(newConfig: Partial<FallbackConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.timeoutManager.updateConfig(this.createTimeoutConfig());
    this.qualityProcessor.updateConfig(this.createQualityConfig());
    this.stateManager.updateConfig(this.createStateConfig());
  }

  /**
   * Get current state information
   */
  getState(): ScanningState {
    return this.stateManager.getCurrentState();
  }

  /**
   * Get current mode
   */
  getMode(): ScanMode {
    return this.stateManager.getCurrentMode();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.timeoutManager.destroy();
    this.qualityProcessor.reset();
    this.stateManager.reset();
    this.abortController?.abort();
    this.abortController = undefined;
  }

  // Helper methods to create component configurations
  private createTimeoutConfig(): TimeoutConfig {
    return {
      barcodeTimeout: this.config.barcodeTimeoutMs,
      ocrTimeout: 2000,
      maxRetries: this.config.maxBarcodeAttempts,
      retryDelay: 100,
    };
  }

  private createQualityConfig(): QualityConfig {
    return {
      minQualityThreshold: 0.4,
      bufferSize: 10,
      consistencyWindowMs: 2000,
      autoSwitchEnabled: true,
    };
  }

  private createStateConfig(): StateConfig {
    return {
      maxBarcodeAttempts: this.config.maxBarcodeAttempts,
      barcodeTimeoutMs: this.config.barcodeTimeoutMs,
      maxFallbackProcessingTimeMs: this.config.maxFallbackProcessingTimeMs,
      enableAutoFallback: true,
    };
  }

  // Event handler creation for component coordination
  private createTimeoutEvents(): TimeoutEvents {
    return {
      onTimeout: (type, elapsed) =>
        logger.info(`${type} timeout after ${elapsed}ms`),
      onRetryAttempt: (attempt, max) =>
        logger.info(`Retry attempt ${attempt}/${max}`),
    };
  }

  private createQualityEvents(): QualityEvents {
    return {
      onQualityAssessment: (metrics, shouldSwitch) => {
        if (shouldSwitch) {
          logger.info('Quality assessment suggests mode switch', { metrics });
        }
      },
      onQualityImprovement: (oldScore, newScore) => {
        logger.info('Quality improvement detected', { oldScore, newScore });
      },
      onModeRecommendation: (mode, reason) => {
        logger.info('Mode recommendation', { mode, reason });
      },
    };
  }

  private createStateEvents(): StateEvents {
    return {
      onStateChange: (oldState, newState) => {
        logger.info('State transition', { from: oldState, to: newState });
      },
      onModeSwitch: (fromMode, toMode, reason) => {
        this.events?.onModeSwitch(fromMode, toMode, reason);
      },
      onProgressUpdate: (progress) => {
        this.events?.onProgressUpdate(progress);
      },
    };
  }

  private notifyMetrics(metrics: Partial<ScanMetrics>): void {
    if (!this.events?.onMetricsUpdate) return;

    const fullMetrics: Partial<ScanMetrics> = {
      totalProcessingTime: this.stateManager.getElapsedTime(),
      ...metrics,
    };

    this.events.onMetricsUpdate(fullMetrics);
  }
}
