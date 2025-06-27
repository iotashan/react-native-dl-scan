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
  CameraScanner,
  useLicenseScanner,
  type LicenseData,
} from 'react-native-dl-scan';

interface BasicScanningScreenProps {
  navigation: any;
}

const BasicScanningScreen: React.FC<BasicScanningScreenProps> = ({
  navigation,
}) => {
  const [showCamera, setShowCamera] = useState(false);
  const { licenseData, error, reset } = useLicenseScanner();

  const handleScanComplete = (data: LicenseData) => {
    setShowCamera(false);
    Alert.alert(
      'Scan Successful',
      `Scanned license for ${data.firstName} ${data.lastName}`,
      [{ text: 'OK' }]
    );
  };

  const handleError = (scanError: Error) => {
    setShowCamera(false);
    Alert.alert('Scan Error', scanError.message, [{ text: 'OK' }]);
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return 'N/A';
    return date.toLocaleDateString();
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
            <Text style={styles.title}>Basic Scanning</Text>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              This demo shows basic driver license scanning with automatic mode
              detection. The scanner will automatically try PDF417 barcode
              first, then fall back to OCR if needed.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => setShowCamera(true)}
          >
            <Text style={styles.scanButtonText}>Start Scanning</Text>
          </TouchableOpacity>

          {licenseData && (
            <View style={styles.resultCard}>
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
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>DOB:</Text>
                <Text style={styles.resultValue}>
                  {formatDate(licenseData.dateOfBirth)}
                </Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Expires:</Text>
                <Text style={styles.resultValue}>
                  {formatDate(licenseData.expirationDate)}
                </Text>
              </View>
              {licenseData.address && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Address:</Text>
                  <Text style={styles.resultValue}>
                    {licenseData.address.street}, {licenseData.address.city},{' '}
                    {licenseData.address.state} {licenseData.address.postalCode}
                  </Text>
                </View>
              )}
              <TouchableOpacity style={styles.resetButton} onPress={reset}>
                <Text style={styles.resetButtonText}>Clear Results</Text>
              </TouchableOpacity>
            </View>
          )}

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Error</Text>
              <Text style={styles.errorMessage}>{error.userMessage}</Text>
              <Text style={styles.errorCode}>Code: {error.code}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => setShowCamera(true)}
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
          />
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
    marginBottom: 5,
  },
  errorCode: {
    fontSize: 14,
    color: '#666',
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
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default BasicScanningScreen;
