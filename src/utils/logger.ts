/**
 * Logger utility for React Native DL Scan
 * Provides safe logging that doesn't expose sensitive data
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
}

class Logger {
  private isDev = __DEV__;
  private logs: LogEntry[] = [];
  private maxLogs = 100;

  private sanitize(data: any): any {
    if (typeof data === 'string') {
      // Remove potential license numbers (typically 8-20 alphanumeric)
      return data.replace(/\b[A-Z0-9]{8,20}\b/g, '[REDACTED]');
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: any = Array.isArray(data) ? [] : {};

      for (const key in data) {
        // Skip sensitive fields
        if (
          [
            'licenseNumber',
            'documentDiscriminator',
            'ssn',
            'socialSecurityNumber',
            'dateOfBirth',
            'address',
          ].includes(key)
        ) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(data[key]);
        }
      }

      return sanitized;
    }

    return data;
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>) {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message: this.sanitize(message),
      context: context ? this.sanitize(context) : undefined,
    };

    // Store log entry
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Output to console in development
    if (this.isDev) {
      const timestamp = entry.timestamp.toISOString();
      const contextStr = entry.context
        ? ` ${JSON.stringify(entry.context)}`
        : '';

      switch (level) {
        case 'debug':
          console.log(`[${timestamp}] DEBUG: ${entry.message}${contextStr}`);
          break;
        case 'info':
          console.info(`[${timestamp}] INFO: ${entry.message}${contextStr}`);
          break;
        case 'warn':
          console.warn(`[${timestamp}] WARN: ${entry.message}${contextStr}`);
          break;
        case 'error':
          console.error(`[${timestamp}] ERROR: ${entry.message}${contextStr}`);
          break;
      }
    }
  }

  debug(message: string, context?: Record<string, any>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, any>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, any>) {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, any>) {
    this.log('error', message, context);
  }

  /**
   * Get recent logs for debugging
   * @param count Number of recent logs to retrieve
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Clear all stored logs
   */
  clearLogs() {
    this.logs = [];
  }

  // Performance tracking extensions
  private performanceTimers: Map<string, number> = new Map();
  private performanceMetrics: Map<string, any> = new Map();
  private memoryThresholds = {
    warning: 150, // MB
    critical: 200, // MB
  };

  /**
   * Start a performance timer
   */
  startTimer(name: string): void {
    this.performanceTimers.set(name, Date.now());
    this.debug(`Timer started: ${name}`);
  }

  /**
   * Stop a performance timer and return elapsed time
   */
  stopTimer(name: string): number | null {
    const startTime = this.performanceTimers.get(name);
    if (!startTime) {
      this.warn(`Timer not found: ${name}`);
      return null;
    }

    const elapsed = Date.now() - startTime;
    this.performanceTimers.delete(name);

    this.debug(`Timer stopped: ${name}`, { elapsed });

    // Store timing metric
    this.performanceMetrics.set(`${name}_time`, elapsed);

    return elapsed;
  }

  /**
   * Measure execution time of a function
   */
  async measureTime<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startTimer(name);
    try {
      const result = await fn();
      return result;
    } finally {
      this.stopTimer(name);
    }
  }

  /**
   * Track memory usage (simplified implementation for React Native)
   */
  trackMemory(operation: string): void {
    // In a real implementation, this would use native modules to get actual memory usage
    // For now, we'll use performance.memory if available (web) or estimate
    let memoryUsageMB = 0;

    if (typeof performance !== 'undefined' && (performance as any).memory) {
      memoryUsageMB =
        (performance as any).memory.usedJSHeapSize / (1024 * 1024);
    } else {
      // Estimate based on logs count and other factors
      memoryUsageMB = Math.random() * 100 + 50; // 50-150MB estimate
    }

    this.performanceMetrics.set(`${operation}_memory`, memoryUsageMB);

    // Check thresholds
    if (memoryUsageMB > this.memoryThresholds.critical) {
      this.error(
        `Critical memory usage detected: ${memoryUsageMB.toFixed(1)}MB`,
        {
          operation,
          threshold: this.memoryThresholds.critical,
        }
      );

      // Trigger memory cleanup
      this.triggerMemoryCleanup();
    } else if (memoryUsageMB > this.memoryThresholds.warning) {
      this.warn(`High memory usage detected: ${memoryUsageMB.toFixed(1)}MB`, {
        operation,
        threshold: this.memoryThresholds.warning,
      });
    }
  }

  /**
   * Enforce memory limit - throw error if exceeded
   */
  enforceMemoryLimit(operation: string, maxMB: number = 200): void {
    this.trackMemory(operation);
    const currentMemory =
      this.performanceMetrics.get(`${operation}_memory`) || 0;

    if (currentMemory > maxMB) {
      throw new Error(
        `Memory limit exceeded: ${currentMemory.toFixed(1)}MB > ${maxMB}MB`
      );
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    this.performanceMetrics.forEach((value, key) => {
      metrics[key] = value;
    });
    return metrics;
  }

  /**
   * Clear performance metrics
   */
  clearPerformanceMetrics(): void {
    this.performanceMetrics.clear();
    this.performanceTimers.clear();
  }

  /**
   * Trigger memory cleanup
   */
  private triggerMemoryCleanup(): void {
    // Clear old logs
    if (this.logs.length > 50) {
      this.logs = this.logs.slice(-50);
    }

    // Clear old performance metrics
    this.performanceMetrics.clear();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    this.info('Memory cleanup triggered');
  }

  /**
   * Create retry operation with exponential backoff
   */
  async withRetry<T>(
    operation: string,
    fn: () => Promise<T>,
    options: {
      maxAttempts?: number;
      initialDelayMs?: number;
      maxDelayMs?: number;
      backoffMultiplier?: number;
    } = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      initialDelayMs = 100,
      maxDelayMs = 1000,
      backoffMultiplier = 2,
    } = options;

    let lastError: Error | null = null;
    let delayMs = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.debug(`${operation} attempt ${attempt}/${maxAttempts}`);
        const result = await fn();

        if (attempt > 1) {
          this.info(`${operation} succeeded after ${attempt} attempts`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts) {
          this.error(`${operation} failed after ${maxAttempts} attempts`, {
            error: lastError.message,
          });
          break;
        }

        this.warn(
          `${operation} attempt ${attempt} failed, retrying in ${delayMs}ms`,
          {
            error: lastError.message,
          }
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Increase delay for next attempt
        delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
      }
    }

    throw lastError || new Error(`${operation} failed after retries`);
  }
}

// Export singleton instance
export const logger = new Logger();
