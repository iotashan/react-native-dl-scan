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
}

// Export singleton instance
export const logger = new Logger();
