import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
  Switch,
  AccessibilityInfo,
} from 'react-native';
import {
  CameraScanner,
  useLicenseScanner,
  type LicenseData,
} from 'react-native-dl-scan';

interface AccessibilityDemoScreenProps {
  navigation: any;
}

const AccessibilityDemoScreen: React.FC<AccessibilityDemoScreenProps> = ({
  navigation,
}) => {
  const [showCamera, setShowCamera] = useState(false);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [hapticFeedbackEnabled, setHapticFeedbackEnabled] = useState(true);
  const [highContrastEnabled, setHighContrastEnabled] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const { licenseData, error, reset } = useLicenseScanner();

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      setScreenReaderEnabled(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderEnabled
    );

    return () => subscription?.remove();
  }, []);

  const handleScanComplete = (data: LicenseData) => {
    setShowCamera(false);
    const message = `Successfully scanned license for ${data.firstName} ${data.lastName}`;
    Alert.alert('Scan Complete', message, [{ text: 'OK' }]);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const handleError = (scanError: Error) => {
    setShowCamera(false);
    Alert.alert('Scan Error', scanError.message, [{ text: 'OK' }]);
    AccessibilityInfo.announceForAccessibility(
      `Scan error: ${scanError.message}`
    );
  };

  const toggleSetting = (
    setting: string,
    value: boolean,
    setter: (value: boolean) => void
  ) => {
    setter(value);
    const status = value ? 'enabled' : 'disabled';
    AccessibilityInfo.announceForAccessibility(`${setting} ${status}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      {!showCamera ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              accessible={true}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.title} accessibilityRole="header">
              Accessibility Features
            </Text>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              This demo showcases accessibility features including voice
              guidance, haptic feedback, and screen reader support to make
              license scanning accessible to all users.
            </Text>
          </View>

          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle} accessibilityRole="header">
              Accessibility Settings
            </Text>

            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Voice Guidance</Text>
                <Text style={styles.settingDescription}>
                  Audio instructions during scanning
                </Text>
              </View>
              <Switch
                value={voiceGuidanceEnabled}
                onValueChange={(value) =>
                  toggleSetting(
                    'Voice guidance',
                    value,
                    setVoiceGuidanceEnabled
                  )
                }
                accessibilityLabel="Voice guidance toggle"
                accessibilityRole="switch"
              />
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Haptic Feedback</Text>
                <Text style={styles.settingDescription}>
                  Vibration cues for scan events
                </Text>
              </View>
              <Switch
                value={hapticFeedbackEnabled}
                onValueChange={(value) =>
                  toggleSetting(
                    'Haptic feedback',
                    value,
                    setHapticFeedbackEnabled
                  )
                }
                accessibilityLabel="Haptic feedback toggle"
                accessibilityRole="switch"
              />
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>High Contrast</Text>
                <Text style={styles.settingDescription}>
                  Enhanced visual contrast for UI
                </Text>
              </View>
              <Switch
                value={highContrastEnabled}
                onValueChange={(value) =>
                  toggleSetting('High contrast', value, setHighContrastEnabled)
                }
                accessibilityLabel="High contrast toggle"
                accessibilityRole="switch"
              />
            </View>
          </View>

          {screenReaderEnabled && (
            <View style={styles.screenReaderCard}>
              <Text style={styles.screenReaderTitle}>
                Screen Reader Detected
              </Text>
              <Text style={styles.screenReaderText}>
                The scanner is optimized for screen reader use. Voice guidance
                will provide detailed instructions throughout the scanning
                process.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.scanButton,
              highContrastEnabled && styles.scanButtonHighContrast,
            ]}
            onPress={() => setShowCamera(true)}
            accessible={true}
            accessibilityLabel="Start accessible scanning"
            accessibilityRole="button"
            accessibilityHint="Opens the camera with accessibility features enabled"
          >
            <Text
              style={[
                styles.scanButtonText,
                highContrastEnabled && styles.scanButtonTextHighContrast,
              ]}
            >
              Start Accessible Scan
            </Text>
          </TouchableOpacity>

          {licenseData && (
            <View
              style={styles.resultCard}
              accessible={true}
              accessibilityLabel={`Scan results for ${licenseData.firstName} ${licenseData.lastName}`}
            >
              <Text style={styles.resultTitle}>Scan Results</Text>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Name:</Text>
                <Text style={styles.resultValue}>
                  {licenseData.firstName} {licenseData.lastName}
                </Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>License #:</Text>
                <Text style={styles.resultValue}>
                  {licenseData.licenseNumber}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.resetButton}
                onPress={reset}
                accessible={true}
                accessibilityLabel="Clear scan results"
                accessibilityRole="button"
              >
                <Text style={styles.resetButtonText}>Clear Results</Text>
              </TouchableOpacity>
            </View>
          )}

          {error && (
            <View
              style={styles.errorCard}
              accessible={true}
              accessibilityLabel={`Error: ${error.userMessage}`}
              accessibilityRole="alert"
            >
              <Text style={styles.errorTitle}>Error</Text>
              <Text style={styles.errorMessage}>{error.userMessage}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => setShowCamera(true)}
                accessible={true}
                accessibilityLabel="Try scanning again"
                accessibilityRole="button"
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.cameraContainer}>
          <CameraScanner
            onLicenseScanned={handleScanComplete}
            onError={handleError}
            onCancel={() => setShowCamera(false)}
            accessibilityOptions={{
              voiceGuidance: voiceGuidanceEnabled,
              hapticFeedback: hapticFeedbackEnabled,
              highContrast: highContrastEnabled,
            }}
          />
          <TouchableOpacity
            style={[
              styles.cancelButton,
              highContrastEnabled && styles.cancelButtonHighContrast,
            ]}
            onPress={() => setShowCamera(false)}
            accessible={true}
            accessibilityLabel="Cancel scanning"
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.cancelButtonText,
                highContrastEnabled && styles.cancelButtonTextHighContrast,
              ]}
            >
              Cancel
            </Text>
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
  settingsCard: {
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
  settingsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingInfo: {
    flex: 1,
    marginRight: 15,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
  },
  screenReaderCard: {
    backgroundColor: '#4caf50',
    margin: 15,
    padding: 15,
    borderRadius: 10,
  },
  screenReaderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 5,
  },
  screenReaderText: {
    fontSize: 14,
    color: 'white',
    lineHeight: 20,
  },
  scanButton: {
    backgroundColor: '#2196F3',
    padding: 20,
    margin: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanButtonHighContrast: {
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#fff',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scanButtonTextHighContrast: {
    color: '#fff',
  },
  resultCard: {
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
  resultTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#4caf50',
  },
  resultRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  resultLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    width: 100,
  },
  resultValue: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  resetButton: {
    backgroundColor: '#f44336',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 15,
  },
  resetButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#ffebee',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f44336',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f44336',
    marginBottom: 10,
  },
  errorMessage: {
    fontSize: 16,
    color: '#c62828',
    marginBottom: 15,
  },
  retryButton: {
    backgroundColor: '#f44336',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  cancelButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 15,
    borderRadius: 8,
  },
  cancelButtonHighContrast: {
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#fff',
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButtonTextHighContrast: {
    color: '#fff',
  },
});

export default AccessibilityDemoScreen;
