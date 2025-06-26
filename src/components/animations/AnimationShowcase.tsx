import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import {
  FeedbackAnimation,
  SuccessAnimation,
  ErrorAnimation,
  type FeedbackAnimationRef,
} from './FeedbackAnimations';
import ModeTransitionAnimation, {
  type ModeTransitionAnimationRef,
} from './ModeTransitionAnimation';
import ScanningOverlayAnimations, {
  type ScanningOverlayAnimationsRef,
} from './ScanningOverlayAnimations';
import GestureAnimations, {
  type GestureAnimationsRef,
} from './GestureAnimations';
import type { ScanMode } from '../../types/license';

/**
 * Animation Showcase Component
 * Demonstrates all available animations and their interactions
 * Useful for testing, development, and showcasing capabilities
 */
const AnimationShowcase: React.FC = () => {
  // Animation refs
  const feedbackRef = useRef<FeedbackAnimationRef>(null);
  const successRef = useRef<FeedbackAnimationRef>(null);
  const errorRef = useRef<FeedbackAnimationRef>(null);
  const modeTransitionRef = useRef<ModeTransitionAnimationRef>(null);
  const scanningOverlayRef = useRef<ScanningOverlayAnimationsRef>(null);
  const gestureRef = useRef<GestureAnimationsRef>(null);

  // Component state
  const [currentMode, setCurrentMode] = useState<ScanMode>('auto');
  const [isScanning, setIsScanning] = useState(false);
  const [scanQuality, setScanQuality] = useState<'poor' | 'good' | 'excellent'>(
    'poor'
  );
  const [gestureInfo, setGestureInfo] = useState({ scale: 1, x: 0, y: 0 });

  // Available scan modes for demo
  const scanModes: ScanMode[] = ['auto', 'barcode', 'ocr'];
  const qualityLevels: Array<'poor' | 'good' | 'excellent'> = [
    'poor',
    'good',
    'excellent',
  ];

  const handleModeTransition = (mode: ScanMode) => {
    setCurrentMode(mode);
    modeTransitionRef.current?.transitionToMode(mode);
  };

  const handleScanningToggle = () => {
    const newScanningState = !isScanning;
    setIsScanning(newScanningState);

    if (newScanningState) {
      scanningOverlayRef.current?.startScanning();
    } else {
      scanningOverlayRef.current?.stopScanning();
    }
  };

  const handleQualityChange = () => {
    const currentIndex = qualityLevels.indexOf(scanQuality);
    const nextIndex = (currentIndex + 1) % qualityLevels.length;
    const newQuality = qualityLevels[nextIndex] || 'poor';

    setScanQuality(newQuality);
    scanningOverlayRef.current?.updateQualityIndicator(newQuality);
  };

  const handleDocumentDetected = () => {
    scanningOverlayRef.current?.showDocumentDetected();
  };

  const handleGestureChange = (type: 'zoom' | 'pan', ...args: number[]) => {
    if (type === 'zoom') {
      setGestureInfo((prev) => ({ ...prev, scale: args[0] || 1 }));
    } else if (type === 'pan') {
      setGestureInfo((prev) => ({ ...prev, x: args[0] || 0, y: args[1] || 0 }));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Animation Showcase</Text>

        {/* Feedback Animations Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Feedback Animations</Text>

          <View style={styles.demoContainer}>
            <FeedbackAnimation ref={feedbackRef}>
              <View style={styles.demoBox}>
                <Text style={styles.demoText}>Combined Feedback</Text>
              </View>
            </FeedbackAnimation>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.successButton]}
              onPress={() => feedbackRef.current?.playSuccess()}
            >
              <Text style={styles.buttonText}>Success</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.errorButton]}
              onPress={() => feedbackRef.current?.playError()}
            >
              <Text style={styles.buttonText}>Error</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.neutralButton]}
              onPress={() => feedbackRef.current?.reset()}
            >
              <Text style={styles.buttonText}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/* Individual Animation Components */}
          <View style={styles.splitDemo}>
            <View style={styles.halfDemo}>
              <SuccessAnimation ref={successRef}>
                <View style={[styles.demoBox, styles.smallBox]}>
                  <Text style={styles.smallText}>Success Only</Text>
                </View>
              </SuccessAnimation>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.successButton,
                  styles.smallButton,
                ]}
                onPress={() => successRef.current?.playSuccess()}
              >
                <Text style={styles.buttonText}>Play</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.halfDemo}>
              <ErrorAnimation ref={errorRef}>
                <View style={[styles.demoBox, styles.smallBox]}>
                  <Text style={styles.smallText}>Error Only</Text>
                </View>
              </ErrorAnimation>
              <TouchableOpacity
                style={[styles.button, styles.errorButton, styles.smallButton]}
                onPress={() => errorRef.current?.playError()}
              >
                <Text style={styles.buttonText}>Play</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Mode Transition Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mode Transitions</Text>
          <Text style={styles.currentMode}>Current Mode: {currentMode}</Text>

          <View style={styles.demoContainer}>
            <ModeTransitionAnimation
              ref={modeTransitionRef}
              onTransitionComplete={(mode) =>
                console.log('Transitioned to:', mode)
              }
            >
              <View style={styles.demoBox}>
                <Text style={styles.demoText}>Mode: {currentMode}</Text>
              </View>
            </ModeTransitionAnimation>
          </View>

          <View style={styles.buttonRow}>
            {scanModes.map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.button,
                  styles.modeButton,
                  currentMode === mode && styles.activeModeButton,
                ]}
                onPress={() => handleModeTransition(mode)}
              >
                <Text
                  style={[
                    styles.buttonText,
                    currentMode === mode && styles.activeButtonText,
                  ]}
                >
                  {mode}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Scanning Overlay Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scanning Overlay</Text>
          <Text style={styles.status}>
            Status: {isScanning ? 'Scanning' : 'Idle'} | Quality: {scanQuality}
          </Text>

          <View style={styles.overlayContainer}>
            <ScanningOverlayAnimations
              ref={scanningOverlayRef}
              isScanning={isScanning}
              onDocumentDetected={() => console.log('Document detected!')}
            />
            <View style={styles.overlayContent}>
              <Text style={styles.overlayText}>Scanning Area</Text>
            </View>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.button,
                isScanning ? styles.errorButton : styles.successButton,
              ]}
              onPress={handleScanningToggle}
            >
              <Text style={styles.buttonText}>
                {isScanning ? 'Stop Scan' : 'Start Scan'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.neutralButton]}
              onPress={handleQualityChange}
            >
              <Text style={styles.buttonText}>Quality: {scanQuality}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.neutralButton]}
              onPress={handleDocumentDetected}
            >
              <Text style={styles.buttonText}>Detect Doc</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Gesture Animations Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gesture Interactions</Text>
          <Text style={styles.gestureInfo}>
            Scale: {gestureInfo.scale.toFixed(2)} | Pan: (
            {gestureInfo.x.toFixed(0)}, {gestureInfo.y.toFixed(0)})
          </Text>

          <View style={styles.gestureContainer}>
            <GestureAnimations
              ref={gestureRef}
              onZoomChange={(scale) => handleGestureChange('zoom', scale)}
              onPanChange={(x, y) => handleGestureChange('pan', x, y)}
              onTap={() => console.log('Single tap')}
              onDoubleTap={() => console.log('Double tap - reset')}
              minZoom={0.5}
              maxZoom={3}
            >
              <View style={styles.gestureBox}>
                <Text style={styles.gestureText}>
                  Pinch to zoom{'\n'}
                  Drag to pan{'\n'}
                  Double tap to reset
                </Text>
              </View>
            </GestureAnimations>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.neutralButton]}
              onPress={() => gestureRef.current?.zoomTo(2)}
            >
              <Text style={styles.buttonText}>Zoom 2x</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.neutralButton]}
              onPress={() => gestureRef.current?.resetTransform()}
            >
              <Text style={styles.buttonText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            All animations respect accessibility settings and reduced motion
            preferences.
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
  scrollView: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
    color: '#333',
  },
  section: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  demoContainer: {
    height: 100,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  demoBox: {
    flex: 1,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  demoText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  splitDemo: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  halfDemo: {
    flex: 1,
    alignItems: 'center',
  },
  smallBox: {
    height: 60,
  },
  smallText: {
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 60,
  },
  successButton: {
    backgroundColor: '#4CAF50',
  },
  errorButton: {
    backgroundColor: '#F44336',
  },
  neutralButton: {
    backgroundColor: '#2196F3',
  },
  modeButton: {
    backgroundColor: '#9E9E9E',
  },
  activeModeButton: {
    backgroundColor: '#FF9800',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  activeButtonText: {
    color: 'white',
  },
  currentMode: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  overlayContainer: {
    height: 200,
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 12,
    position: 'relative',
  },
  overlayContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: {
    color: 'white',
    fontSize: 16,
  },
  gestureContainer: {
    height: 200,
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  gestureBox: {
    flex: 1,
    backgroundColor: '#9C27B0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gestureText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  gestureInfo: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  footer: {
    padding: 16,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export default AnimationShowcase;
