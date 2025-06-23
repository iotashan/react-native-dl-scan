import { VisionCameraProxy } from 'react-native-vision-camera';
import type { Frame } from 'react-native-vision-camera';
import type { OCRTextObservation, ScanError } from '../types/license';

// Initialize the frame processor plugin (placeholder for now)
// In production, this would connect to the native OCR implementation
const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanOCR');

export interface ScanOCRResult {
  success: boolean;
  observations?: OCRTextObservation[];
  error?: ScanError;
  frameInfo?: {
    width: number;
    height: number;
    timestamp: number;
  };
}

/**
 * Frame processor for OCR scanning of driver's licenses
 * This is a placeholder that will be implemented with iOS Vision Framework
 * integration in future sprints
 */
export function scanOCR(frame: Frame): ScanOCRResult | null {
  'worklet';

  // For now, return null to indicate no OCR processing
  // This will be replaced with actual Vision Framework integration
  if (!plugin) {
    // In development, we don't have the OCR plugin yet
    return null;
  }

  // Call the native frame processor
  const result = plugin.call(frame);

  // If result is null, no text was detected in this frame
  if (!result) {
    return null;
  }

  // Type guard to ensure we return a valid ScanOCRResult
  if (result && typeof result === 'object' && 'success' in result) {
    return result as unknown as ScanOCRResult;
  }

  // Return error result if plugin returns unexpected data
  return {
    success: false,
    error: {
      code: 'INVALID_OCR_RESPONSE',
      message: 'OCR processor returned invalid response',
      userMessage: 'An error occurred while reading text',
      recoverable: true,
    },
  };
}
