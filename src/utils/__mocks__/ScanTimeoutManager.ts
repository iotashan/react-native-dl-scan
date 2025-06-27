/**
 * Mock for ScanTimeoutManager
 * Provides a test-friendly implementation with spy capabilities
 */

export const mockScanTimeoutManager = {
  startTimeout: jest.fn((_type: 'barcode' | 'ocr', _onTimeout: () => void) => {
    const timer = setTimeout(() => {}, 10000);
    return timer;
  }),
  clearTimeout: jest.fn(),
  shouldTriggerFallback: jest.fn().mockReturnValue(false),
  shouldRetry: jest.fn().mockReturnValue(false),
  startRetryTimer: jest.fn().mockResolvedValue(undefined),
  resetRetryCount: jest.fn(),
  cleanup: jest.fn(),
  clearAllTimers: jest.fn(),
  getElapsedTime: jest.fn().mockReturnValue(0),
};

export class ScanTimeoutManager {
  private activeTimers = new Set<NodeJS.Timeout>();

  constructor(
    private config: any,
    private events?: any
  ) {
    Object.assign(this, mockScanTimeoutManager);
  }

  // Ensure all methods are available
  startTimeout = mockScanTimeoutManager.startTimeout;
  clearTimeout = mockScanTimeoutManager.clearTimeout;
  shouldTriggerFallback = mockScanTimeoutManager.shouldTriggerFallback;
  shouldRetry = mockScanTimeoutManager.shouldRetry;
  startRetryTimer = mockScanTimeoutManager.startRetryTimer;
  resetRetryCount = mockScanTimeoutManager.resetRetryCount;
  cleanup = mockScanTimeoutManager.cleanup;
  clearAllTimers = mockScanTimeoutManager.clearAllTimers;
  getElapsedTime = mockScanTimeoutManager.getElapsedTime;
}
