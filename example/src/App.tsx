import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useLicenseScanner } from 'react-native-dl-scan';

export default function App() {
  const { licenseData, isScanning, error, scan, reset } = useLicenseScanner();

  const handleScan = () => {
    // Test with sample AAMVA data
    // In a real app, this would come from camera scanning
    const sampleBarcode = "SAMPLE_AAMVA_DATA_HERE";
    scan(sampleBarcode);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DL Scan Test</Text>
      
      <Button 
        title={isScanning ? "Scanning..." : "Test Scan"} 
        onPress={handleScan}
        disabled={isScanning}
      />
      
      {licenseData && (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>License Data:</Text>
          <Text>Name: {licenseData.firstName} {licenseData.lastName}</Text>
          <Text>License: {licenseData.licenseNumber}</Text>
          {licenseData.dateOfBirth && (
            <Text>DOB: {licenseData.dateOfBirth.toLocaleDateString()}</Text>
          )}
          {licenseData.address && (
            <Text>
              Address: {licenseData.address.street}, {licenseData.address.city}, {licenseData.address.state} {licenseData.address.postalCode}
            </Text>
          )}
          {licenseData.sex && <Text>Sex: {licenseData.sex}</Text>}
          {licenseData.height && <Text>Height: {licenseData.height}</Text>}
          {licenseData.weight && <Text>Weight: {licenseData.weight}</Text>}
        </View>
      )}
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.error}>{error.userMessage}</Text>
          <Text style={styles.errorCode}>Error Code: {error.code}</Text>
          {error.recoverable && (
            <Text style={styles.errorHint}>This error is recoverable - try again</Text>
          )}
        </View>
      )}
      
      <Button title="Reset" onPress={reset} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  result: {
    backgroundColor: '#f0f0f0',
    padding: 15,
    borderRadius: 8,
    marginVertical: 20,
    minWidth: '80%',
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 15,
    borderRadius: 8,
    marginVertical: 20,
    minWidth: '80%',
    borderColor: '#f44336',
    borderWidth: 1,
  },
  error: {
    color: '#f44336',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  errorCode: {
    color: '#666',
    fontSize: 12,
    marginBottom: 5,
  },
  errorHint: {
    color: '#4caf50',
    fontSize: 12,
    fontStyle: 'italic',
  },
});
