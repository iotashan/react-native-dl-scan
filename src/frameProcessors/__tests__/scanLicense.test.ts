// Mock react-native-vision-camera module
jest.mock('react-native-vision-camera');

interface MockFrame {
  width: number;
  height: number;
  pixelFormat: string;
}

interface MockPlugin {
  call: jest.MockedFunction<(frame: MockFrame, options?: any) => any>;
}

interface MockScanLicense {
  (frame: MockFrame, options?: any): any;
}

describe('scanLicense frame processor', () => {
  let mockFrame: MockFrame;
  let scanLicense: MockScanLicense;
  let mockPlugin: MockPlugin;

  beforeEach(() => {
    // Reset modules to ensure fresh imports
    jest.resetModules();

    // Create mock plugin
    mockPlugin = {
      call: jest.fn(),
    };

    // Set up VisionCameraProxy mock
    jest.doMock('react-native-vision-camera', () => ({
      VisionCameraProxy: {
        initFrameProcessorPlugin: jest.fn(() => mockPlugin),
      },
    }));

    // Import modules after mocking
    ({ scanLicense } = require('../scanLicense'));

    mockFrame = {
      width: 1920,
      height: 1080,
      pixelFormat: 'yuv420p',
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return null when no barcode is detected', () => {
    mockPlugin.call.mockReturnValue(null);

    const result = scanLicense(mockFrame);

    expect(result).toBeNull();
    expect(mockPlugin.call).toHaveBeenCalledWith(mockFrame);
  });

  it('should return successful result when barcode is detected', () => {
    const mockLicenseData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: '123456789',
    };

    const mockResult = {
      success: true,
      data: mockLicenseData,
      frameInfo: {
        width: 1920,
        height: 1080,
        timestamp: Date.now(),
      },
    };

    mockPlugin.call.mockReturnValue(mockResult);

    const result = scanLicense(mockFrame);

    expect(result).toEqual(mockResult);
    expect(result?.success).toBe(true);
    expect(result?.data).toEqual(mockLicenseData);
  });

  it('should return error result when detection fails', () => {
    const mockError = {
      code: 'DETECTION_ERROR',
      message: 'Failed to detect barcode',
      userMessage: 'Unable to scan license',
      recoverable: true,
    };

    const mockResult = {
      success: false,
      error: mockError,
    };

    mockPlugin.call.mockReturnValue(mockResult);

    const result = scanLicense(mockFrame);

    expect(result).toEqual(mockResult);
    expect(result?.success).toBe(false);
    expect(result?.error).toEqual(mockError);
  });

  it('should handle invalid plugin response', () => {
    mockPlugin.call.mockReturnValue({ invalid: 'response' });

    const result = scanLicense(mockFrame);

    expect(result).toBeDefined();
    expect(result?.success).toBe(false);
    expect(result?.error?.code).toBe('INVALID_RESPONSE');
  });

  it('should throw error when plugin is not loaded', () => {
    // Reset and mock to return null plugin
    jest.resetModules();
    jest.doMock('react-native-vision-camera', () => ({
      VisionCameraProxy: {
        initFrameProcessorPlugin: jest.fn(() => null),
      },
    }));

    // Re-import scanLicense with null plugin
    const { scanLicense: scanLicenseNullPlugin } = require('../scanLicense');

    expect(() => scanLicenseNullPlugin(mockFrame)).toThrow(
      'Failed to load scanLicense plugin!'
    );
  });
});
