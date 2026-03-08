import { useCallback, useRef, useState } from 'react';
import { runOnJS } from 'react-native-worklets-core';
import type { Frame } from 'react-native-vision-camera';
import { scanFrame } from './scanFrame';
import type { LicenseData, ScanMode } from './types';

export function useLicenseScanner(mode: ScanMode = 'barcode') {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const hasResult = useRef(false);

  const onResult = useCallback((data: LicenseData) => {
    setLicenseData(data);
    setIsScanning(false);
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  const frameProcessor = useCallback(
    (frame: Frame) => {
      'worklet';
      if (hasResult.current) return;

      const result = scanFrame(frame, mode);
      if (!result) return;

      if (result.success && result.data) {
        hasResult.current = true;
        runOnJS(onResult)(result.data);
      } else if (result.error) {
        runOnJS(onError)(result.error);
      }
    },
    [mode, onResult, onError]
  );

  const reset = useCallback(() => {
    hasResult.current = false;
    setLicenseData(null);
    setError(null);
    setIsScanning(true);
  }, []);

  return { licenseData, error, isScanning, frameProcessor, reset };
}
