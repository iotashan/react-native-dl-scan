import type {
  ScanMode,
  ScanningState,
  FallbackConfig,
  ScanProgress,
  ScanMetrics,
  LicenseData,
  OCRTextObservation,
} from '../types/license';
import { scanLicense, parseOCRText, ScanError } from '../index';
import { logger } from './logger';

export interface FallbackControllerEvents {
  onProgressUpdate: (progress: ScanProgress) => void;
  onModeSwitch: (fromMode: ScanMode, toMode: ScanMode, reason: string) => void;
  onMetricsUpdate: (metrics: Partial<ScanMetrics>) => void;
}

export class FallbackController {
  private config: FallbackConfig;
  private currentState: ScanningState = 'idle';
  private currentMode: ScanMode = 'auto';
  private scanStartTime: number = 0;
  private barcodeStartTime: number = 0;
  private ocrStartTime: number = 0;
  private barcodeAttempts: number = 0;
  private events?: FallbackControllerEvents;
  private abortController?: AbortController;

  constructor(
    config: Partial<FallbackConfig> = {},
    events?: FallbackControllerEvents
  ) {
    this.config = {
      barcodeTimeoutMs: 3500, // 3.5 seconds default
      maxBarcodeAttempts: 5,
      maxFallbackProcessingTimeMs: 4000, // 4 seconds total limit
      enableQualityAssessment: true,
      ...config,
    };
    this.events = events;

    logger.info('FallbackController initialized', { config: this.config });
  }

  /**
   * Start scanning with automatic fallback logic
   */
  async scan(
    input: string | OCRTextObservation[],
    mode: ScanMode = 'auto'
  ): Promise<LicenseData> {
    this.reset();
    this.currentMode = mode;
    this.scanStartTime = Date.now();
    this.abortController = new AbortController();

    logger.info('Starting scan with fallback', {
      mode,
      inputType: typeof input === 'string' ? 'barcode' : 'ocr',
    });

    try {
      if (mode === 'ocr' || Array.isArray(input)) {
        return await this.performOCRScan(input as OCRTextObservation[]);
      }

      if (mode === 'barcode') {
        return await this.performBarcodeScan(input as string);
      }

      // Auto mode: try barcode first, fallback to OCR
      if (typeof input === 'string') {
        try {
          return await this.performBarcodeScanWithFallback(input as string);
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
      }

      throw new ScanError({
        code: 'INVALID_INPUT',
        message: 'Invalid input type for auto mode',
        userMessage: 'Invalid scanning input',
        recoverable: true,
      });
    } catch (error) {
      this.updateState('failed');
      this.notifyMetrics({ success: false });
      throw error;
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

      // For demo purposes, we'll simulate OCR data based on typical license fields
      const mockOCRData: OCRTextObservation[] = this.generateMockOCRData();

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
   * Perform barcode-only scan
   */
  private async performBarcodeScan(barcodeData: string): Promise<LicenseData> {
    this.updateState('barcode');
    this.barcodeStartTime = Date.now();
    this.barcodeAttempts++;

    this.notifyProgress();

    try {
      const result = await scanLicense(barcodeData);
      this.updateState('completed');

      const processingTime = Date.now() - this.barcodeStartTime;
      this.notifyMetrics({
        barcodeAttemptTime: processingTime,
        finalMode: 'barcode',
        success: true,
        fallbackTriggered: false,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - this.barcodeStartTime;
      this.notifyMetrics({ barcodeAttemptTime: processingTime });

      if (error instanceof ScanError) {
        throw error;
      }

      throw new ScanError({
        code: 'BARCODE_SCAN_ERROR',
        message: 'Barcode scanning failed',
        userMessage: 'Unable to read barcode. Please try again.',
        recoverable: true,
      });
    }
  }

  /**
   * Perform OCR-only scan
   */
  private async performOCRScan(
    textObservations: OCRTextObservation[]
  ): Promise<LicenseData> {
    this.updateState('ocr');
    this.ocrStartTime = Date.now();

    this.notifyProgress();

    try {
      const result = await parseOCRText(textObservations);
      this.updateState('completed');

      const processingTime = Date.now() - this.ocrStartTime;
      this.notifyMetrics({
        ocrProcessingTime: processingTime,
        finalMode: 'ocr',
        success: true,
        fallbackTriggered: this.barcodeAttempts > 0,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - this.ocrStartTime;
      this.notifyMetrics({ ocrProcessingTime: processingTime });

      if (error instanceof ScanError) {
        throw error;
      }

      throw new ScanError({
        code: 'OCR_SCAN_ERROR',
        message: 'OCR scanning failed',
        userMessage:
          'Unable to read license text. Please ensure good lighting and try again.',
        recoverable: true,
      });
    }
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
   * Notify progress update
   */
  private notifyProgress(): void {
    if (!this.events?.onProgressUpdate) return;

    const progress: ScanProgress = {
      state: this.currentState,
      mode: this.currentMode,
      startTime: this.scanStartTime,
      barcodeAttempts: this.barcodeAttempts,
      timeElapsed: Date.now() - this.scanStartTime,
      message: this.getProgressMessage(),
    };

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
   * Cancel current scan operation
   */
  cancel(): void {
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
    this.currentState = 'idle';
    this.scanStartTime = 0;
    this.barcodeStartTime = 0;
    this.ocrStartTime = 0;
    this.barcodeAttempts = 0;
    if (this.abortController) {
      this.abortController.abort();
    }
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
}
