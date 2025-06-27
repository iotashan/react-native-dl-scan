import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
  ProgressViewIOS,
  Platform,
} from 'react-native';
import {
  CameraScanner,
  QualityIndicator,
  type LicenseData,
  type QualityMetrics,
} from 'react-native-dl-scan';

interface QualityDemoScreenProps {
  navigation: any;
}

const QualityDemoScreen: React.FC<QualityDemoScreenProps> = ({
  navigation,
}) => {
  const [showCamera, setShowCamera] = useState(false);
  const [qualityHistory, setQualityHistory] = useState<QualityMetrics[]>([]);
  const [currentQuality, setCurrentQuality] = useState<QualityMetrics | null>(
    null
  );

  const handleScanComplete = (data: LicenseData) => {
    setShowCamera(false);
    Alert.alert(
      'Scan Successful',
      `High quality scan completed for ${data.firstName} ${data.lastName}`,
      [{ text: 'OK' }]
    );
  };

  const handleError = (error: Error) => {
    setShowCamera(false);
    Alert.alert('Scan Error', error.message, [{ text: 'OK' }]);
  };

  const handleQualityUpdate = (metrics: QualityMetrics) => {
    setCurrentQuality(metrics);
    setQualityHistory((prev) => [...prev.slice(-9), metrics]);
  };

  const getQualityColor = (value: number) => {
    if (value >= 0.8) return '#4caf50';
    if (value >= 0.5) return '#ff9800';
    return '#f44336';
  };

  const renderQualityBar = (label: string, value: number) => {
    const percentage = Math.round(value * 100);
    const color = getQualityColor(value);

    if (Platform.OS === 'ios') {
      return (
        <View style={styles.qualityItem}>
          <Text style={styles.qualityLabel}>{label}</Text>
          <View style={styles.qualityBarContainer}>
            <ProgressViewIOS
              style={styles.progressBar}
              progress={value}
              progressTintColor={color}
            />
            <Text style={[styles.qualityValue, { color }]}>{percentage}%</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.qualityItem}>
        <Text style={styles.qualityLabel}>{label}</Text>
        <View style={styles.qualityBarContainer}>
          <View style={styles.qualityBarBackground}>
            <View
              style={[
                styles.qualityBarFill,
                { width: `${percentage}%`, backgroundColor: color },
              ]}
            />
          </View>
          <Text style={[styles.qualityValue, { color }]}>{percentage}%</Text>
        </View>
      </View>
    );
  };

  const getOverallQuality = (metrics: QualityMetrics) => {
    const values = [
      metrics.documentDetection?.confidence || 0,
      metrics.lighting?.brightness || 0,
      metrics.focus?.clarity || 0,
      metrics.positioning?.coverage || 0,
    ];
    return values.reduce((a, b) => a + b, 0) / values.length;
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
            <Text style={styles.title}>Quality Indicators</Text>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              Quality indicators provide real-time feedback on scan conditions.
              The scanner monitors document detection, lighting, focus, and
              positioning to help users capture the best possible image.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => {
              setQualityHistory([]);
              setCurrentQuality(null);
              setShowCamera(true);
            }}
          >
            <Text style={styles.scanButtonText}>Start Quality Demo</Text>
          </TouchableOpacity>

          {qualityHistory.length > 0 && currentQuality && (
            <View style={styles.qualityCard}>
              <Text style={styles.qualityTitle}>Last Quality Metrics</Text>
              {renderQualityBar(
                'Document Detection',
                currentQuality.documentDetection?.confidence || 0
              )}
              {renderQualityBar(
                'Lighting',
                currentQuality.lighting?.brightness || 0
              )}
              {renderQualityBar('Focus', currentQuality.focus?.clarity || 0)}
              {renderQualityBar(
                'Positioning',
                currentQuality.positioning?.coverage || 0
              )}
              <View style={styles.overallContainer}>
                <Text style={styles.overallLabel}>Overall Quality</Text>
                <Text
                  style={[
                    styles.overallValue,
                    {
                      color: getQualityColor(getOverallQuality(currentQuality)),
                    },
                  ]}
                >
                  {Math.round(getOverallQuality(currentQuality) * 100)}%
                </Text>
              </View>
            </View>
          )}

          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Quality Tips</Text>
            <View style={styles.tip}>
              <Text style={styles.tipIcon}>💡</Text>
              <Text style={styles.tipText}>
                Good lighting: Avoid shadows and glare
              </Text>
            </View>
            <View style={styles.tip}>
              <Text style={styles.tipIcon}>📐</Text>
              <Text style={styles.tipText}>
                Positioning: Keep license within the guide
              </Text>
            </View>
            <View style={styles.tip}>
              <Text style={styles.tipIcon}>🎯</Text>
              <Text style={styles.tipText}>
                Focus: Hold steady for sharp images
              </Text>
            </View>
            <View style={styles.tip}>
              <Text style={styles.tipIcon}>📷</Text>
              <Text style={styles.tipText}>
                Distance: Fill the frame without cutting off edges
              </Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.cameraContainer}>
          <CameraScanner
            onLicenseScanned={handleScanComplete}
            onError={handleError}
            onCancel={() => setShowCamera(false)}
            showQualityIndicator={true}
            qualityCheckInterval={500}
            onQualityMetricsUpdate={handleQualityUpdate}
          />
          <View style={styles.qualityOverlay}>
            <QualityIndicator
              metrics={
                currentQuality || {
                  documentDetection: { detected: false, confidence: 0 },
                  lighting: { brightness: 0, uniformity: 0 },
                  focus: { clarity: 0 },
                  positioning: { coverage: 0, status: 'poor' },
                }
              }
              dismissible={false}
            />
          </View>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setShowCamera(false)}
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
  scanButton: {
    backgroundColor: '#2196F3',
    padding: 20,
    margin: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  qualityCard: {
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
  qualityTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  qualityItem: {
    marginBottom: 15,
  },
  qualityLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  qualityBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBar: {
    flex: 1,
    height: 8,
  },
  qualityBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  qualityBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  qualityValue: {
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    width: 45,
    textAlign: 'right',
  },
  overallContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  overallLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  overallValue: {
    fontSize: 24,
    fontWeight: 'bold',
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
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  tipText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  qualityOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
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

export default QualityDemoScreen;
