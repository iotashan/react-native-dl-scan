import { render, waitFor } from '@testing-library/react-native';
import { CameraScanner } from '../CameraScanner';

// Mock react-native-vision-camera
const mockUseCameraDevice = jest.fn(() => ({
  id: 'test-device',
  hasFlash: true,
  hasTorch: true,
  position: 'back',
  name: 'Test Camera',
  isMultiCam: false,
  minZoom: 1,
  maxZoom: 10,
  neutralZoom: 1,
  physicalDevices: ['wide-angle-camera'],
  supportsFocus: true,
  supportsLowLightBoost: false,
  formats: [],
}));
const mockUseCameraPermission = jest.fn(() => ({
  hasPermission: true,
  requestPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: ({ children }: any) => children,
  useCameraDevice: () => mockUseCameraDevice(),
  useCameraPermission: () => mockUseCameraPermission(),
  useFrameProcessor: jest.fn(),
  VisionCameraProxy: {
    initFrameProcessorPlugin: jest.fn(() => ({ call: jest.fn() })),
  },
}));

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => ({
  runOnJS: (fn: Function) => fn,
}));

// Mock frame processors
jest.mock('../../frameProcessors/scanLicense', () => ({
  scanLicense: jest.fn(),
}));

jest.mock('../../frameProcessors/scanOCR', () => ({
  scanOCR: jest.fn(),
}));

describe('CameraScanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to default values
    mockUseCameraDevice.mockReturnValue({
      id: 'test-device',
      hasFlash: true,
      hasTorch: true,
      position: 'back',
      name: 'Test Camera',
      isMultiCam: false,
      minZoom: 1,
      maxZoom: 10,
      neutralZoom: 1,
      physicalDevices: ['wide-angle-camera'],
      supportsFocus: true,
      supportsLowLightBoost: false,
      formats: [],
    });
    mockUseCameraPermission.mockReturnValue({
      hasPermission: true,
      requestPermission: jest.fn(),
    });
  });

  describe('Mode Support', () => {
    it('should default to auto mode', () => {
      const { getByText } = render(<CameraScanner />);
      expect(getByText('Position your license within the frame')).toBeTruthy();
    });

    it('should display barcode-specific instructions in barcode mode', () => {
      const { getByText } = render(<CameraScanner mode="barcode" />);
      expect(getByText('Position the barcode within the frame')).toBeTruthy();
    });

    it('should display OCR-specific instructions in OCR mode', () => {
      const { getByText } = render(<CameraScanner mode="ocr" />);
      expect(
        getByText('Position the front of your license within the frame')
      ).toBeTruthy();
    });

    it('should call onModeChange when mode changes', async () => {
      const onModeChange = jest.fn();
      const { rerender } = render(
        <CameraScanner mode="barcode" onModeChange={onModeChange} />
      );

      rerender(<CameraScanner mode="ocr" onModeChange={onModeChange} />);

      await waitFor(() => {
        expect(onModeChange).toHaveBeenCalledWith('ocr');
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('should work without mode prop (legacy usage)', () => {
      const onLicenseScanned = jest.fn();
      const { getByText } = render(
        <CameraScanner onLicenseScanned={onLicenseScanned} />
      );

      // Should default to auto mode
      expect(getByText('Position your license within the frame')).toBeTruthy();
    });

    it('should maintain existing props functionality', () => {
      const onLicenseScanned = jest.fn();
      const onError = jest.fn();
      const onCancel = jest.fn();
      const scanProgress = {
        state: 'barcode' as const,
        mode: 'auto' as const,
        startTime: Date.now(),
        barcodeAttempts: 0,
        timeElapsed: 0,
        message: 'Scanning...',
      };

      const { getByText } = render(
        <CameraScanner
          onLicenseScanned={onLicenseScanned}
          onError={onError}
          onCancel={onCancel}
          scanProgress={scanProgress}
        />
      );

      expect(getByText('Scanning...')).toBeTruthy();
    });
  });

  describe('Frame Processor Config', () => {
    it('should accept frame processor configuration', () => {
      const config = {
        enableBarcode: true,
        enableOCR: false,
        confidenceThreshold: 0.9,
      };

      const { UNSAFE_root } = render(
        <CameraScanner frameProcessorConfig={config} />
      );

      expect(UNSAFE_root).toBeTruthy();
    });
  });

  describe('Permission Handling', () => {
    it('should show permission denied UI when camera permission is denied', () => {
      mockUseCameraPermission.mockReturnValue({
        hasPermission: false,
        requestPermission: jest.fn().mockResolvedValue(true),
      });

      const { getByText } = render(<CameraScanner />);
      expect(getByText('Camera permission denied')).toBeTruthy();
      expect(getByText('Grant Permission')).toBeTruthy();
    });

    it('should show loading state while checking permissions', () => {
      mockUseCameraPermission.mockReturnValue({
        hasPermission: null as any,
        requestPermission: jest.fn().mockResolvedValue(true),
      });

      const { getByText } = render(<CameraScanner />);
      expect(getByText('Checking camera permissions...')).toBeTruthy();
    });
  });

  describe('Device Handling', () => {
    it('should show error when no camera device is available', () => {
      mockUseCameraDevice.mockReturnValue(null as any);

      const { getByText } = render(<CameraScanner />);
      expect(getByText('No camera device found')).toBeTruthy();
    });
  });
});
