import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { scanLicense } from 'react-native-dl-scan';
import { useState } from 'react';

export default function App() {
  const [scanResult, setScanResult] = useState<string>('Tap to scan license');

  const handleScan = async () => {
    try {
      const result = await scanLicense();
      if (result.success && result.data) {
        setScanResult(
          `Scanned: ${result.data.firstName || 'Unknown'} ${result.data.lastName || ''}`
        );
      } else if (result.error) {
        setScanResult(`Error: ${result.error.userMessage}`);
      }
    } catch (error) {
      setScanResult(`Error: ${error}`);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={handleScan}>
        <Text style={styles.buttonText}>Scan License</Text>
      </TouchableOpacity>
      <Text style={styles.result}>{scanResult}</Text>
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
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 20,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  result: {
    fontSize: 14,
    textAlign: 'center',
    color: '#333',
  },
});
