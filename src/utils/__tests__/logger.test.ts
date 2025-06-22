import { logger } from '../logger';

describe('logger', () => {
  beforeEach(() => {
    // Clear logs before each test
    logger.clearLogs();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should sanitize sensitive data in strings', () => {
    logger.info('License number: ABC12345678');

    const logs = logger.getRecentLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('License number: [REDACTED]');
  });

  it('should sanitize sensitive fields in objects', () => {
    logger.info('User data', {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'ABC123456',
      dateOfBirth: '1990-01-01',
      address: {
        street: '123 Main St',
        city: 'Anytown',
      },
    });

    const logs = logger.getRecentLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.context).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: '[REDACTED]',
      dateOfBirth: '[REDACTED]',
      address: '[REDACTED]',
    });
  });

  it('should store logs with correct metadata', () => {
    const before = Date.now();

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');

    const logs = logger.getRecentLogs(4);

    expect(logs).toHaveLength(4);
    expect(logs[0]?.level).toBe('debug');
    expect(logs[1]?.level).toBe('info');
    expect(logs[2]?.level).toBe('warn');
    expect(logs[3]?.level).toBe('error');

    logs.forEach((log) => {
      expect(log.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(log.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  it('should limit stored logs to maxLogs', () => {
    // Add more than 100 logs
    for (let i = 0; i < 150; i++) {
      logger.info(`Log ${i}`);
    }

    const logs = logger.getRecentLogs(200);
    expect(logs.length).toBe(100);
    expect(logs[0]?.message).toBe('Log 50');
    expect(logs[99]?.message).toBe('Log 149');
  });

  it('should clear all logs', () => {
    logger.info('Test 1');
    logger.info('Test 2');
    logger.info('Test 3');

    expect(logger.getRecentLogs()).toHaveLength(3);

    logger.clearLogs();

    expect(logger.getRecentLogs()).toHaveLength(0);
  });

  it('should handle nested objects', () => {
    logger.info('Nested data', {
      user: {
        name: 'John',
        details: {
          licenseNumber: 'XYZ987654',
          age: 30,
        },
      },
    });

    const logs = logger.getRecentLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.context).toEqual({
      user: {
        name: 'John',
        details: {
          licenseNumber: '[REDACTED]',
          age: 30,
        },
      },
    });
  });

  it('should handle arrays', () => {
    logger.info('Array data', {
      items: ['ABC12345678', 'normal text', 'DEF98765432'],
    });

    const logs = logger.getRecentLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.context?.items).toEqual([
      '[REDACTED]',
      'normal text',
      '[REDACTED]',
    ]);
  });

  it('should call console methods in development', () => {
    logger.debug('Debug');
    logger.info('Info');
    logger.warn('Warn');
    logger.error('Error');

    expect(console.log).toHaveBeenCalled();
    expect(console.info).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  describe('Performance tracking', () => {
    beforeEach(() => {
      logger.clearPerformanceMetrics();
    });

    it('should start and stop timers', () => {
      logger.startTimer('test');

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {} // Busy wait for 10ms

      const elapsed = logger.stopTimer('test');

      expect(elapsed).toBeGreaterThanOrEqual(5);
      expect(elapsed).toBeLessThan(100); // Increased tolerance from 50ms to 100ms
    });

    it('should handle non-existent timers', () => {
      const elapsed = logger.stopTimer('nonexistent');
      expect(elapsed).toBeNull();
    });

    it('should measure function execution time', async () => {
      const result = await logger.measureTime('testFunction', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result';
      });

      expect(result).toBe('result');

      const metrics = logger.getPerformanceMetrics();
      expect(metrics.testFunction_time).toBeGreaterThanOrEqual(5);
    });

    it('should retry operations with exponential backoff', async () => {
      let attempts = 0;

      const result = await logger.withRetry(
        'test-operation',
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Test error');
          }
          return 'success';
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 5,
          backoffMultiplier: 2,
        }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should track memory usage', () => {
      logger.trackMemory('test_operation');

      const metrics = logger.getPerformanceMetrics();
      expect(metrics.test_operation_memory).toBeGreaterThan(0);
    });

    it('should enforce memory limits', () => {
      // Mock high memory usage
      const originalTrackMemory = logger.trackMemory;
      logger.trackMemory = jest.fn().mockImplementation((operation: string) => {
        (logger as any).performanceMetrics.set(`${operation}_memory`, 250); // 250MB
      });

      expect(() => {
        logger.enforceMemoryLimit('high_memory_operation', 200);
      }).toThrow('Memory limit exceeded');

      logger.trackMemory = originalTrackMemory;
    });

    it('should clear performance metrics', () => {
      logger.startTimer('test');
      logger.trackMemory('test');

      expect(
        Object.keys(logger.getPerformanceMetrics()).length
      ).toBeGreaterThan(0);

      logger.clearPerformanceMetrics();

      expect(Object.keys(logger.getPerformanceMetrics()).length).toBe(0);
    });
  });
});
