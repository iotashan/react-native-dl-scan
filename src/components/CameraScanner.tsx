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

  useEffect(() => {
    // Request permission on mount if not already granted
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

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

        // If no result, no barcode was detected in this frame
        if (!result) {
          return;
        }

        // Handle successful scan
        if (result.success && result.data) {
          runOnJS(setIsScanning)(true);
          runOnJS(onLicenseDetected)(result.data);
        } else if (result.error) {
          // Only report errors that are not recoverable
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
      />
      <View style={styles.overlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.instructionText}>
          Position the barcode within the frame
        </Text>
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
});
