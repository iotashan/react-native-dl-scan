import { useCallback, useState } from 'react';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import { useFrameProcessor } from 'react-native-vision-camera';
import { scanFrame } from './scanFrame';
import type { LicenseData, ScanMode } from './types';

export function useLicenseScanner(mode: ScanMode = 'barcode') {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const hasResult = useSharedValue(false);

  const onResult = useRunOnJS(
    (data: LicenseData) => {
      setLicenseData(data);
      setIsScanning(false);
    },
    [setLicenseData, setIsScanning]
  );

  const onError = useRunOnJS(
    (message: string) => {
      setError(message);
    },
    [setError]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (hasResult.value) return;

      const result = scanFrame(frame, mode);
      if (!result) return;

      if (result.success && result.data) {
        hasResult.value = true;
        onResult(result.data);
      } else if (result.error) {
        onError(result.error);
      }
    },
    [mode, hasResult, onResult, onError]
  );

  const reset = useCallback(() => {
    hasResult.value = false;
    setLicenseData(null);
    setError(null);
    setIsScanning(true);
  }, [hasResult]);

  return { licenseData, error, isScanning, frameProcessor, reset };
}
