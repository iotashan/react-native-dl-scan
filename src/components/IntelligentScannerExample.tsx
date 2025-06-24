import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Text } from 'react-native';
import { useLicenseScanner } from '../hooks/useLicenseScanner';
import { ModeSelector } from './ModeSelector';
import { CameraScanner } from './CameraScanner';
import type { LicenseData, ScanMode, QualityMetrics } from '../types/license';
import { logger } from '../utils/logger';

/**
 * Example component demonstrating intelligent mode management
 * This shows how to integrate the enhanced ModeSelector with auto-mode feedback
 */
export const IntelligentScannerExample: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedData, setScannedData] = useState<LicenseData | null>(null);

  const {
    licenseData,
    isScanning: scannerIsScanning,
    error,
    scanMode,
    currentMode,
    scanProgress,
    autoModeState,
    lastQualityMetrics,
    scan,
    setScanMode,
    processQualityMetrics,
    reset,
    clearError,
  } = useLicenseScanner({
    mode: 'auto', // Start in auto mode
    barcodeTimeout: 10000, // 10 seconds for demo
    enableFallback: true,
  });

  // Handle successful scan
  useEffect(() => {
    if (licenseData) {
      setScannedData(licenseData);
      setIsScanning(false);

      logger.info('Scan completed successfully', {
        mode: scanMode,
        autoState: autoModeState,
        hasFirstName: !!licenseData.firstName,
        hasLastName: !!licenseData.lastName,
      });

      Alert.alert(
        'Scan Successful!',
        `Found license for ${licenseData.firstName} ${licenseData.lastName}`,
        [{ text: 'OK', onPress: handleReset }]
      );
    }
  }, [licenseData, scanMode, autoModeState, handleReset]);

  // Handle scan errors
  useEffect(() => {
    if (error) {
      setIsScanning(false);
      Alert.alert(
        'Scan Error',
        error.userMessage || 'An error occurred while scanning',
        [
          { text: 'Retry', onPress: handleRetry },
          { text: 'Cancel', onPress: handleReset },
        ]
      );
    }
  }, [error, handleRetry, handleReset]);

  const handleStartScan = useCallback(() => {
    setIsScanning(true);
    clearError();

    // In a real app, this would come from the camera frame processor
    // For demo purposes, we'll simulate barcode data
    const mockBarcodeData =
      '@\n\u001e\rANSI 636014040002DL00410395DLDCAUTO_TEST_DATA' +
      '\nDCSSample\nDDEN\nDACDOE\nDDFN\nDADJOHN\nDDGN\nDCU\nDCAD\n' +
      'DDB12/01/1985\nDDD1\nDBC1\nDBA12/01/2025\nDAG123 MAIN ST\n' +
      'DAIANYTOWN\nDAJCA\nDAK90210\nDCFNONE\nDCGUSA\nDCH1\nDDBR\n' +
      'DDAEYE\nDAA123456789\nDCE4\nDDA\u001e';

    scan(mockBarcodeData, scanMode).catch((err) => {
      logger.error('Scan failed', err);
    });
  }, [scan, scanMode, clearError]);

  const handleQualityMetrics = useCallback(
    (metrics: QualityMetrics) => {
      const shouldSwitch = processQualityMetrics(metrics);

      logger.debug('Quality metrics processed', {
        metrics,
        shouldSwitch,
        currentMode,
        autoState: autoModeState,
      });
    },
    [processQualityMetrics, currentMode, autoModeState]
  );

  const handleModeChange = useCallback(
    (newMode: ScanMode) => {
      setScanMode(newMode);
      logger.info('Mode changed manually', { from: scanMode, to: newMode });
    },
    [setScanMode, scanMode]
  );

  const handleRetry = useCallback(() => {
    clearError();
    setIsScanning(false);
  }, [clearError]);

  const handleReset = useCallback(() => {
    reset();
    setScannedData(null);
    setIsScanning(false);
  }, [reset]);

  const handleCancel = useCallback(() => {
    setIsScanning(false);
    reset();
  }, [reset]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Intelligent License Scanner</Text>
      <Text style={styles.subtitle}>
        Demonstrates auto-mode with intelligent fallback
      </Text>

      {/* Mode Selector with Auto-Mode Feedback */}
      <ModeSelector
        currentMode={scanMode}
        onModeChange={handleModeChange}
        disabled={isScanning || scannerIsScanning}
        autoModeState={autoModeState}
        isTransitioning={scanProgress?.isTransitioning}
        timeRemaining={scanProgress?.estimatedTimeRemaining}
      />

      {/* Status Information */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>Current Mode:</Text>
        <Text style={styles.statusValue}>{scanMode}</Text>

        {autoModeState && (
          <>
            <Text style={styles.statusLabel}>Auto State:</Text>
            <Text style={styles.statusValue}>{autoModeState}</Text>
          </>
        )}

        {scanProgress && (
          <>
            <Text style={styles.statusLabel}>Progress:</Text>
            <Text style={styles.statusValue}>
              {scanProgress.message || 'Processing...'}
            </Text>

            {scanProgress.progressPercentage !== undefined && (
              <View style={styles.progressContainer}>
                <View
                  style={[
                    styles.progressBar,
                    { width: `${scanProgress.progressPercentage}%` },
                  ]}
                />
              </View>
            )}
          </>
        )}

        {lastQualityMetrics && (
          <View style={styles.qualityContainer}>
            <Text style={styles.statusLabel}>Quality Metrics:</Text>
            <Text style={styles.qualityText}>
              Brightness: {(lastQualityMetrics.brightness * 100).toFixed(0)}%
            </Text>
            <Text style={styles.qualityText}>
              Blur: {(lastQualityMetrics.blur * 100).toFixed(0)}%
            </Text>
            <Text style={styles.qualityText}>
              Glare: {(lastQualityMetrics.glare * 100).toFixed(0)}%
            </Text>
            <Text style={styles.qualityText}>
              Alignment:{' '}
              {(lastQualityMetrics.documentAlignment * 100).toFixed(0)}%
            </Text>
          </View>
        )}
      </View>

      {/* Camera Scanner */}
      {isScanning || scannerIsScanning ? (
        <CameraScanner
          onLicenseScanned={(data) => {
            logger.info('License scanned via camera', data);
          }}
          onError={(err) => {
            logger.error('Camera scanner error', err);
          }}
          scanProgress={scanProgress}
          onCancel={handleCancel}
          mode={scanMode}
          onModeChange={handleModeChange}
          autoModeState={autoModeState}
          onQualityMetrics={handleQualityMetrics}
        />
      ) : (
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderText}>
            {scannedData
              ? 'Scan completed successfully!'
              : 'Tap Start Scan to begin'}
          </Text>

          <View style={styles.buttonContainer}>
            <Text style={styles.startButton} onPress={handleStartScan}>
              {scannedData ? 'Scan Again' : 'Start Scan'}
            </Text>

            {scannedData && (
              <Text style={styles.resetButton} onPress={handleReset}>
                Reset
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Results Display */}
      {scannedData && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>Scanned License Data:</Text>
          <Text style={styles.resultText}>
            Name: {scannedData.firstName} {scannedData.lastName}
          </Text>
          <Text style={styles.resultText}>
            License #: {scannedData.licenseNumber}
          </Text>
          <Text style={styles.resultText}>
            State: {scannedData.address?.state}
          </Text>
          <Text style={styles.resultText}>
            Expires: {scannedData.expirationDate?.toLocaleDateString()}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginBottom: 20,
  },
  statusContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 8,
  },
  statusValue: {
    fontSize: 16,
    color: 'white',
    marginBottom: 4,
  },
  progressContainer: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  qualityContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  qualityText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginVertical: 1,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    margin: 16,
  },
  placeholderText: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginBottom: 24,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  startButton: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    textAlign: 'center',
    overflow: 'hidden',
  },
  resetButton: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    textAlign: 'center',
    overflow: 'hidden',
  },
  resultsContainer: {
    backgroundColor: 'rgba(52, 199, 89, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.3)',
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#34C759',
    marginBottom: 12,
  },
  resultText: {
    fontSize: 14,
    color: 'white',
    marginVertical: 2,
  },
});

export default IntelligentScannerExample;
