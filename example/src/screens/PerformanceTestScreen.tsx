import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {
  CameraScanner,
  useLicenseScanner,
  type LicenseData,
  type ScanMode,
} from 'react-native-dl-scan';

interface PerformanceMetric {
  mode: ScanMode;
  startTime: number;
  endTime: number;
  duration: number;
  successful: boolean;
  errorMessage?: string;
}

interface PerformanceTestScreenProps {
  navigation: any;
}

const PerformanceTestScreen: React.FC<PerformanceTestScreenProps> = ({
  navigation,
}) => {
  const [showCamera, setShowCamera] = useState(false);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [currentMode, setCurrentMode] = useState<ScanMode>('auto');
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const startTimeRef = useRef<number>(0);
  const { reset } = useLicenseScanner();

  const handleScanComplete = (_data: LicenseData) => {
    const endTime = Date.now();
    const duration = endTime - startTimeRef.current;

    const metric: PerformanceMetric = {
      mode: currentMode,
      startTime: startTimeRef.current,
      endTime,
      duration,
      successful: true,
    };

    setMetrics((prev) => [...prev, metric]);
    setShowCamera(false);

    if (isRunningTest) {
      runNextTest();
    }
  };

  const handleError = (error: Error) => {
    const endTime = Date.now();
    const duration = endTime - startTimeRef.current;

    const metric: PerformanceMetric = {
      mode: currentMode,
      startTime: startTimeRef.current,
      endTime,
      duration,
      successful: false,
      errorMessage: error.message,
    };

    setMetrics((prev) => [...prev, metric]);
    setShowCamera(false);

    if (isRunningTest) {
      runNextTest();
    }
  };

  const runNextTest = () => {
    // Simulate multiple test runs
    setTimeout(() => {
      setShowCamera(true);
      startTimeRef.current = Date.now();
    }, 1000);
  };

  const startPerformanceTest = () => {
    setMetrics([]);
    setIsRunningTest(true);
    setShowCamera(true);
    startTimeRef.current = Date.now();
  };

  const startSingleScan = (mode: ScanMode) => {
    setCurrentMode(mode);
    setIsRunningTest(false);
    setShowCamera(true);
    startTimeRef.current = Date.now();
  };

  const calculateAverageTime = (mode?: ScanMode) => {
    const relevantMetrics = mode
      ? metrics.filter((m) => m.mode === mode && m.successful)
      : metrics.filter((m) => m.successful);

    if (relevantMetrics.length === 0) return 0;

    const totalTime = relevantMetrics.reduce((sum, m) => sum + m.duration, 0);
    return Math.round(totalTime / relevantMetrics.length);
  };

  const getSuccessRate = (mode?: ScanMode) => {
    const relevantMetrics = mode
      ? metrics.filter((m) => m.mode === mode)
      : metrics;

    if (relevantMetrics.length === 0) return 0;

    const successful = relevantMetrics.filter((m) => m.successful).length;
    return Math.round((successful / relevantMetrics.length) * 100);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <SafeAreaView style={styles.container}>
      {!showCamera ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Performance Test</Text>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              Measure scanning performance across different modes. Test
              individual modes or run automated performance benchmarks.
            </Text>
          </View>

          <View style={styles.testControls}>
            <TouchableOpacity
              style={styles.runAllButton}
              onPress={startPerformanceTest}
              disabled={isRunningTest}
            >
              {isRunningTest ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.runAllButtonText}>
                  Run Performance Benchmark
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.modeButtons}>
              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => startSingleScan('barcode')}
              >
                <Text style={styles.modeButtonText}>Test Barcode</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => startSingleScan('ocr')}
              >
                <Text style={styles.modeButtonText}>Test OCR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => startSingleScan('auto')}
              >
                <Text style={styles.modeButtonText}>Test Auto</Text>
              </TouchableOpacity>
            </View>
          </View>

          {metrics.length > 0 && (
            <>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Performance Summary</Text>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total Scans:</Text>
                  <Text style={styles.summaryValue}>{metrics.length}</Text>
                </View>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Success Rate:</Text>
                  <Text style={styles.summaryValue}>{getSuccessRate()}%</Text>
                </View>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Average Time:</Text>
                  <Text style={styles.summaryValue}>
                    {formatDuration(calculateAverageTime())}
                  </Text>
                </View>

                <View style={styles.modeBreakdown}>
                  <Text style={styles.breakdownTitle}>By Mode:</Text>
                  {['barcode', 'ocr', 'auto'].map((mode) => {
                    const modeMetrics = metrics.filter((m) => m.mode === mode);
                    if (modeMetrics.length === 0) return null;

                    return (
                      <View key={mode} style={styles.modeStats}>
                        <Text style={styles.modeName}>
                          {mode.toUpperCase()}:
                        </Text>
                        <Text style={styles.modeStatText}>
                          {formatDuration(
                            calculateAverageTime(mode as ScanMode)
                          )}{' '}
                          avg
                        </Text>
                        <Text style={styles.modeStatText}>
                          {getSuccessRate(mode as ScanMode)}% success
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.historyCard}>
                <Text style={styles.historyTitle}>Recent Scans</Text>
                <ScrollView style={styles.historyScroll}>
                  {metrics
                    .slice(-10)
                    .reverse()
                    .map((metric, index) => (
                      <View
                        key={index}
                        style={[
                          styles.historyItem,
                          !metric.successful && styles.historyItemError,
                        ]}
                      >
                        <View style={styles.historyHeader}>
                          <Text style={styles.historyMode}>
                            {metric.mode.toUpperCase()}
                          </Text>
                          <Text style={styles.historyDuration}>
                            {formatDuration(metric.duration)}
                          </Text>
                        </View>
                        {metric.errorMessage && (
                          <Text style={styles.historyError}>
                            {metric.errorMessage}
                          </Text>
                        )}
                      </View>
                    ))}
                </ScrollView>
              </View>

              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setMetrics([]);
                  reset();
                }}
              >
                <Text style={styles.clearButtonText}>Clear Results</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Performance Tips</Text>
            <Text style={styles.tip}>
              • Barcode scanning is typically fastest
            </Text>
            <Text style={styles.tip}>
              • OCR requires good lighting and focus
            </Text>
            <Text style={styles.tip}>
              • Auto mode adds overhead but improves reliability
            </Text>
            <Text style={styles.tip}>
              • Performance varies by device capabilities
            </Text>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.cameraContainer}>
          <CameraScanner
            mode={currentMode}
            onLicenseScanned={handleScanComplete}
            onError={handleError}
            onCancel={() => {
              setShowCamera(false);
              setIsRunningTest(false);
            }}
          />
          <View style={styles.performanceOverlay}>
            <Text style={styles.performanceText}>
              Testing {currentMode.toUpperCase()} mode...
            </Text>
            <Text style={styles.performanceTimer}>
              {formatDuration(Date.now() - startTimeRef.current)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setShowCamera(false);
              setIsRunningTest(false);
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    marginRight: 20,
  },
  backButtonText: {
    fontSize: 24,
    color: '#2196F3',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    flex: 1,
  },
  instructions: {
    padding: 20,
    backgroundColor: '#e3f2fd',
    margin: 15,
    borderRadius: 10,
  },
  instructionText: {
    fontSize: 16,
    color: '#1976d2',
    lineHeight: 24,
  },
  testControls: {
    margin: 15,
  },
  runAllButton: {
    backgroundColor: '#4caf50',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 15,
  },
  runAllButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modeButton: {
    flex: 1,
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  modeButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: 'white',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 16,
    color: '#666',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  modeBreakdown: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  breakdownTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  modeStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modeName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    width: 80,
  },
  modeStatText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
    textAlign: 'center',
  },
  historyCard: {
    backgroundColor: 'white',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
    maxHeight: 300,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  historyScroll: {
    maxHeight: 200,
  },
  historyItem: {
    backgroundColor: '#f5f5f5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  historyItemError: {
    backgroundColor: '#ffebee',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyMode: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  historyDuration: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4caf50',
  },
  historyError: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 5,
  },
  clearButton: {
    backgroundColor: '#f44336',
    padding: 15,
    margin: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  clearButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  tipsCard: {
    backgroundColor: 'white',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  tip: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 20,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  performanceOverlay: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  performanceText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  performanceTimer: {
    color: '#4caf50',
    fontSize: 24,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  cancelButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 15,
    borderRadius: 8,
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PerformanceTestScreen;
