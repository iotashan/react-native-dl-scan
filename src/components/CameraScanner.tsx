import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import { scanLicense } from '../frameProcessors/scanLicense';
import type { LicenseData } from '../types/license';

export interface CameraScannerProps {
  onLicenseScanned?: (data: LicenseData) => void;
  onError?: (error: Error) => void;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  onLicenseScanned,
  onError,
}) => {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isActive, setIsActive] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [lastScanTime, setLastScanTime] = useState<number>(0);

  useEffect(() => {
    // Request permission on mount if not already granted
    if (hasPermission === false) {
      requestPermission().catch((error) => {
        console.error('Failed to request camera permission:', error);
        onError?.(new Error('Failed to request camera permission'));
      });
    }
  }, [hasPermission, requestPermission, onError]);

  // Timeout detection after 30 seconds of continuous scanning
  useEffect(() => {
    if (isScanning && scanAttempts > 0) {
      const timeoutId = setTimeout(() => {
        if (Date.now() - lastScanTime > 30000) {
          setIsScanning(false);
          setScanAttempts(0);
          onError?.(
            new Error(
              'Scanning timeout. Please reposition the license and try again.'
            )
          );
        }
      }, 30000);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isScanning, scanAttempts, lastScanTime, onError]);

  const onLicenseDetected = (data: LicenseData) => {
    setIsScanning(false);
    setIsActive(false);
    onLicenseScanned?.(data);
  };

  const onScanError = (error: any) => {
    console.error('Scan error:', error);
    onError?.(new Error(error.message || 'Scanning failed'));
  };

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // Skip processing if we're already handling a scan
      if (isScanning) {
        return;
      }

      try {
        const result = scanLicense(frame);

        // Track scan attempts
        runOnJS(() => {
          setScanAttempts((prev) => prev + 1);
          setLastScanTime(Date.now());
        })();

        // If no result, no barcode was detected in this frame
        if (!result) {
          return;
        }

        // Handle successful scan
        if (result.success && result.data) {
          runOnJS(setIsScanning)(true);
          runOnJS(onLicenseDetected)(result.data);
        } else if (result.error) {
          // Log quality errors but don't report to user (they're recoverable)
          if (
            result.error.code?.startsWith('POOR_QUALITY') &&
            result.error.recoverable
          ) {
            console.log('Frame quality issue:', result.error.code);
            return;
          }

          // Only report non-recoverable errors or persistent issues
          if (!result.error.recoverable) {
            runOnJS(onScanError)(result.error);
          }
        }
      } catch (error) {
        runOnJS(onScanError)(error);
      }
    },
    [isScanning]
  );

  const handlePermissionDenied = () => {
    Alert.alert(
      'Camera Permission Required',
      'This app needs camera access to scan driver licenses. Please enable camera permissions in your device settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => Linking.openSettings(),
        },
      ]
    );
  };

  // Loading state while checking permissions
  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Checking camera permissions...</Text>
      </View>
    );
  }

  // Permission denied state
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera permission denied</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={handlePermissionDenied}
        >
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No camera device available
  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>No camera device found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        enableZoomGesture={true}
        torch={scanAttempts > 50 ? 'on' : 'off'} // Auto-enable torch if struggling
      />
      <View style={styles.overlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.instructionText}>
          Position the barcode within the frame
        </Text>
        {scanAttempts > 20 && (
          <Text style={styles.hintText}>
            Tip: Ensure good lighting and hold steady
          </Text>
        )}
        {scanAttempts > 50 && (
          <Text style={styles.hintText}>Flashlight enabled automatically</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    color: 'white',
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  button: {
    marginTop: 20,
    paddingHorizontal: 30,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 300,
    height: 200,
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
    marginTop: 30,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  hintText: {
    color: '#FFD700',
    fontSize: 14,
    marginTop: 20,
    textAlign: 'center',
    paddingHorizontal: 40,
    fontWeight: '600',
  },
});
