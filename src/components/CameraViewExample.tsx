import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { ScanningOverlayContainer } from './ScanningOverlayContainer';
import type { ScanMode } from '../types/license';

/**
 * Example integration of ScanningOverlay with Camera
 * This demonstrates how to use the scanning overlay components
 * with react-native-vision-camera
 */
export const CameraViewExample: React.FC = () => {
  const device = useCameraDevice('back');
  const [mode, setMode] = useState<ScanMode>('auto');
  const [isScanning, setIsScanning] = useState(false);
  const [orientation] = useState<'portrait' | 'landscape'>('portrait');

  // Simulated quality metrics (in real implementation, these would come from frame processor)
  const [imageQuality] = useState({
    blur: 0.2,
    lighting: 0.8,
    positioning: 0.9,
    overall: 'good' as const,
  });

  // Simulated edge detection (in real implementation, this would come from Vision framework)
  const [edgeDetected] = useState({
    top: true,
    right: true,
    bottom: true,
    left: false,
  });

  const handleOverlayPress = () => {
    setIsScanning(!isScanning);
  };

  const handleModeChange = (newMode: ScanMode) => {
    setMode(newMode);
  };

  if (!device) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        enableZoomGesture={true}
      />
      
      <ScanningOverlayContainer
        mode={mode}
        isScanning={isScanning}
        onModeChange={handleModeChange}
        onOverlayPress={handleOverlayPress}
        imageQuality={imageQuality}
        edgeDetected={edgeDetected}
        showQualityIndicator={true}
        showAlignmentGuides={true}
        showModeToggle={true}
        orientation={orientation}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
});