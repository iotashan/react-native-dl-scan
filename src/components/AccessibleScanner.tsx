import React, { useState, useRef, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import CameraScanner from './CameraScanner';
import { AccessibleModeSelector } from './accessibility/AccessibleComponents';
import VoiceGuidanceSystem from './accessibility/VoiceGuidanceSystem';
import { AccessibilityGestures } from './accessibility/AccessibilityGestures';
import { AccessibilityGesturesWrapper } from './accessibility/AccessibilityGesturesWrapper';
import { useScanningAccessibility, useAccessibilityFeatures } from '../hooks/useAccessibility';
import { useFocusTrap } from '../utils/accessibility';
import type { LicenseData, ScanMode, QualityMetrics } from '../types/license';

interface AccessibleScannerProps {
  onLicenseScanned?: (data: LicenseData) => void;
  onError?: (error: Error) => void;
}

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
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | undefined>();
  const [documentDetected, setDocumentDetected] = useState(false);
  const [scanResult, setScanResult] = useState<'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [showHelp, setShowHelp] = useState(false);
  
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
    handleModeChange(modes[nextIndex]);
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
  
  const handleScanSuccess = useCallback((data: LicenseData) => {
    setScanResult('success');
    setIsScanning(false);
    onLicenseScanned?.(data);
  }, [onLicenseScanned]);
  
  const handleScanError = useCallback((error: Error) => {
    setScanResult('error');
    setErrorMessage(error.message);
    setIsScanning(false);
    onError?.(error);
  }, [onError]);
  
  const handleQualityMetrics = useCallback((metrics: QualityMetrics) => {
    setQualityMetrics(metrics);
    setDocumentDetected(metrics.positioning.documentDetected);
    
    // Announce quality changes for accessibility
    announceQuality(metrics);
  }, [announceQuality]);
  
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
      <View 
        ref={containerRef}
        style={styles.container}
        accessible={false}
      >
        {/* Voice Guidance System */}
        <VoiceGuidanceSystem
          isScanning={isScanning}
          currentMode={currentMode}
          qualityMetrics={qualityMetrics}
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
            onQualityMetrics={handleQualityMetrics}
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