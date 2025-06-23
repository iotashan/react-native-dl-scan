import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import { scanLicense } from '../frameProcessors/scanLicense';
import type { LicenseData, ScanProgress } from '../types/license';

export interface CameraScannerProps {
  onLicenseScanned?: (data: LicenseData) => void;
  onError?: (error: Error) => void;
  scanProgress?: ScanProgress | null;
  onCancel?: () => void;
}

interface ProgressIndicatorProps {
  progress: ScanProgress;
  onCancel?: () => void;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  progress,
  onCancel,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Announce state changes for accessibility
  useEffect(() => {
    if (progress.accessibilityAnnouncement) {
      AccessibilityInfo.announceForAccessibility(
        progress.accessibilityAnnouncement
      );
    }
  }, [progress.accessibilityAnnouncement]);

  // Handle animations based on animation state
  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];

    if (progress.animationState === 'entering') {
      animations.push(
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(slideAnim, {
            toValue: 0,
            tension: 65,
            friction: 10,
            useNativeDriver: true,
          }),
        ])
      );
    } else if (progress.animationState === 'exiting') {
      animations.push(
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: -100,
            duration: 200,
            useNativeDriver: true,
          }),
        ])
      );
    }

    if (progress.progressPercentage !== undefined) {
      animations.push(
        Animated.timing(progressAnim, {
          toValue: progress.progressPercentage,
          duration: 300,
          useNativeDriver: false,
        })
      );
    }

    if (animations.length > 0) {
      Animated.sequence(animations).start();
    }
  }, [
    progress.animationState,
    progress.progressPercentage,
    fadeAnim,
    slideAnim,
    progressAnim,
  ]);

  const formatTime = (ms: number): string => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <Animated.View
      style={[
        styles.progressContainer,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityValue={{
        now: progress.progressPercentage || 0,
        min: 0,
        max: 100,
      }}
    >
      <View style={styles.progressContent}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressMessage}>{progress.message}</Text>
          {progress.showCancelButton && onCancel && (
            <TouchableOpacity
              onPress={onCancel}
              style={styles.cancelButton}
              accessibilityLabel="Cancel scan"
              accessibilityRole="button"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>

        {progress.progressPercentage !== undefined && (
          <View style={styles.progressBarContainer}>
            <Animated.View
              style={[
                styles.progressBar,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        )}

        <View style={styles.progressDetails}>
          <Text style={styles.progressDetailText}>
            {formatTime(progress.timeElapsed)}
          </Text>
          {progress.estimatedTimeRemaining !== undefined && (
            <Text style={styles.progressDetailText}>
              Est. {formatTime(progress.estimatedTimeRemaining)} remaining
            </Text>
          )}
        </View>

        {progress.state === 'barcode' && progress.barcodeAttempts > 3 && (
          <Text style={styles.progressHint}>
            Tip: Ensure good lighting and hold steady
          </Text>
        )}
      </View>
    </Animated.View>
  );
};

export const CameraScanner: React.FC<CameraScannerProps> = ({
  onLicenseScanned,
  onError,
  scanProgress,
  onCancel,
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
      {scanProgress && (
        <ProgressIndicator progress={scanProgress} onCancel={onCancel} />
      )}
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
  progressContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  progressContent: {
    flex: 1,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressMessage: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginLeft: 12,
  },
  cancelButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  progressDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressDetailText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
  progressHint: {
    color: '#FFD700',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
