/**
 * T03_S08: E2E Test Global Type Declarations
 * TypeScript declarations for global test utilities and data
 */

// Type imports only - not used in declaration file

declare global {
  // Test utilities available globally in E2E tests
  const TestUtils: {
    navigateToScanner(): Promise<void>;
    simulateBarcodeScan(barcodeData: string): Promise<void>;
    waitForScanResult(timeout?: number): Promise<void>;
    takeTestScreenshot(name: string): Promise<void>;
    checkElementExists(elementId: string, shouldExist?: boolean): Promise<void>;
    typeText(elementId: string, text: string): Promise<void>;
    clearAndType(elementId: string, text: string): Promise<void>;
  };

  // Test data available globally in E2E tests
  const TestData: {
    validBarcodes: {
      california: string;
      texas: string;
      newYork: string;
    };
    invalidBarcodes: {
      malformed: string;
      wrongFormat: string;
      corrupted: string;
    };
    expectedResults: {
      california: {
        firstName: string;
        lastName: string;
        licenseNumber: string;
        dateOfBirth: string;
      };
      texas: {
        firstName: string;
        lastName: string;
        licenseNumber: string;
        dateOfBirth: string;
      };
    };
    timeouts: {
      scanTimeout: number;
      ocrFallback: number;
      processing: number;
      navigation: number;
    };
  };
}

export {};
