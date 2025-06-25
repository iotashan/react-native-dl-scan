/**
 * QualityMetricsProcessor
 *
 * Extracted from FallbackController to handle quality assessment and buffering.
 * Responsible for processing quality metrics and determining scan readiness.
 */

import type {
  RealTimeQualityMetrics,
  QualityMetrics,
  ScanMode,
} from '../types/license';

export interface QualityConfig {
  minQualityThreshold: number;
  bufferSize: number;
  consistencyWindowMs: number;
  autoSwitchEnabled: boolean;
}

export interface QualityEvents {
  onQualityAssessment: (
    metrics: RealTimeQualityMetrics,
    shouldSwitch: boolean
  ) => void;
  onQualityImprovement: (oldScore: number, newScore: number) => void;
  onModeRecommendation: (recommendedMode: ScanMode, reason: string) => void;
}

interface QualityEntry {
  metrics: RealTimeQualityMetrics;
  timestamp: number;
  overallScore: number;
}

export class QualityMetricsProcessor {
  private qualityBuffer: QualityEntry[] = [];
  private lastAssessmentTime: number = 0;

  constructor(
    private config: QualityConfig,
    private events?: QualityEvents
  ) {}

  /**
   * Process incoming quality metrics and determine if mode switching is needed
   */
  processQualityMetrics(metrics: QualityMetrics): boolean;
  processQualityMetrics(metrics: RealTimeQualityMetrics): boolean;
  processQualityMetrics(
    metrics: QualityMetrics | RealTimeQualityMetrics
  ): boolean {
    // Convert simple QualityMetrics to RealTimeQualityMetrics if needed
    const realTimeMetrics = this.convertToRealTimeMetrics(metrics);
    const now = Date.now();
    const overallScore = this.calculateOverallScore(realTimeMetrics);

    // Add to buffer
    const entry: QualityEntry = {
      metrics: realTimeMetrics,
      timestamp: now,
      overallScore,
    };

    this.addToBuffer(entry);

    // Clean old entries
    this.cleanBuffer(now);

    // Determine if we should switch modes
    const shouldSwitch = this.shouldSwitchMode(realTimeMetrics, overallScore);

    // Emit assessment event
    this.events?.onQualityAssessment(realTimeMetrics, shouldSwitch);

    // Check for quality improvements
    this.checkQualityImprovement(overallScore);

    // Update last assessment time
    this.lastAssessmentTime = now;

    // Generate mode recommendations
    this.generateModeRecommendation(realTimeMetrics, overallScore);

    return shouldSwitch;
  }

  /**
   * Calculate overall quality score from individual metrics
   */
  private calculateOverallScore(metrics: RealTimeQualityMetrics): number {
    const weights = {
      blur: 0.3,
      lighting: 0.25,
      positioning: 0.25,
      contrast: 0.2,
    };

    let totalScore = 0;
    let totalWeight = 0;

    if (metrics.blur) {
      totalScore += (1 - metrics.blur.value) * weights.blur;
      totalWeight += weights.blur;
    }

    if (metrics.lighting) {
      totalScore += metrics.lighting.brightness * weights.lighting;
      totalWeight += weights.lighting;
    }

    if (metrics.positioning) {
      totalScore += metrics.positioning.documentDetected ? 0.8 : 0.2;
      totalScore += weights.positioning;
      totalWeight += weights.positioning;
    }

    // Note: contrast is not available in RealTimeQualityMetrics
    // If needed, can be calculated from other available metrics

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Determine if mode switching should occur based on quality
   */
  private shouldSwitchMode(
    metrics: RealTimeQualityMetrics,
    overallScore: number
  ): boolean {
    if (!this.config.autoSwitchEnabled) {
      return false;
    }

    // Poor quality consistently over time suggests mode switch needed
    if (overallScore < this.config.minQualityThreshold) {
      const recentEntries = this.getRecentEntries();
      const averageQuality =
        recentEntries.reduce((sum, entry) => sum + entry.overallScore, 0) /
        recentEntries.length;

      return averageQuality < this.config.minQualityThreshold;
    }

    // Specific conditions for barcode -> OCR fallback
    if (metrics.positioning && !metrics.positioning.documentDetected) {
      return true;
    }

    if (metrics.blur && metrics.blur.value > 0.7) {
      return true;
    }

    return false;
  }

  /**
   * Add entry to quality buffer with size management
   */
  private addToBuffer(entry: QualityEntry): void {
    this.qualityBuffer.push(entry);

    // Maintain buffer size
    if (this.qualityBuffer.length > this.config.bufferSize) {
      this.qualityBuffer.shift();
    }
  }

  /**
   * Remove entries older than consistency window
   */
  private cleanBuffer(currentTime: number): void {
    const cutoffTime = currentTime - this.config.consistencyWindowMs;
    this.qualityBuffer = this.qualityBuffer.filter(
      (entry) => entry.timestamp > cutoffTime
    );
  }

  /**
   * Get recent entries within consistency window
   */
  private getRecentEntries(): QualityEntry[] {
    const now = Date.now();
    const cutoffTime = now - this.config.consistencyWindowMs;
    return this.qualityBuffer.filter((entry) => entry.timestamp > cutoffTime);
  }

  /**
   * Check for quality improvements and emit events
   */
  private checkQualityImprovement(currentScore: number): void {
    if (this.qualityBuffer.length < 2) return;

    const previousEntry = this.qualityBuffer[this.qualityBuffer.length - 2];
    if (!previousEntry) return;

    const improvement = currentScore - previousEntry.overallScore;

    if (improvement > 0.1) {
      // Significant improvement threshold
      this.events?.onQualityImprovement(
        previousEntry.overallScore,
        currentScore
      );
    }
  }

  /**
   * Generate mode recommendations based on quality analysis
   */
  private generateModeRecommendation(
    metrics: RealTimeQualityMetrics,
    overallScore: number
  ): void {
    if (overallScore > 0.8) {
      this.events?.onModeRecommendation(
        'barcode',
        'High quality detected - barcode scanning optimal'
      );
    } else if (overallScore < 0.4) {
      this.events?.onModeRecommendation(
        'ocr',
        'Low quality detected - OCR mode recommended'
      );
    } else if (metrics.positioning && !metrics.positioning.documentDetected) {
      this.events?.onModeRecommendation(
        'ocr',
        'Document not properly positioned for barcode'
      );
    }
  }

  /**
   * Get current average quality over recent window
   */
  getAverageQuality(): number {
    const recentEntries = this.getRecentEntries();
    if (recentEntries.length === 0) return 0;

    return (
      recentEntries.reduce((sum, entry) => sum + entry.overallScore, 0) /
      recentEntries.length
    );
  }

  /**
   * Get quality trend (improving/declining)
   */
  getQualityTrend(): 'improving' | 'declining' | 'stable' {
    const recentEntries = this.getRecentEntries();
    if (recentEntries.length < 3) return 'stable';

    const first = recentEntries[0]?.overallScore || 0;
    const last = recentEntries[recentEntries.length - 1]?.overallScore || 0;
    const diff = last - first;

    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }

  /**
   * Convert simple QualityMetrics to RealTimeQualityMetrics
   */
  private convertToRealTimeMetrics(
    metrics: QualityMetrics | RealTimeQualityMetrics
  ): RealTimeQualityMetrics {
    // If already RealTimeQualityMetrics, return as-is
    if (
      'blur' in metrics &&
      typeof metrics.blur === 'object' &&
      'value' in metrics.blur
    ) {
      return metrics as RealTimeQualityMetrics;
    }

    // Convert simple QualityMetrics to RealTimeQualityMetrics
    const simple = metrics as QualityMetrics;
    return {
      blur: {
        value: simple.blur,
        status:
          simple.blur < 0.3 ? 'good' : simple.blur < 0.6 ? 'warning' : 'poor',
      },
      lighting: {
        brightness: simple.brightness,
        uniformity: 0.8, // Default reasonable value
        status:
          simple.brightness > 0.3 && simple.brightness < 0.8
            ? 'good'
            : simple.brightness >= 0.2 && simple.brightness <= 0.9
              ? 'warning'
              : 'poor',
      },
      positioning: {
        documentDetected: simple.documentAlignment > 0.5,
        alignment: simple.documentAlignment,
        distance:
          simple.documentAlignment > 0.8
            ? 'optimal'
            : simple.documentAlignment > 0.5
              ? 'optimal'
              : 'too_far',
        status:
          simple.documentAlignment > 0.7
            ? 'good'
            : simple.documentAlignment > 0.4
              ? 'warning'
              : 'poor',
      },
      overall: {
        score:
          (simple.brightness +
            (1 - simple.blur) +
            (1 - simple.glare) +
            simple.documentAlignment) /
          4,
        readyToScan:
          simple.blur < 0.5 &&
          simple.glare < 0.5 &&
          simple.documentAlignment > 0.5,
      },
    };
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this.qualityBuffer = [];
    this.lastAssessmentTime = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<QualityConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get time since last assessment
   */
  getTimeSinceLastAssessment(): number {
    return this.lastAssessmentTime > 0
      ? Date.now() - this.lastAssessmentTime
      : 0;
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.qualityBuffer.length;
  }
}
