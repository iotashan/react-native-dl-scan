import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { ScanningOverlay } from './ScanningOverlay';
import { QualityIndicator } from './QualityIndicator';
import { AlignmentGuides } from './AlignmentGuides';
import { GuidanceOverlay } from './GuidanceOverlay';
import type { ScanMode, RealTimeQualityMetrics } from '../types/license';

interface ScanningOverlayContainerProps {
  mode: ScanMode;
  isScanning: boolean;
  onModeChange?: (mode: ScanMode) => void;
  onOverlayPress?: () => void;
  // Quality metrics (supports both legacy and new interfaces)
  imageQuality?: {
    blur: number;
    lighting: number;
    positioning: number;
    overall: 'good' | 'fair' | 'poor';
  };
  realTimeQualityMetrics?: RealTimeQualityMetrics;
  // Edge detection
  edgeDetected?: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  // UI configuration
  showQualityIndicator?: boolean;
  showAlignmentGuides?: boolean;
  showModeToggle?: boolean;
  showGuidanceOverlay?: boolean;
  enableHapticFeedback?: boolean;
  enableAccessibilityAnnouncements?: boolean;
  orientation?: 'portrait' | 'landscape';
}

export const ScanningOverlayContainer: React.FC<
  ScanningOverlayContainerProps
> = ({
  mode,
  isScanning,
  onModeChange,
  onOverlayPress,
  imageQuality = {
    blur: 0.3,
    lighting: 0.7,
    positioning: 0.8,
    overall: 'good',
  },
  realTimeQualityMetrics,
  edgeDetected = {
    top: false,
    right: false,
    bottom: false,
    left: false,
  },
  showQualityIndicator = true,
  showAlignmentGuides = true,
  showModeToggle = true,
  showGuidanceOverlay = true,
  enableHapticFeedback = true,
  enableAccessibilityAnnouncements = true,
  orientation = 'portrait',
}) => {
  const [detectionState, setDetectionState] = useState<
    'idle' | 'detecting' | 'success' | 'error'
  >('idle');
  const [showGrid, setShowGrid] = useState(false);

  // Simulate detection states based on quality (supports both metric interfaces)
  useEffect(() => {
    const isGoodQuality = realTimeQualityMetrics
      ? realTimeQualityMetrics.overall.readyToScan
      : imageQuality.overall === 'good';

    if (isScanning && isGoodQuality) {
      setDetectionState('detecting');
    } else {
      setDetectionState('idle');
    }
  }, [isScanning, imageQuality.overall, realTimeQualityMetrics]);

  const handleModeToggle = useCallback(() => {
    if (!onModeChange) return;

    const nextMode: Record<ScanMode, ScanMode> = {
      auto: 'barcode',
      barcode: 'ocr',
      ocr: 'auto',
    };

    onModeChange(nextMode[mode]);
  }, [mode, onModeChange]);

  const getInstructionText = () => {
    if (!isScanning) {
      return 'Tap to start scanning';
    }

    // Use real-time metrics if available, otherwise fall back to legacy
    if (realTimeQualityMetrics) {
      if (!realTimeQualityMetrics.positioning.documentDetected) {
        return mode === 'barcode'
          ? 'Position the back of your license in the frame'
          : 'Position the front of your license in the frame';
      }
      if (realTimeQualityMetrics.blur.status === 'poor') {
        return 'Hold camera steady';
      }
      if (realTimeQualityMetrics.lighting.status === 'poor') {
        return 'Find better lighting';
      }
      if (realTimeQualityMetrics.positioning.status === 'poor') {
        return realTimeQualityMetrics.positioning.distance === 'too_close'
          ? 'Move device farther away'
          : realTimeQualityMetrics.positioning.distance === 'too_far'
            ? 'Move device closer'
            : 'Center license in frame';
      }
    } else if (imageQuality.overall === 'poor') {
      if (imageQuality.blur > 0.7) {
        return 'Hold camera steady';
      }
      if (imageQuality.lighting < 0.3) {
        return 'Move to better lighting';
      }
      if (imageQuality.positioning < 0.5) {
        return 'Center license in frame';
      }
    }

    switch (mode) {
      case 'barcode':
        return 'Scanning for barcode...';
      case 'ocr':
        return 'Reading license text...';
      case 'auto':
        return 'Detecting license...';
      default:
        return '';
    }
  };

  const hasGoodEdgeAlignment =
    edgeDetected.top &&
    edgeDetected.right &&
    edgeDetected.bottom &&
    edgeDetected.left;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Main scanning overlay */}
      <ScanningOverlay
        mode={mode}
        isScanning={isScanning}
        detectionState={detectionState}
        orientation={orientation}
        onOverlayPress={onOverlayPress}
        instructionText={getInstructionText()}
        showGuides={true}
        animateSuccess={true}
        animateError={true}
      />

      {/* Alignment guides */}
      {showAlignmentGuides && isScanning && (
        <AlignmentGuides
          showGrid={showGrid}
          showCenterCross={!hasGoodEdgeAlignment}
          showEdgeIndicators={true}
          edgeDetected={edgeDetected}
          animated={true}
          color={imageQuality.overall === 'good' ? '#4CAF50' : '#FFD700'}
        />
      )}

      {/* Quality indicator */}
      {showQualityIndicator && isScanning && (
        <QualityIndicator
          metrics={realTimeQualityMetrics || imageQuality}
          showDetails={
            realTimeQualityMetrics
              ? !realTimeQualityMetrics.overall.readyToScan
              : imageQuality.overall !== 'good'
          }
          compact={
            realTimeQualityMetrics
              ? realTimeQualityMetrics.overall.readyToScan
              : imageQuality.overall === 'good'
          }
          mode={mode === 'barcode' ? 'pdf417' : 'ocr'}
          enableHapticFeedback={enableHapticFeedback}
          enableAccessibilityAnnouncements={enableAccessibilityAnnouncements}
        />
      )}

      {/* Guidance overlay for enhanced feedback */}
      {showGuidanceOverlay && isScanning && realTimeQualityMetrics && (
        <GuidanceOverlay
          metrics={realTimeQualityMetrics}
          mode={mode === 'barcode' ? 'pdf417' : 'ocr'}
          pulseAnimation={true}
        />
      )}

      {/* Mode toggle button */}
      {showModeToggle && !isScanning && (
        <View style={styles.modeToggleContainer}>
          <TouchableOpacity
            style={styles.modeToggle}
            onPress={handleModeToggle}
            activeOpacity={0.7}
          >
            <Text style={styles.modeToggleText}>
              Mode: {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Grid toggle (for debugging/alignment) */}
      {showAlignmentGuides && (
        <TouchableOpacity
          style={styles.gridToggle}
          onPress={() => setShowGrid(!showGrid)}
          activeOpacity={0.7}
        >
          <Text style={styles.gridToggleText}>{showGrid ? '⊞' : '⊡'}</Text>
        </TouchableOpacity>
      )}

      {/* Success feedback */}
      {detectionState === 'success' && (
        <View style={styles.successOverlay} pointerEvents="none">
          <View style={styles.successContent}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successText}>License Detected</Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  modeToggleContainer: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
  },
  modeToggle: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  modeToggleText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  gridToggle: {
    position: 'absolute',
    top: 100,
    left: 20,
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridToggleText: {
    color: 'white',
    fontSize: 20,
  },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(76, 175, 80, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  successContent: {
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 80,
    color: 'white',
    marginBottom: 20,
  },
  successText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
});
