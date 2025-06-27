import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import {
  AccessibleButton,
  AccessibleModeSelector,
  AccessibleResultField,
  AccessibleQualityIndicator,
} from './accessibility/AccessibleComponents';
import { AccessibilityGestureHelp } from './accessibility/AccessibilityGestures';
import {
  useAccessibilityFeatures,
  useScanningAccessibility,
} from '../hooks/useAccessibility';
import type { ScanMode } from '../types/license';

/**
 * Showcase component demonstrating all accessibility features
 * Use this to test and demonstrate accessibility capabilities
 */
const AccessibilityShowcase: React.FC = () => {
  const [currentMode, setCurrentMode] = useState<ScanMode>('auto');
  const [isScanning, setIsScanning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [testQuality, setTestQuality] = useState(0.5);
  const [highContrastOverride, setHighContrastOverride] = useState(false);
  
  const {
    isVoiceOverEnabled,
    announce,
    isHighContrast,
    dynamicType,
    isReducedMotion,
  } = useAccessibilityFeatures();
  
  const { announceQuality } = useScanningAccessibility({
    isScanning,
    currentMode,
    documentDetected: true,
  });
  
  const handleTestAnnouncement = () => {
    announce('This is a test announcement for VoiceOver');
  };
  
  const handleQualityTest = () => {
    const metrics = {
      overall: testQuality,
      positioning: {
        distance: 'optimal' as const,
        angle: 'straight' as const,
        documentDetected: true,
        inFrame: true,
      },
      lighting: {
        overall: 0.8,
        uniformity: 0.9,
        shadows: false,
        glare: false,
      },
      focus: {
        sharpness: 0.9,
        blurDetected: false,
      },
    };
    announceQuality(metrics);
  };
  
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { fontSize: dynamicType.fontSize(24) }]}>
          Accessibility Features Showcase
        </Text>
      </View>
      
      {/* System Status */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          System Status
        </Text>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>VoiceOver:</Text>
          <Text style={styles.statusValue}>
            {isVoiceOverEnabled ? 'Enabled' : 'Disabled'}
          </Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>High Contrast:</Text>
          <Text style={styles.statusValue}>
            {isHighContrast ? 'Enabled' : 'Disabled'}
          </Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Reduced Motion:</Text>
          <Text style={styles.statusValue}>
            {isReducedMotion ? 'Enabled' : 'Disabled'}
          </Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Font Scale:</Text>
          <Text style={styles.statusValue}>
            {dynamicType.fontScale.toFixed(2)}x
          </Text>
        </View>
      </View>
      
      {/* Accessible Buttons */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          Accessible Buttons
        </Text>
        
        <AccessibleButton
          label="Primary Button"
          hint="This is a primary action button"
          variant="primary"
          onPress={() => Alert.alert('Primary', 'Button pressed')}
        />
        
        <View style={styles.spacer} />
        
        <AccessibleButton
          label="Test Announcement"
          hint="Tap to test VoiceOver announcement"
          variant="secondary"
          onPress={handleTestAnnouncement}
        />
        
        <View style={styles.spacer} />
        
        <AccessibleButton
          label="Disabled Button"
          hint="This button is disabled"
          variant="danger"
          disabled={true}
          onPress={() => {}}
        />
      </View>
      
      {/* Mode Selector */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          Mode Selector
        </Text>
        
        <AccessibleModeSelector
          currentMode={currentMode}
          availableModes={['auto', 'barcode', 'ocr']}
          onModeChange={setCurrentMode}
        />
      </View>
      
      {/* Quality Indicator */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          Quality Indicator
        </Text>
        
        <AccessibleQualityIndicator
          quality={testQuality}
          qualityLevel={
            testQuality < 0.3 ? 'poor' : 
            testQuality < 0.7 ? 'good' : 'excellent'
          }
        />
        
        <View style={styles.qualityControls}>
          <AccessibleButton
            label="Poor Quality"
            hint="Set quality to poor"
            size="small"
            onPress={() => setTestQuality(0.2)}
          />
          <AccessibleButton
            label="Good Quality"
            hint="Set quality to good"
            size="small"
            onPress={() => setTestQuality(0.6)}
          />
          <AccessibleButton
            label="Excellent"
            hint="Set quality to excellent"
            size="small"
            onPress={() => setTestQuality(0.9)}
          />
        </View>
        
        <AccessibleButton
          label="Test Quality Announcement"
          hint="Announce current quality level"
          variant="secondary"
          onPress={handleQualityTest}
        />
      </View>
      
      {/* Result Fields */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          Result Fields
        </Text>
        
        <AccessibleResultField
          label="Name"
          value="John Doe"
          confidence={0.95}
        />
        
        <AccessibleResultField
          label="License Number"
          value="D123456789"
          confidence={0.88}
        />
        
        <AccessibleResultField
          label="Loading Field"
          isLoading={true}
        />
        
        <AccessibleResultField
          label="Error Field"
          hasError={true}
        />
      </View>
      
      {/* Gesture Help */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          Custom Gestures
        </Text>
        
        <AccessibleButton
          label="Show Gesture Help"
          hint="Display available accessibility gestures"
          onPress={() => setShowHelp(true)}
        />
        
        <AccessibilityGestureHelp
          visible={showHelp}
          onDismiss={() => setShowHelp(false)}
        />
      </View>
      
      {/* Test Controls */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { fontSize: dynamicType.fontSize(18) }]}>
          Test Controls
        </Text>
        
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Simulate Scanning:</Text>
          <Switch
            value={isScanning}
            onValueChange={setIsScanning}
            accessibilityLabel="Toggle scanning simulation"
            accessibilityRole="switch"
          />
        </View>
        
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>High Contrast Override:</Text>
          <Switch
            value={highContrastOverride}
            onValueChange={setHighContrastOverride}
            accessibilityLabel="Toggle high contrast override"
            accessibilityRole="switch"
          />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    padding: 20,
    backgroundColor: '#007AFF',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  section: {
    margin: 20,
    padding: 15,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  statusLabel: {
    fontSize: 16,
    color: '#666',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  spacer: {
    height: 10,
  },
  qualityControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 15,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  switchLabel: {
    fontSize: 16,
    color: '#333',
  },
});

export default AccessibilityShowcase;