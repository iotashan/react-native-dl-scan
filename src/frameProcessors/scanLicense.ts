import { VisionCameraProxy } from 'react-native-vision-camera';
import type { Frame } from 'react-native-vision-camera';
import type { LicenseData, ScanError } from '../types/license';

// Initialize the frame processor plugin
const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanLicense');

export interface ScanLicenseResult {
  success: boolean;
  data?: LicenseData;
  error?: ScanError;
  frameInfo?: {
    width: number;
    height: number;
    timestamp: number;
  };
}

/**
 * Frame processor for scanning driver's licenses using PDF417 barcodes
 * Processes camera frames in real-time to detect and parse license data
 */
export function scanLicense(frame: Frame): ScanLicenseResult | null {
  'worklet';

  if (!plugin) {
    throw new Error('Failed to load scanLicense plugin!');
  }

  // Call the native frame processor
  const result = plugin.call(frame);

  // If result is null, no barcode was detected in this frame
  if (!result) {
    return null;
  }

  // Type guard to ensure we return a valid ScanLicenseResult
  if (result && typeof result === 'object' && 'success' in result) {
    return result as unknown as ScanLicenseResult;
  }

  // Return error result if plugin returns unexpected data
  return {
    success: false,
    error: {
      code: 'INVALID_RESPONSE',
      message: 'Frame processor returned invalid response',
      userMessage: 'An error occurred while scanning',
      recoverable: true,
    },
  };
}
