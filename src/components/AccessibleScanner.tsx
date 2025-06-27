import React, { useState, useRef, useCallback } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { CameraScanner } from './CameraScanner';
import { AccessibleModeSelector } from './accessibility/AccessibleComponents';
import VoiceGuidanceSystem from './accessibility/VoiceGuidanceSystem';
import { AccessibilityGestures as AccessibilityGesturesWrapper } from './accessibility/AccessibilityGesturesWrapper';
import {
  useScanningAccessibility,
  useAccessibilityFeatures,
} from '../hooks/useAccessibility';
import { useFocusTrap } from '../utils/accessibility';
import type {
  LicenseData,
  ScanMode,
  RealTimeQualityMetrics,
  QualityMetrics,
} from '../types/license';

interface AccessibleScannerProps {
  onLicenseScanned?: (data: LicenseData) => void;
  onError?: (error: Error) => void;
}

/**
 * Convert RealTimeQualityMetrics to QualityMetrics for compatibility
 */
const convertToQualityMetrics = (
  rtMetrics: RealTimeQualityMetrics
): QualityMetrics => {
  return {
    brightness: rtMetrics.lighting.brightness,
    blur: rtMetrics.blur.value,
    glare: 1 - rtMetrics.lighting.uniformity, // Approximate glare from uniformity
    documentAlignment: rtMetrics.positioning.alignment,
  };
};

/**
 * Convert RealTimeQualityMetrics to VoiceGuidanceSystem QualityMetrics
 */
const convertToVoiceGuidanceMetrics = (
  rtMetrics: RealTimeQualityMetrics
): any => {
  return {
    overall: rtMetrics.overall.score,
    positioning: {
      distance: rtMetrics.positioning.distance,
      angle: 'straight' as const,
      documentDetected: rtMetrics.positioning.documentDetected,
      inFrame: rtMetrics.positioning.documentDetected,
    },
    lighting: {
      overall: rtMetrics.lighting.brightness,
      uniformity: rtMetrics.lighting.uniformity,
      shadows: false,
      glare: rtMetrics.lighting.uniformity < 0.7,
    },
    focus: {
      sharpness: 1 - rtMetrics.blur.value,
      blurDetected: rtMetrics.blur.value > 0.5,
    },
  };
};

/**
 * Fully accessible scanner component that integrates all accessibility features
 * - VoiceOver support with comprehensive labels
 * - Voice guidance for scanning process
 * - Custom accessibility gestures
 * - High contrast support
 * - Dynamic type support
 * - Focus management
 */
const AccessibleScanner: React.FC<AccessibleScannerProps> = ({
  onLicenseScanned,
  onError,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentMode, setCurrentMode] = useState<ScanMode>('auto');
  const [_realTimeMetrics, setRealTimeMetrics] = useState<
    RealTimeQualityMetrics | undefined
  >();
  const [qualityMetrics, setQualityMetrics] = useState<
    QualityMetrics | undefined
  >();
  const [voiceGuidanceMetrics, setVoiceGuidanceMetrics] = useState<any>();
  const [documentDetected, setDocumentDetected] = useState(false);
  const [scanResult, setScanResult] = useState<'success' | 'error' | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [_showHelp, setShowHelp] = useState(false);

  const containerRef = useRef<View>(null);

  // Accessibility features
  const { isVoiceOverEnabled, announce } = useAccessibilityFeatures();
  const { announceQuality } = useScanningAccessibility({
    isScanning,
    currentMode,
    qualityMetrics,
    documentDetected,
  });

  // Focus trap for modal states
  const { firstElementRef, lastElementRef } = useFocusTrap(isScanning);

  // Mode change handler
  const handleModeChange = useCallback((mode: ScanMode) => {
    setCurrentMode(mode);
    // Announcement handled by useScanningAccessibility hook
  }, []);

  // Toggle between modes
  const toggleMode = useCallback(() => {
    const modes: ScanMode[] = ['auto', 'barcode', 'ocr'];
    const currentIndex = modes.indexOf(currentMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    handleModeChange(modes[nextIndex]!);
  }, [currentMode, handleModeChange]);

  // Scan handlers
  const startScanning = useCallback(() => {
    setIsScanning(true);
    setScanResult(null);
    setErrorMessage(undefined);
  }, []);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
  }, []);

  const handleScanSuccess = useCallback(
    (data: LicenseData) => {
      setScanResult('success');
      setIsScanning(false);
      onLicenseScanned?.(data);
    },
    [onLicenseScanned]
  );

  const handleScanError = useCallback(
    (error: Error) => {
      setScanResult('error');
      setErrorMessage(error.message);
      setIsScanning(false);
      onError?.(error);
    },
    [onError]
  );

  const handleQualityMetrics = useCallback(
    (metrics: RealTimeQualityMetrics) => {
      setRealTimeMetrics(metrics);
      setDocumentDetected(metrics.positioning.documentDetected);

      // Convert to QualityMetrics for compatibility
      const convertedMetrics = convertToQualityMetrics(metrics);
      setQualityMetrics(convertedMetrics);

      // Convert to voice guidance metrics
      const voiceMetrics = convertToVoiceGuidanceMetrics(metrics);
      setVoiceGuidanceMetrics(voiceMetrics);

      // Announce quality changes for accessibility
      announceQuality(convertedMetrics);
    },
    [announceQuality]
  );

  // Reset scanner
  const resetScanner = useCallback(() => {
    setIsScanning(false);
    setScanResult(null);
    setErrorMessage(undefined);
    setDocumentDetected(false);
    setQualityMetrics(undefined);
    announce('Scanner reset. Ready to scan.');
  }, [announce]);

  // Show accessibility help
  const showAccessibilityHelp = useCallback(() => {
    setShowHelp(true);
    Alert.alert(
      'Accessibility Help',
      `Available gestures:
• Two-finger double tap: Toggle scanning modes
• Three-finger swipe up: Show this help
• Three-finger swipe down: Start scanning
• Four-finger tap: Reset scanner

Current mode: ${currentMode}
VoiceOver: ${isVoiceOverEnabled ? 'Enabled' : 'Disabled'}`,
      [{ text: 'OK', onPress: () => setShowHelp(false) }]
    );
  }, [currentMode, isVoiceOverEnabled]);

  return (
    <AccessibilityGesturesWrapper
      currentMode={currentMode}
      onModeToggle={toggleMode}
      onHelp={showAccessibilityHelp}
      onScanTrigger={startScanning}
      onReset={resetScanner}
    >
      <View ref={containerRef} style={styles.container} accessible={false}>
        {/* Voice Guidance System */}
        <VoiceGuidanceSystem
          isScanning={isScanning}
          currentMode={currentMode}
          qualityMetrics={voiceGuidanceMetrics}
          documentDetected={documentDetected}
          scanResult={scanResult}
          errorMessage={errorMessage}
          onGuidanceComplete={stopScanning}
        />

        {/* Mode Selector with focus trap start */}
        <View ref={firstElementRef}>
          <AccessibleModeSelector
            currentMode={currentMode}
            availableModes={['auto', 'barcode', 'ocr']}
            onModeChange={handleModeChange}
            disabled={isScanning}
          />
        </View>

        {/* Camera Scanner */}
        <View style={styles.scannerContainer}>
          <CameraScanner
            mode={currentMode}
            onLicenseScanned={handleScanSuccess}
            onError={handleScanError}
            onQualityMetrics={(metrics: QualityMetrics) => {
              // Convert from QualityMetrics to RealTimeQualityMetrics
              const rtMetrics: RealTimeQualityMetrics = {
                blur: {
                  value: metrics.blur,
                  status:
                    metrics.blur < 0.3
                      ? 'good'
                      : metrics.blur < 0.6
                        ? 'warning'
                        : 'poor',
                },
                lighting: {
                  brightness: metrics.brightness,
                  uniformity: 1 - metrics.glare, // Convert glare back to uniformity
                  status:
                    metrics.brightness > 0.7
                      ? 'good'
                      : metrics.brightness > 0.4
                        ? 'warning'
                        : 'poor',
                },
                positioning: {
                  documentDetected: metrics.documentAlignment > 0.5,
                  alignment: metrics.documentAlignment,
                  distance: 'optimal',
                  status:
                    metrics.documentAlignment > 0.7
                      ? 'good'
                      : metrics.documentAlignment > 0.4
                        ? 'warning'
                        : 'poor',
                },
                overall: {
                  score:
                    (metrics.brightness +
                      (1 - metrics.blur) +
                      (1 - metrics.glare) +
                      metrics.documentAlignment) /
                    4,
                  readyToScan:
                    metrics.documentAlignment > 0.5 && metrics.blur < 0.5,
                },
              };
              handleQualityMetrics(rtMetrics);
            }}
            onCancel={stopScanning}
          />
        </View>

        {/* Focus trap end */}
        <View ref={lastElementRef} />
      </View>
    </AccessibilityGesturesWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scannerContainer: {
    flex: 1,
  },
});

export default AccessibleScanner;
