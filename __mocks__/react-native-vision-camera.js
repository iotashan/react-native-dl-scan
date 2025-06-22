// Mock for react-native-vision-camera
const mockPlugin = {
  call: jest.fn(),
};

export const VisionCameraProxy = {
  initFrameProcessorPlugin: jest.fn(() => mockPlugin),
};

export const Camera = {
  getCameraFormat: jest.fn(),
  getAvailableCameraDevices: jest.fn(() => Promise.resolve([])),
  getCameraPermissionStatus: jest.fn(() => Promise.resolve('granted')),
  getMicrophonePermissionStatus: jest.fn(() => Promise.resolve('granted')),
  requestCameraPermission: jest.fn(() => Promise.resolve('granted')),
  requestMicrophonePermission: jest.fn(() => Promise.resolve('granted')),
};

export const useCameraDevice = jest.fn(() => ({
  id: 'mock-camera-id',
  position: 'back',
  hasFlash: true,
  hasTorch: true,
  isMultiCam: false,
  minZoom: 1,
  maxZoom: 10,
  neutralZoom: 1,
}));

export const useCameraFormat = jest.fn(() => ({
  fps: 30,
  videoWidth: 1920,
  videoHeight: 1080,
  photoWidth: 1920,
  photoHeight: 1080,
  pixelFormat: 'yuv',
}));

export const useFrameProcessor = jest.fn((callback) => callback);

export default {
  VisionCameraProxy,
  Camera,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
};
