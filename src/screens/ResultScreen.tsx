import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import type { LicenseData, ScanMode } from '../types/license';
import { formatDate, calculateAge } from '../utils/formatters';

// Local wrapper to ensure proper type handling
const formatDateLocal = (date: Date): string => formatDate(date);
const calculateAgeLocal = (date: Date): number | null => calculateAge(date);

// Result data structure from task specification
export interface ScanResult {
  mode: ScanMode;
  data: LicenseData;
  confidence?: ConfidenceScores;
  timestamp: number;
}

export interface ConfidenceScores {
  overall: number;
  fields: Record<string, number>;
}

export interface ResultScreenProps {
  scanResult: ScanResult;
  onRescan: () => void;
  onDone: () => void;
  onReportIssue?: () => void;
}

// Individual data section components
const PersonalInfoSection: React.FC<{ data: LicenseData }> = ({ data }) => {
  const fullName = [data.firstName, data.middleName, data.lastName]
    .filter(Boolean)
    .join(' ');

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Personal Information</Text>
      <DataField label="Full Name" value={fullName} />
      <DataField
        label="Date of Birth"
        value={
          data.dateOfBirth
            ? `${formatDateLocal(data.dateOfBirth)}${data.dateOfBirth ? ` (Age: ${calculateAgeLocal(data.dateOfBirth) ?? 'Unknown'})` : ''}`
            : undefined
        }
      />
      <DataField label="Gender" value={data.sex} />
    </View>
  );
};

const AddressSection: React.FC<{ data: LicenseData }> = ({ data }) => {
  const formatAddress = (): string => {
    const parts = [
      data.address?.street,
      data.address?.city,
      data.address?.state,
      data.address?.postalCode,
    ].filter(Boolean);

    return parts.join(', ');
  };

  const formattedAddress = formatAddress();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Address</Text>
      <DataField
        label="Address"
        value={formattedAddress || undefined}
        multiline
      />
    </View>
  );
};

const LicenseDetailsSection: React.FC<{ data: LicenseData }> = ({ data }) => {
  const isExpired = (expiryDate?: string | Date): boolean => {
    if (!expiryDate) return false;

    try {
      const date =
        typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
      return date < new Date();
    } catch {
      return false;
    }
  };

  const expiryStatus = data.expirationDate
    ? isExpired(data.expirationDate)
      ? ' (EXPIRED)'
      : ' (Valid)'
    : '';

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>License Details</Text>
      <DataField label="License Number" value={data.licenseNumber} />
      <DataField label="Class" value={data.licenseClass} />
      <DataField label="Restrictions" value={data.restrictions} />
      <DataField label="Endorsements" value={data.endorsements} />
      <DataField
        label="Issue Date"
        value={data.issueDate ? formatDateLocal(data.issueDate) : undefined}
      />
      <DataField
        label="Expiry Date"
        value={
          data.expirationDate
            ? `${formatDateLocal(data.expirationDate)}${expiryStatus}`
            : undefined
        }
        isError={data.expirationDate ? isExpired(data.expirationDate) : false}
      />
    </View>
  );
};

const PhysicalDescriptionSection: React.FC<{ data: LicenseData }> = ({
  data,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  if (!data.height && !data.weight && !data.eyeColor && !data.hairColor) {
    return null;
  }

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={() => setIsExpanded(!isExpanded)}
        accessibilityRole="button"
        accessibilityLabel={`Physical Description, ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        <Text style={styles.sectionTitle}>Physical Description</Text>
        <Text style={styles.expandIcon}>{isExpanded ? '−' : '+'}</Text>
      </TouchableOpacity>

      {isExpanded && (
        <View>
          <DataField label="Height" value={data.height} />
          <DataField label="Weight" value={data.weight} />
          <DataField label="Eye Color" value={data.eyeColor} />
          <DataField label="Hair Color" value={data.hairColor} />
        </View>
      )}
    </View>
  );
};

const DocumentMetadataSection: React.FC<{ scanResult: ScanResult }> = ({
  scanResult,
}) => {
  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const getModeDisplay = (mode: ScanMode): string => {
    switch (mode) {
      case 'barcode':
        return 'PDF417 Barcode';
      case 'ocr':
        return 'OCR Text Recognition';
      case 'auto':
        return 'Automatic Detection';
      default:
        return mode;
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Scan Information</Text>
      <DataField label="Scan Mode" value={getModeDisplay(scanResult.mode)} />
      <DataField
        label="Scanned At"
        value={formatTimestamp(scanResult.timestamp)}
      />
      {scanResult.confidence && (
        <DataField
          label="Confidence"
          value={`${Math.round(scanResult.confidence.overall * 100)}%`}
        />
      )}
    </View>
  );
};

// Data field component with confidence indicators
const DataField: React.FC<{
  label: string;
  value?: string;
  multiline?: boolean;
  isError?: boolean;
  confidence?: number;
}> = ({ label, value, multiline = false, isError = false, confidence }) => {
  if (!value || value.trim() === '') {
    return (
      <View style={styles.dataField}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, styles.emptyValue]}>Not provided</Text>
      </View>
    );
  }

  return (
    <View style={styles.dataField}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          multiline && styles.multilineValue,
          isError && styles.errorValue,
        ]}
      >
        {value}
      </Text>
      {confidence !== undefined && (
        <View style={styles.confidenceIndicator}>
          <View
            style={[
              styles.confidenceBar,
              {
                width: `${confidence * 100}%`,
                backgroundColor:
                  confidence > 0.8
                    ? '#4CAF50'
                    : confidence > 0.6
                      ? '#FF9800'
                      : '#F44336',
              },
            ]}
          />
        </View>
      )}
    </View>
  );
};

// Main ResultScreen component
export const ResultScreen: React.FC<ResultScreenProps> = ({
  scanResult,
  onRescan,
  onDone,
  onReportIssue,
}) => {
  const handleReportIssue = () => {
    if (onReportIssue) {
      onReportIssue();
    } else {
      Alert.alert('Report Issue', 'This feature is not yet implemented.', [
        { text: 'OK' },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.headerTitle}>Scan Complete</Text>
          <Text style={styles.headerSubtitle}>
            Scanned using {scanResult.mode} mode
          </Text>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <PersonalInfoSection data={scanResult.data} />
        <AddressSection data={scanResult.data} />
        <LicenseDetailsSection data={scanResult.data} />
        <PhysicalDescriptionSection data={scanResult.data} />
        <DocumentMetadataSection scanResult={scanResult} />
      </ScrollView>

      {/* Action Bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={onRescan}
          accessibilityRole="button"
          accessibilityLabel="Scan another license"
        >
          <Text style={styles.secondaryButtonText}>Rescan</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Finish and return"
        >
          <Text style={styles.primaryButtonText}>Done</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.tertiaryButton]}
          onPress={handleReportIssue}
          accessibilityRole="button"
          accessibilityLabel="Report an issue with this scan"
        >
          <Text style={styles.tertiaryButtonText}>Report Issue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#4CAF50',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  headerContent: {
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#E8F5E8',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100, // Space for action bar
  },
  section: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E1E5E9',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 16,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  expandIcon: {
    fontSize: 20,
    color: '#666666',
    fontWeight: 'bold',
  },
  dataField: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666666',
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    color: '#1A1A1A',
    lineHeight: 22,
  },
  multilineValue: {
    lineHeight: 24,
  },
  emptyValue: {
    color: '#999999',
    fontStyle: 'italic',
  },
  errorValue: {
    color: '#F44336',
  },
  confidenceIndicator: {
    height: 3,
    backgroundColor: '#E1E5E9',
    borderRadius: 1.5,
    marginTop: 4,
    overflow: 'hidden',
  },
  confidenceBar: {
    height: '100%',
    borderRadius: 1.5,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#E1E5E9',
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '500',
  },
  tertiaryButton: {
    backgroundColor: 'transparent',
  },
  tertiaryButtonText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default ResultScreen;
