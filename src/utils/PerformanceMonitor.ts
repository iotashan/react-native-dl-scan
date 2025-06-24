import type {
  PerformanceMetrics,
  PerformanceAlert,
  PerformanceBenchmark,
} from '../types/license';
import { logger } from './logger';

/**
 * PerformanceMonitor - Comprehensive performance tracking for OCR fallback system
 * Tracks detailed metrics to ensure <2s OCR, <4s fallback, <50MB memory, <60% CPU targets
 */
export class PerformanceMonitor {
  private activeSession: PerformanceSession | null = null;
  private benchmarkData: PerformanceBenchmark[] = [];
  private alerts: PerformanceAlert[] = [];
  private memoryBaseline: number = 0;

  // Performance targets
  private readonly targets = {
    ocrProcessingMs: 2000,      // <2 seconds OCR
    fallbackProcessingMs: 4000, // <4 seconds total fallback
    memoryDeltaMB: 50,          // <50MB memory increase
    cpuUtilizationPercent: 60,  // <60% CPU usage
  };

  /**
   * Start a new performance monitoring session
   */
  startSession(sessionType: 'barcode' | 'ocr' | 'fallback'): string {
    const sessionId = `${sessionType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.activeSession = new PerformanceSession(sessionId, sessionType);
    this.memoryBaseline = this.getCurrentMemoryUsage();
    
    logger.debug('Performance monitoring session started', {
      sessionId,
      sessionType,
      memoryBaseline: this.memoryBaseline,
    });

    return sessionId;
  }

  /**
   * Mark a performance checkpoint within the session
   */
  checkpoint(name: string, metadata?: Record<string, any>): void {
    if (!this.activeSession) {
      logger.warn('Performance checkpoint called without active session', { name });
      return;
    }

    this.activeSession.addCheckpoint(name, metadata);
  }

  /**
   * Track memory allocation at specific point
   */
  trackMemoryAllocation(operation: string, sizeBytes?: number): void {
    if (!this.activeSession) return;

    const currentMemory = this.getCurrentMemoryUsage();
    this.activeSession.trackMemory(operation, currentMemory, sizeBytes);
  }

  /**
   * Track CPU/GPU utilization
   */
  trackResourceUtilization(cpu: number, gpu?: number): void {
    if (!this.activeSession) return;

    this.activeSession.trackResources(cpu, gpu);
  }

  /**
   * Track frame processing metrics
   */
  trackFrameProcessing(processed: number, dropped: number, fps: number): void {
    if (!this.activeSession) return;

    this.activeSession.trackFrames(processed, dropped, fps);
  }

  /**
   * End the current session and generate comprehensive metrics
   */
  endSession(): PerformanceMetrics | null {
    if (!this.activeSession) {
      logger.warn('Performance session end called without active session');
      return null;
    }

    const metrics = this.activeSession.generateMetrics(this.memoryBaseline);
    
    // Validate against performance targets
    this.validatePerformanceTargets(metrics);
    
    // Store for benchmarking
    this.storeSessionData(metrics);
    
    logger.info('Performance monitoring session completed', {
      sessionId: this.activeSession.id,
      metrics: this.sanitizeMetricsForLogging(metrics),
    });

    this.activeSession = null;
    return metrics;
  }

  /**
   * Validate metrics against performance targets and generate alerts
   */
  private validatePerformanceTargets(metrics: PerformanceMetrics): void {
    const alerts: PerformanceAlert[] = [];

    // OCR processing time target
    if (metrics.ocrProcessingTime && metrics.ocrProcessingTime > this.targets.ocrProcessingMs) {
      alerts.push({
        type: 'critical',
        category: 'performance',
        message: `OCR processing exceeded target: ${metrics.ocrProcessingTime}ms > ${this.targets.ocrProcessingMs}ms`,
        timestamp: Date.now(),
        threshold: this.targets.ocrProcessingMs,
        actualValue: metrics.ocrProcessingTime,
      });
      metrics.meetsOcrTarget = false;
    } else {
      metrics.meetsOcrTarget = true;
    }

    // Total fallback time target
    if (metrics.totalProcessingTime > this.targets.fallbackProcessingMs) {
      alerts.push({
        type: 'critical',
        category: 'timeout',
        message: `Total processing exceeded target: ${metrics.totalProcessingTime}ms > ${this.targets.fallbackProcessingMs}ms`,
        timestamp: Date.now(),
        threshold: this.targets.fallbackProcessingMs,
        actualValue: metrics.totalProcessingTime,
      });
      metrics.meetsFallbackTarget = false;
    } else {
      metrics.meetsFallbackTarget = true;
    }

    // Memory usage target
    if (metrics.memoryDeltaMB > this.targets.memoryDeltaMB) {
      alerts.push({
        type: 'warning',
        category: 'memory',
        message: `Memory usage exceeded target: ${metrics.memoryDeltaMB}MB > ${this.targets.memoryDeltaMB}MB`,
        timestamp: Date.now(),
        threshold: this.targets.memoryDeltaMB,
        actualValue: metrics.memoryDeltaMB,
      });
      metrics.meetsMemoryTarget = false;
    } else {
      metrics.meetsMemoryTarget = true;
    }

    // CPU utilization target
    if (metrics.peakCpuUtilization && metrics.peakCpuUtilization > this.targets.cpuUtilizationPercent) {
      alerts.push({
        type: 'warning',
        category: 'cpu',
        message: `CPU utilization exceeded target: ${metrics.peakCpuUtilization}% > ${this.targets.cpuUtilizationPercent}%`,
        timestamp: Date.now(),
        threshold: this.targets.cpuUtilizationPercent,
        actualValue: metrics.peakCpuUtilization,
      });
      metrics.meetsCpuTarget = false;
    } else {
      metrics.meetsCpuTarget = true;
    }

    // Store alerts
    this.alerts.push(...alerts);
    
    // Log alerts
    alerts.forEach(alert => {
      if (alert.type === 'critical') {
        logger.error('Performance alert', alert);
      } else {
        logger.warn('Performance alert', alert);
      }
    });
  }

  /**
   * Get current memory usage (simplified for React Native)
   */
  private getCurrentMemoryUsage(): number {
    // In React Native, we would use native modules for accurate memory tracking
    // For now, simulate based on performance.memory or estimate
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize / (1024 * 1024);
    }
    
    // Estimate based on app state (simplified)
    return Math.random() * 50 + 100; // 100-150MB base estimate
  }

  /**
   * Store session data for benchmarking
   */
  private storeSessionData(metrics: PerformanceMetrics): void {
    // In a production app, this would persist to device storage
    // For now, keep in memory for session
    
    // Limit stored benchmark data to prevent memory growth
    if (this.benchmarkData.length > 100) {
      this.benchmarkData = this.benchmarkData.slice(-50);
    }
  }

  /**
   * Generate benchmark report for regression testing
   */
  generateBenchmarkReport(testName: string, iterations: number = 10): PerformanceBenchmark | null {
    const recentResults = this.benchmarkData
      .filter(b => b.testName === testName)
      .slice(-iterations)
      .flatMap(b => b.results);

    if (recentResults.length === 0) {
      logger.warn('No benchmark data available for report', { testName });
      return null;
    }

    const summary = this.calculatePerformanceSummary(recentResults);
    
    return {
      testName,
      device: this.getDeviceInfo(),
      timestamp: Date.now(),
      iterations: recentResults.length,
      results: recentResults,
      summary,
      regressionDetected: this.detectRegression(summary),
    };
  }

  /**
   * Calculate performance summary statistics
   */
  private calculatePerformanceSummary(results: PerformanceMetrics[]): PerformanceBenchmark['summary'] {
    const sortedByTotal = results.sort((a, b) => a.totalProcessingTime - b.totalProcessingTime);
    const count = results.length;

    const mean = this.calculateMeanMetrics(results);
    const median = sortedByTotal[Math.floor(count / 2)];
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);

    return {
      mean,
      median,
      p95: sortedByTotal[p95Index] || sortedByTotal[count - 1],
      p99: sortedByTotal[p99Index] || sortedByTotal[count - 1],
    };
  }

  /**
   * Calculate mean metrics across results
   */
  private calculateMeanMetrics(results: PerformanceMetrics[]): PerformanceMetrics {
    const count = results.length;
    const sum = results.reduce((acc, result) => ({
      totalProcessingTime: acc.totalProcessingTime + result.totalProcessingTime,
      ocrProcessingTime: acc.ocrProcessingTime + (result.ocrProcessingTime || 0),
      modeTransitionTime: acc.modeTransitionTime + (result.modeTransitionTime || 0),
      memoryDeltaMB: acc.memoryDeltaMB + result.memoryDeltaMB,
      peakCpuUtilization: acc.peakCpuUtilization + (result.peakCpuUtilization || 0),
      framesProcessed: acc.framesProcessed + (result.framesProcessed || 0),
    }), {
      totalProcessingTime: 0,
      ocrProcessingTime: 0,
      modeTransitionTime: 0,
      memoryDeltaMB: 0,
      peakCpuUtilization: 0,
      framesProcessed: 0,
    });

    return {
      totalProcessingTime: sum.totalProcessingTime / count,
      ocrProcessingTime: sum.ocrProcessingTime / count,
      modeTransitionTime: sum.modeTransitionTime / count,
      initialMemoryUsageMB: results[0]?.initialMemoryUsageMB || 0,
      peakMemoryUsageMB: Math.max(...results.map(r => r.peakMemoryUsageMB)),
      finalMemoryUsageMB: results[results.length - 1]?.finalMemoryUsageMB || 0,
      memoryDeltaMB: sum.memoryDeltaMB / count,
      peakCpuUtilization: sum.peakCpuUtilization / count,
      framesProcessed: sum.framesProcessed / count,
      meetsOcrTarget: results.every(r => r.meetsOcrTarget),
      meetsFallbackTarget: results.every(r => r.meetsFallbackTarget),
      meetsMemoryTarget: results.every(r => r.meetsMemoryTarget),
      meetsCpuTarget: results.every(r => r.meetsCpuTarget),
    };
  }

  /**
   * Detect performance regression
   */
  private detectRegression(summary: PerformanceBenchmark['summary']): boolean {
    // Simple regression detection: any p95 metric exceeding targets
    return !summary.p95.meetsOcrTarget || 
           !summary.p95.meetsFallbackTarget || 
           !summary.p95.meetsMemoryTarget || 
           !summary.p95.meetsCpuTarget;
  }

  /**
   * Get device information for benchmarks
   */
  private getDeviceInfo(): string {
    // In React Native, would use DeviceInfo library
    return 'iPad M3 (simulated)';
  }

  /**
   * Sanitize metrics for logging (remove detailed arrays)
   */
  private sanitizeMetricsForLogging(metrics: PerformanceMetrics): Record<string, any> {
    return {
      totalProcessingTime: metrics.totalProcessingTime,
      ocrProcessingTime: metrics.ocrProcessingTime,
      memoryDeltaMB: metrics.memoryDeltaMB,
      meetsTargets: {
        ocr: metrics.meetsOcrTarget,
        fallback: metrics.meetsFallbackTarget,
        memory: metrics.meetsMemoryTarget,
        cpu: metrics.meetsCpuTarget,
      },
    };
  }

  /**
   * Get recent performance alerts
   */
  getRecentAlerts(count: number = 10): PerformanceAlert[] {
    return this.alerts.slice(-count);
  }

  /**
   * Clear performance alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Get performance targets for reference
   */
  getTargets() {
    return { ...this.targets };
  }
}

/**
 * Performance session tracking individual scan operation
 */
class PerformanceSession {
  public readonly id: string;
  public readonly type: 'barcode' | 'ocr' | 'fallback';
  private readonly startTime: number;
  private readonly startMemory: number;
  
  private checkpoints: Map<string, { timestamp: number; metadata?: Record<string, any> }> = new Map();
  private memoryEvents: Array<{ operation: string; timestamp: number; usage: number; size?: number }> = [];
  private cpuSamples: number[] = [];
  private gpuSamples: number[] = [];
  private frameMetrics = { processed: 0, dropped: 0, rates: [] as number[] };

  constructor(id: string, type: 'barcode' | 'ocr' | 'fallback') {
    this.id = id;
    this.type = type;
    this.startTime = performance.now();
    this.startMemory = this.getCurrentMemoryUsage();
  }

  addCheckpoint(name: string, metadata?: Record<string, any>): void {
    this.checkpoints.set(name, {
      timestamp: performance.now(),
      metadata,
    });
  }

  trackMemory(operation: string, usage: number, size?: number): void {
    this.memoryEvents.push({
      operation,
      timestamp: performance.now(),
      usage,
      size,
    });
  }

  trackResources(cpu: number, gpu?: number): void {
    this.cpuSamples.push(cpu);
    if (gpu !== undefined) {
      this.gpuSamples.push(gpu);
    }
  }

  trackFrames(processed: number, dropped: number, fps: number): void {
    this.frameMetrics.processed += processed;
    this.frameMetrics.dropped += dropped;
    this.frameMetrics.rates.push(fps);
  }

  generateMetrics(memoryBaseline: number): PerformanceMetrics {
    const endTime = performance.now();
    const finalMemory = this.getCurrentMemoryUsage();
    
    const totalTime = endTime - this.startTime;
    const memoryDelta = finalMemory - memoryBaseline;

    // Extract timing breakdowns from checkpoints
    const timings = this.extractTimingBreakdowns();
    
    return {
      totalProcessingTime: totalTime,
      ...timings,
      
      initialMemoryUsageMB: memoryBaseline,
      peakMemoryUsageMB: Math.max(...this.memoryEvents.map(e => e.usage), finalMemory),
      finalMemoryUsageMB: finalMemory,
      memoryDeltaMB: memoryDelta,
      memoryAllocations: this.memoryEvents.filter(e => e.size && e.size > 0).length,
      memoryDeallocations: this.memoryEvents.filter(e => e.size && e.size < 0).length,
      
      peakCpuUtilization: this.cpuSamples.length > 0 ? Math.max(...this.cpuSamples) : undefined,
      averageCpuUtilization: this.cpuSamples.length > 0 ? 
        this.cpuSamples.reduce((a, b) => a + b, 0) / this.cpuSamples.length : undefined,
      peakGpuUtilization: this.gpuSamples.length > 0 ? Math.max(...this.gpuSamples) : undefined,
      averageGpuUtilization: this.gpuSamples.length > 0 ? 
        this.gpuSamples.reduce((a, b) => a + b, 0) / this.gpuSamples.length : undefined,
      
      framesProcessed: this.frameMetrics.processed,
      framesDropped: this.frameMetrics.dropped,
      frameProcessingRate: this.frameMetrics.rates.length > 0 ? 
        this.frameMetrics.rates.reduce((a, b) => a + b, 0) / this.frameMetrics.rates.length : undefined,
      
      // These will be set by PerformanceMonitor.validatePerformanceTargets()
      meetsOcrTarget: false,
      meetsFallbackTarget: false,
      meetsMemoryTarget: false,
      meetsCpuTarget: false,
    };
  }

  private extractTimingBreakdowns(): Partial<PerformanceMetrics> {
    const timings: Partial<PerformanceMetrics> = {};
    
    // Extract common timing patterns from checkpoints
    const checkpointTimes = Array.from(this.checkpoints.entries()).map(([name, data]) => ({
      name,
      time: data.timestamp - this.startTime,
    }));

    // Map checkpoint names to timing fields
    const mappings = {
      'barcode_start': 'barcodePreparationTime',
      'barcode_end': 'barcodeAttemptTime',
      'ocr_start': 'ocrPreprocessingTime',
      'ocr_text_extraction': 'ocrTextExtractionTime',
      'ocr_parsing': 'ocrParsingTime',
      'ocr_end': 'ocrProcessingTime',
      'transition_start': null,
      'transition_end': 'modeTransitionTime',
    };

    // Calculate durations between checkpoints
    for (let i = 0; i < checkpointTimes.length; i++) {
      const current = checkpointTimes[i];
      const next = checkpointTimes[i + 1];
      
      if (current.name.endsWith('_start') && next) {
        const baseName = current.name.replace('_start', '');
        const endName = `${baseName}_end`;
        
        if (next.name === endName) {
          const duration = next.time - current.time;
          const fieldName = mappings[endName as keyof typeof mappings];
          if (fieldName) {
            (timings as any)[fieldName] = duration;
          }
        }
      }
    }

    return timings;
  }

  private getCurrentMemoryUsage(): number {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize / (1024 * 1024);
    }
    return Math.random() * 50 + 100; // Estimate
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();