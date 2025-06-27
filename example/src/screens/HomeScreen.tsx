import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
} from 'react-native';

interface HomeScreenProps {
  navigation: any;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const features = [
    {
      title: 'Basic Scanning',
      description: 'Simple barcode scanning with automatic mode selection',
      screen: 'BasicScanning',
      icon: '📷',
    },
    {
      title: 'Intelligent Mode',
      description: 'Automatic switching between PDF417 and OCR modes',
      screen: 'IntelligentMode',
      icon: '🤖',
    },
    {
      title: 'Manual Mode Selection',
      description: 'Choose between barcode and OCR scanning modes',
      screen: 'ManualMode',
      icon: '🎯',
    },
    {
      title: 'Quality Indicators',
      description: 'Real-time feedback on scan quality',
      screen: 'QualityDemo',
      icon: '📊',
    },
    {
      title: 'Accessibility Features',
      description: 'Voice guidance and haptic feedback',
      screen: 'AccessibilityDemo',
      icon: '♿',
    },
    {
      title: 'Error Handling',
      description: 'Test various error scenarios',
      screen: 'ErrorScenarios',
      icon: '⚠️',
    },
    {
      title: 'Performance Test',
      description: 'Measure scanning performance',
      screen: 'PerformanceTest',
      icon: '⚡',
    },
    {
      title: 'History & Storage',
      description: 'View scan history and storage examples',
      screen: 'History',
      icon: '📚',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>DL Scan Demo</Text>
          <Text style={styles.subtitle}>
            React Native Driver License Scanner
          </Text>
        </View>

        <View style={styles.featuresContainer}>
          {features.map((feature) => (
            <TouchableOpacity
              key={feature.screen}
              style={styles.featureCard}
              onPress={() => navigation.navigate(feature.screen)}
            >
              <Text style={styles.featureIcon}>{feature.icon}</Text>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>
                  {feature.description}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Tap any feature to explore its capabilities
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
    padding: 20,
    backgroundColor: '#2196F3',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  featuresContainer: {
    padding: 15,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
  featureIcon: {
    fontSize: 30,
    marginRight: 15,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 3,
  },
  featureDescription: {
    fontSize: 14,
    color: '#666',
  },
  chevron: {
    fontSize: 24,
    color: '#999',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
});

export default HomeScreen;
