import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
} from 'react-native';
import {
  useLicenseScanner,
  type DLScanError,
  type ErrorCode,
} from 'react-native-dl-scan';

interface ErrorScenariosScreenProps {
  navigation: any;
}

interface ErrorScenario {
  title: string;
  description: string;
  errorCode: ErrorCode;
  userMessage: string;
  recoverable: boolean;
  action: () => void;
}

const ErrorScenariosScreen: React.FC<ErrorScenariosScreenProps> = ({
  navigation,
}) => {
  const [activeError, setActiveError] = useState<DLScanError | null>(null);
  const { reset } = useLicenseScanner();

  const createMockError = (
    code: ErrorCode,
    message: string,
    recoverable: boolean
  ): DLScanError => ({
    code,
    userMessage: message,
    technicalMessage: `Technical: ${message}`,
    recoverable,
    context: { timestamp: new Date().toISOString() },
  });

  const scenarios: ErrorScenario[] = [
    {
      title: 'Camera Permission Denied',
      description: 'Simulates when the user denies camera permission access',
      errorCode: 'PERMISSION_DENIED',
      userMessage: 'Camera permission is required to scan licenses',
      recoverable: true,
      action: () => {
        const error = createMockError(
          'PERMISSION_DENIED',
          'Camera permission is required to scan licenses',
          true
        );
        setActiveError(error);
        Alert.alert('Permission Error', error.userMessage, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => Alert.alert('Would open app settings'),
          },
        ]);
      },
    },
    {
      title: 'Invalid License Format',
      description: 'When the scanned data cannot be parsed',
      errorCode: 'INVALID_LICENSE_FORMAT',
      userMessage: 'Unable to read license data. Please try again',
      recoverable: true,
      action: () => {
        const error = createMockError(
          'INVALID_LICENSE_FORMAT',
          'Unable to read license data. Please try again',
          true
        );
        setActiveError(error);
        Alert.alert('Format Error', error.userMessage, [{ text: 'OK' }]);
      },
    },
    {
      title: 'Scan Timeout',
      description: 'When scanning takes too long without success',
      errorCode: 'SCAN_TIMEOUT',
      userMessage: 'Scanning timed out. Please ensure good lighting',
      recoverable: true,
      action: () => {
        const error = createMockError(
          'SCAN_TIMEOUT',
          'Scanning timed out. Please ensure good lighting',
          true
        );
        setActiveError(error);
        Alert.alert('Timeout', error.userMessage, [{ text: 'Try Again' }]);
      },
    },
    {
      title: 'Camera Not Available',
      description: 'Device has no camera or camera is in use',
      errorCode: 'CAMERA_NOT_AVAILABLE',
      userMessage: 'Camera is not available on this device',
      recoverable: false,
      action: () => {
        const error = createMockError(
          'CAMERA_NOT_AVAILABLE',
          'Camera is not available on this device',
          false
        );
        setActiveError(error);
        Alert.alert('Camera Error', error.userMessage, [{ text: 'OK' }]);
      },
    },
    {
      title: 'Processing Error',
      description: 'Internal error during license processing',
      errorCode: 'PROCESSING_ERROR',
      userMessage: 'An error occurred while processing the license',
      recoverable: true,
      action: () => {
        const error = createMockError(
          'PROCESSING_ERROR',
          'An error occurred while processing the license',
          true
        );
        setActiveError(error);
        Alert.alert('Processing Error', error.userMessage, [
          { text: 'Report Issue' },
          { text: 'Try Again' },
        ]);
      },
    },
    {
      title: 'Unsupported License Type',
      description: 'License type not supported by the scanner',
      errorCode: 'UNSUPPORTED_LICENSE',
      userMessage: 'This license type is not supported',
      recoverable: false,
      action: () => {
        const error = createMockError(
          'UNSUPPORTED_LICENSE',
          'This license type is not supported',
          false
        );
        setActiveError(error);
        Alert.alert('Unsupported', error.userMessage, [
          { text: 'Learn More' },
          { text: 'OK' },
        ]);
      },
    },
  ];

  const getErrorIcon = (code: ErrorCode) => {
    switch (code) {
      case 'PERMISSION_DENIED':
        return '🚫';
      case 'INVALID_LICENSE_FORMAT':
        return '📄';
      case 'SCAN_TIMEOUT':
        return '⏱️';
      case 'CAMERA_NOT_AVAILABLE':
        return '📷';
      case 'PROCESSING_ERROR':
        return '⚙️';
      case 'UNSUPPORTED_LICENSE':
        return '❌';
      default:
        return '⚠️';
    }
  };

  const getErrorColor = (recoverable: boolean) => {
    return recoverable ? '#ff9800' : '#f44336';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Error Handling</Text>
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            Test various error scenarios to understand how the scanner handles
            different failure modes. Each scenario demonstrates proper error
            handling and recovery options.
          </Text>
        </View>

        {activeError && (
          <View
            style={[
              styles.activeErrorCard,
              { borderColor: getErrorColor(activeError.recoverable) },
            ]}
          >
            <Text style={styles.activeErrorTitle}>Active Error</Text>
            <Text style={styles.activeErrorCode}>
              {getErrorIcon(activeError.code)} {activeError.code}
            </Text>
            <Text style={styles.activeErrorMessage}>
              {activeError.userMessage}
            </Text>
            <View style={styles.errorMetadata}>
              <Text style={styles.metadataLabel}>Recoverable:</Text>
              <Text
                style={[
                  styles.metadataValue,
                  activeError.recoverable
                    ? styles.metadataValueRecoverable
                    : styles.metadataValueNonRecoverable,
                ]}
              >
                {activeError.recoverable ? 'Yes' : 'No'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.clearErrorButton}
              onPress={() => {
                setActiveError(null);
                reset();
              }}
            >
              <Text style={styles.clearErrorButtonText}>Clear Error</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.scenariosContainer}>
          {scenarios.map((scenario, index) => (
            <TouchableOpacity
              key={index}
              style={styles.scenarioCard}
              onPress={scenario.action}
            >
              <View style={styles.scenarioHeader}>
                <Text style={styles.scenarioIcon}>
                  {getErrorIcon(scenario.errorCode)}
                </Text>
                <Text style={styles.scenarioTitle}>{scenario.title}</Text>
              </View>
              <Text style={styles.scenarioDescription}>
                {scenario.description}
              </Text>
              <View style={styles.scenarioFooter}>
                <View
                  style={[
                    styles.recoverableBadge,
                    scenario.recoverable
                      ? styles.recoverableBadgePositive
                      : styles.recoverableBadgeNegative,
                  ]}
                >
                  <Text
                    style={[
                      styles.recoverableText,
                      scenario.recoverable
                        ? styles.recoverableTextPositive
                        : styles.recoverableTextNegative,
                    ]}
                  >
                    {scenario.recoverable ? 'Recoverable' : 'Non-recoverable'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bestPracticesCard}>
          <Text style={styles.bestPracticesTitle}>
            Error Handling Best Practices
          </Text>
          <View style={styles.practice}>
            <Text style={styles.practiceIcon}>✓</Text>
            <Text style={styles.practiceText}>
              Always provide clear, user-friendly error messages
            </Text>
          </View>
          <View style={styles.practice}>
            <Text style={styles.practiceIcon}>✓</Text>
            <Text style={styles.practiceText}>
              Distinguish between recoverable and non-recoverable errors
            </Text>
          </View>
          <View style={styles.practice}>
            <Text style={styles.practiceIcon}>✓</Text>
            <Text style={styles.practiceText}>
              Offer actionable recovery options when possible
            </Text>
          </View>
          <View style={styles.practice}>
            <Text style={styles.practiceIcon}>✓</Text>
            <Text style={styles.practiceText}>
              Log technical details for debugging while showing simple messages
              to users
            </Text>
          </View>
        </View>
      </ScrollView>
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
  activeErrorCard: {
    backgroundColor: 'white',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  activeErrorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  activeErrorCode: {
    fontSize: 20,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
  },
  activeErrorMessage: {
    fontSize: 16,
    color: '#333',
    marginBottom: 15,
  },
  errorMetadata: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  metadataLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 10,
  },
  metadataValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  metadataValueRecoverable: {
    color: '#4caf50',
  },
  metadataValueNonRecoverable: {
    color: '#f44336',
  },
  clearErrorButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  clearErrorButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  scenariosContainer: {
    padding: 15,
  },
  scenarioCard: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  scenarioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  scenarioIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  scenarioTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  scenarioDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  scenarioFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  recoverableBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  recoverableText: {
    fontSize: 12,
    fontWeight: '600',
  },
  recoverableBadgePositive: {
    backgroundColor: '#e8f5e9',
  },
  recoverableBadgeNegative: {
    backgroundColor: '#ffebee',
  },
  recoverableTextPositive: {
    color: '#4caf50',
  },
  recoverableTextNegative: {
    color: '#f44336',
  },
  bestPracticesCard: {
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
  bestPracticesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  practice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  practiceIcon: {
    fontSize: 16,
    color: '#4caf50',
    marginRight: 10,
    marginTop: 2,
  },
  practiceText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
    lineHeight: 20,
  },
});

export default ErrorScenariosScreen;
