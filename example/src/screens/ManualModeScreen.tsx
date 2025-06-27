import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
  SegmentedControlIOS,
  Platform,
} from 'react-native';
import {
  CameraScanner,
  useLicenseScanner,
  type LicenseData,
  type ScanMode,
} from 'react-native-dl-scan';

interface ManualModeScreenProps {
  navigation: any;
}

const ManualModeScreen: React.FC<ManualModeScreenProps> = ({ navigation }) => {
  const [showCamera, setShowCamera] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ScanMode>('barcode');
  const { licenseData, error, reset } = useLicenseScanner();

  const handleScanComplete = (data: LicenseData) => {
    setShowCamera(false);
    Alert.alert(
      'Scan Successful',
      `Scanned license for ${data.firstName} ${data.lastName} using ${selectedMode.toUpperCase()} mode`,
      [{ text: 'OK' }]
    );
  };

  const handleError = (scanError: Error) => {
    setShowCamera(false);
    Alert.alert('Scan Error', scanError.message, [{ text: 'OK' }]);
  };

  const renderModeSelector = () => {
    if (Platform.OS === 'ios') {
      return (
        <SegmentedControlIOS
          values={['Barcode', 'OCR']}
          selectedIndex={selectedMode === 'barcode' ? 0 : 1}
          onChange={(event) => {
            const index = event.nativeEvent.selectedSegmentIndex;
            setSelectedMode(index === 0 ? 'barcode' : 'ocr');
          }}
          style={styles.segmentedControl}
        />
      );
    }

    return (
      <View style={styles.modeButtons}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            selectedMode === 'barcode' && styles.modeButtonActive,
          ]}
          onPress={() => setSelectedMode('barcode')}
        >
          <Text
            style={[
              styles.modeButtonText,
              selectedMode === 'barcode' && styles.modeButtonTextActive,
            ]}
          >
            Barcode
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            selectedMode === 'ocr' && styles.modeButtonActive,
          ]}
          onPress={() => setSelectedMode('ocr')}
        >
          <Text
            style={[
              styles.modeButtonText,
              selectedMode === 'ocr' && styles.modeButtonTextActive,
            ]}
          >
            OCR
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const getModeDescription = () => {
    if (selectedMode === 'barcode') {
      return 'Barcode mode reads the PDF417 barcode on the back of most US driver licenses. This is the fastest and most accurate method when available.';
    }
    return 'OCR mode extracts text from the front of the license using optical character recognition. Use this for licenses without barcodes or when barcode scanning fails.';
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
            <Text style={styles.title}>Manual Mode Selection</Text>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              Choose your preferred scanning mode. You can switch between
              barcode and OCR scanning based on your needs.
            </Text>
          </View>

          <View style={styles.modeSelectorContainer}>
            <Text style={styles.modeSelectorTitle}>Select Scanning Mode:</Text>
            {renderModeSelector()}
          </View>

          <View style={styles.modeDescription}>
            <Text style={styles.modeDescriptionText}>
              {getModeDescription()}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => setShowCamera(true)}
          >
            <Text style={styles.scanButtonText}>
              Start {selectedMode === 'barcode' ? 'Barcode' : 'OCR'} Scan
            </Text>
          </TouchableOpacity>

          {licenseData && (
            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>Scan Results</Text>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Mode Used:</Text>
                <Text style={styles.resultValue}>
                  {selectedMode.toUpperCase()}
                </Text>
              </View>
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
              <TouchableOpacity style={styles.resetButton} onPress={reset}>
                <Text style={styles.resetButtonText}>Clear Results</Text>
              </TouchableOpacity>
            </View>
          )}

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Error</Text>
              <Text style={styles.errorMessage}>{error.userMessage}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => setShowCamera(true)}
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.switchModeButton}
                onPress={() => {
                  setSelectedMode(
                    selectedMode === 'barcode' ? 'ocr' : 'barcode'
                  );
                  setShowCamera(true);
                }}
              >
                <Text style={styles.switchModeButtonText}>
                  Try {selectedMode === 'barcode' ? 'OCR' : 'Barcode'} Mode
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.cameraContainer}>
          <CameraScanner
            mode={selectedMode}
            onLicenseScanned={handleScanComplete}
            onError={handleError}
            onCancel={() => setShowCamera(false)}
          />
          <View style={styles.modeIndicator}>
            <Text style={styles.modeText}>
              {selectedMode === 'barcode' ? '📊' : '📝'}{' '}
              {selectedMode.toUpperCase()} Mode
            </Text>
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
  modeSelectorContainer: {
    margin: 15,
    padding: 20,
    backgroundColor: 'white',
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
  modeSelectorTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333',
  },
  segmentedControl: {
    height: 40,
  },
  modeButtons: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  modeButtonActive: {
    backgroundColor: '#2196F3',
  },
  modeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2196F3',
  },
  modeButtonTextActive: {
    color: 'white',
  },
  modeDescription: {
    marginHorizontal: 15,
    padding: 15,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  modeDescriptionText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
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
    marginBottom: 15,
  },
  retryButton: {
    backgroundColor: '#f44336',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 10,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  switchModeButton: {
    backgroundColor: '#ff9800',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  switchModeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  modeIndicator: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    padding: 15,
    borderRadius: 8,
  },
  modeText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
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

export default ManualModeScreen;
