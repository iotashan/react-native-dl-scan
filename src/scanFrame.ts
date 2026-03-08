import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import type { ScanResult, ScanMode } from './types';

const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanLicense', {});

export function scanFrame(
  frame: Frame,
  mode: ScanMode = 'barcode'
): ScanResult | null {
  'worklet';
  if (!plugin) return null;
  return plugin.call(frame, { mode }) as unknown as ScanResult | null;
}
