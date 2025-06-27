import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  AsyncStorage,
} from 'react-native';
import { type LicenseData } from 'react-native-dl-scan';

interface StoredLicense extends LicenseData {
  id: string;
  scannedAt: string;
  scanMode?: string;
}

interface HistoryScreenProps {
  navigation: any;
}

const STORAGE_KEY = '@dl_scan_history';

const HistoryScreen: React.FC<HistoryScreenProps> = ({ navigation }) => {
  const [history, setHistory] = useState<StoredLicense[]>([]);
  const [selectedLicense, setSelectedLicense] = useState<StoredLicense | null>(
    null
  );

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const storedData = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedData) {
        const parsedData = JSON.parse(storedData);
        // Convert date strings back to Date objects
        const licenses = parsedData.map((item: any) => ({
          ...item,
          dateOfBirth: item.dateOfBirth
            ? new Date(item.dateOfBirth)
            : undefined,
          expirationDate: item.expirationDate
            ? new Date(item.expirationDate)
            : undefined,
          issueDate: item.issueDate ? new Date(item.issueDate) : undefined,
        }));
        setHistory(licenses);
      }
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  const clearHistory = () => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to delete all scan history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(STORAGE_KEY);
              setHistory([]);
              setSelectedLicense(null);
              Alert.alert('Success', 'History cleared');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear history');
            }
          },
        },
      ]
    );
  };

  const deleteLicense = (id: string) => {
    Alert.alert(
      'Delete Entry',
      'Are you sure you want to delete this scan record?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedHistory = history.filter((item) => item.id !== id);
              await AsyncStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(updatedHistory)
              );
              setHistory(updatedHistory);
              if (selectedLicense?.id === id) {
                setSelectedLicense(null);
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to delete entry');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const exportHistory = () => {
    // In a real app, this would export to CSV or share via native sharing
    Alert.alert(
      'Export History',
      `Would export ${history.length} records to CSV format`,
      [{ text: 'OK' }]
    );
  };

  const generateMockHistory = async () => {
    const mockData: StoredLicense[] = [
      {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        licenseNumber: 'D123456789',
        dateOfBirth: new Date('1990-01-15'),
        expirationDate: new Date('2025-01-15'),
        issueDate: new Date('2021-01-15'),
        address: {
          street: '123 Main St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
        },
        scannedAt: new Date(Date.now() - 86400000).toISOString(),
        scanMode: 'barcode',
      },
      {
        id: '2',
        firstName: 'Jane',
        lastName: 'Smith',
        licenseNumber: 'S987654321',
        dateOfBirth: new Date('1985-06-20'),
        expirationDate: new Date('2024-06-20'),
        issueDate: new Date('2020-06-20'),
        address: {
          street: '456 Oak Ave',
          city: 'Chicago',
          state: 'IL',
          postalCode: '60601',
        },
        scannedAt: new Date(Date.now() - 172800000).toISOString(),
        scanMode: 'ocr',
      },
    ];

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mockData));
    loadHistory();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Scan History</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            View and manage your scan history. This demo shows how to store and
            retrieve license data locally on the device.
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={exportHistory}
            disabled={history.length === 0}
          >
            <Text style={styles.controlButtonText}>Export CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={clearHistory}
            disabled={history.length === 0}
          >
            <Text style={styles.controlButtonText}>Clear All</Text>
          </TouchableOpacity>
          {history.length === 0 && (
            <TouchableOpacity
              style={styles.controlButton}
              onPress={generateMockHistory}
            >
              <Text style={styles.controlButtonText}>Add Mock Data</Text>
            </TouchableOpacity>
          )}
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>📚</Text>
            <Text style={styles.emptyStateTitle}>No Scan History</Text>
            <Text style={styles.emptyStateText}>
              Scanned licenses will appear here
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.historyList}>
              {history.map((license) => (
                <TouchableOpacity
                  key={license.id}
                  style={[
                    styles.historyItem,
                    selectedLicense?.id === license.id &&
                      styles.historyItemSelected,
                  ]}
                  onPress={() => setSelectedLicense(license)}
                >
                  <View style={styles.historyItemHeader}>
                    <Text style={styles.historyItemName}>
                      {license.firstName} {license.lastName}
                    </Text>
                    <Text style={styles.historyItemMode}>
                      {license.scanMode?.toUpperCase() || 'AUTO'}
                    </Text>
                  </View>
                  <Text style={styles.historyItemLicense}>
                    {license.licenseNumber}
                  </Text>
                  <Text style={styles.historyItemDate}>
                    {formatDate(license.scannedAt)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedLicense && (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>License Details</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Name:</Text>
                  <Text style={styles.detailValue}>
                    {selectedLicense.firstName} {selectedLicense.lastName}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>License #:</Text>
                  <Text style={styles.detailValue}>
                    {selectedLicense.licenseNumber}
                  </Text>
                </View>
                {selectedLicense.dateOfBirth && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>DOB:</Text>
                    <Text style={styles.detailValue}>
                      {selectedLicense.dateOfBirth.toLocaleDateString()}
                    </Text>
                  </View>
                )}
                {selectedLicense.expirationDate && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Expires:</Text>
                    <Text style={styles.detailValue}>
                      {selectedLicense.expirationDate.toLocaleDateString()}
                    </Text>
                  </View>
                )}
                {selectedLicense.address && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Address:</Text>
                    <Text style={styles.detailValue}>
                      {selectedLicense.address.street},{' '}
                      {selectedLicense.address.city},{' '}
                      {selectedLicense.address.state}{' '}
                      {selectedLicense.address.postalCode}
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => deleteLicense(selectedLicense.id)}
                >
                  <Text style={styles.deleteButtonText}>Delete Entry</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        <View style={styles.storageInfo}>
          <Text style={styles.storageInfoTitle}>Storage Information</Text>
          <Text style={styles.storageInfoText}>
            • Data is stored locally using AsyncStorage
          </Text>
          <Text style={styles.storageInfoText}>
            • History persists between app launches
          </Text>
          <Text style={styles.storageInfoText}>
            • Consider encryption for production use
          </Text>
          <Text style={styles.storageInfoText}>
            • Implement data retention policies
          </Text>
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
  content: {
    flexGrow: 1,
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
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: 15,
    marginBottom: 15,
  },
  controlButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  controlButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyStateIcon: {
    fontSize: 60,
    marginBottom: 20,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
  },
  historyList: {
    padding: 15,
  },
  historyItem: {
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
  historyItemSelected: {
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  historyItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  historyItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  historyItemMode: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2196F3',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyItemLicense: {
    fontSize: 14,
    color: '#666',
    marginBottom: 3,
  },
  historyItemDate: {
    fontSize: 12,
    color: '#999',
  },
  detailCard: {
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
  detailTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    width: 80,
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  deleteButton: {
    backgroundColor: '#f44336',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 15,
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  storageInfo: {
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
  storageInfoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  storageInfoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 20,
  },
});

export default HistoryScreen;
