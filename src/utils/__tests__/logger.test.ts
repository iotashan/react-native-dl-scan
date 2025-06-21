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
});
