/**
 * Mock for ScanController
 * Provides a test-friendly implementation with spy capabilities
 */

export const mockScanController = {
  scanWithMode: jest.fn().mockResolvedValue({
    issuingCountry: 'US',
    firstName: 'John',
    lastName: 'Doe',
    licenseNumber: '123456789',
  }),
  attemptBarcodeScan: jest.fn().mockResolvedValue(null),
  attemptOCRScan: jest.fn().mockResolvedValue(null),
  getProgress: jest.fn().mockReturnValue({
    mode: 'auto',
    state: 'idle',
    elapsed: 0,
    attempts: 0,
  }),
  getMetrics: jest.fn().mockReturnValue({
    totalAttempts: 0,
    barcodeAttempts: 0,
    ocrAttempts: 0,
    averageQuality: 0,
    switchCount: 0,
  }),
  abort: jest.fn(),
  destroy: jest.fn(),
};

export class ScanController {
  private abortController?: AbortController;

  constructor(
    private config: any,
    private events?: any
  ) {
    Object.assign(this, mockScanController);
  }

  // Ensure all methods are available
  scanWithMode = mockScanController.scanWithMode;
  attemptBarcodeScan = mockScanController.attemptBarcodeScan;
  attemptOCRScan = mockScanController.attemptOCRScan;
  getProgress = mockScanController.getProgress;
  getMetrics = mockScanController.getMetrics;
  abort = mockScanController.abort;
  destroy = mockScanController.destroy;
}
