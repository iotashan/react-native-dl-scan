import { VisionCameraProxy } from 'react-native-vision-camera';
import type { Frame } from 'react-native-vision-camera';

// Initialize the frame processor plugin
const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanLicense');

export interface ScanLicenseResult {
  frameWidth: number;
  frameHeight: number;
  status: 'ready' | 'scanning' | 'error';
  licenseData?: any;
  error?: string;
}

/**
 * Frame processor for scanning driver's licenses
 * This will be enhanced in T02_S02 to perform actual PDF417 scanning
 */
export function scanLicense(frame: Frame): ScanLicenseResult {
  'worklet';

  if (!plugin) {
    throw new Error('Failed to load scanLicense plugin!');
  }

  // Call the native frame processor
  const result = plugin.call(frame);

  // Type guard to ensure we return a valid ScanLicenseResult
  if (result && typeof result === 'object' && 'status' in result) {
    return result as unknown as ScanLicenseResult;
  }

  // Return default result if plugin returns unexpected data
  return {
    frameWidth: frame.width,
    frameHeight: frame.height,
    status: 'ready',
  };
}
