import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
  Platform,
  AccessibilityInfo,
  Vibration,
  useColorScheme,
} from 'react-native';
import type { ScanMode } from '../types/license';

export interface ModeSelectorProps {
  currentMode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  disabled?: boolean;
}

const MODES: ScanMode[] = ['auto', 'barcode', 'ocr'];
const MODE_LABELS: Record<ScanMode, string> = {
  auto: 'Auto',
  barcode: 'Barcode',
  ocr: 'OCR',
};

const MODE_DESCRIPTIONS: Record<ScanMode, string> = {
  auto: 'Automatically selects best method',
  barcode: 'Fast PDF417 barcode scanning',
  ocr: 'Text recognition for front of license',
};

const MODE_COLORS: Record<ScanMode, string> = {
  auto: '#007AFF',
  barcode: '#34C759',
  ocr: '#5856D6',
};

// Move dimensions calculation inside component to avoid test issues
const getScreenDimensions = () => {
  const { width: screenWidth } = Dimensions.get('window');
  return {
    SELECTOR_WIDTH: screenWidth - 40,
    ITEM_WIDTH: (screenWidth - 40) / 3,
  };
};

// Simple icon components
const AutoIcon: React.FC<{ color: string }> = ({ color }) => (
  <View style={styles.iconContainer}>
    <Text style={[styles.iconText, { color }]}>A</Text>
  </View>
);

const BarcodeIcon: React.FC<{ color: string }> = ({ color }) => (
  <View style={styles.iconContainer}>
    <View style={[styles.barcodeBar, { backgroundColor: color }]} />
    <View
      style={[
        styles.barcodeBar,
        styles.barcodeBarThin,
        { backgroundColor: color },
      ]}
    />
    <View style={[styles.barcodeBar, { backgroundColor: color }]} />
    <View
      style={[
        styles.barcodeBar,
        styles.barcodeBarThin,
        { backgroundColor: color },
      ]}
    />
    <View style={[styles.barcodeBar, { backgroundColor: color }]} />
  </View>
);

const OCRIcon: React.FC<{ color: string }> = ({ color }) => (
  <View style={styles.iconContainer}>
    <Text style={[styles.iconText, { color }]}>T</Text>
  </View>
);

const MODE_ICONS: Record<ScanMode, React.FC<{ color: string }>> = {
  auto: AutoIcon,
  barcode: BarcodeIcon,
  ocr: OCRIcon,
};

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  currentMode,
  onModeChange,
  disabled = false,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [showDescription, setShowDescription] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';

  // Get screen dimensions
  const dimensions = useMemo(() => getScreenDimensions(), []);
  const { SELECTOR_WIDTH, ITEM_WIDTH } = dimensions;

  // Calculate initial position based on current mode
  const currentModeIndex = useMemo(
    () => MODES.indexOf(currentMode),
    [currentMode]
  );

  // Update position when mode changes
  useEffect(() => {
    const targetX = currentModeIndex * ITEM_WIDTH;
    Animated.spring(translateX, {
      toValue: targetX,
      tension: 65,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [currentModeIndex, translateX, ITEM_WIDTH]);

  // Handle mode selection
  const selectMode = useCallback(
    (mode: ScanMode) => {
      if (disabled) return;

      // Haptic feedback
      if (Platform.OS === 'ios') {
        Vibration.vibrate(10);
      }

      // Announce for accessibility
      AccessibilityInfo.announceForAccessibility(
        `Switched to ${MODE_LABELS[mode]} mode. ${MODE_DESCRIPTIONS[mode]}`
      );

      onModeChange(mode);
    },
    [disabled, onModeChange]
  );

  // Pan responder for swipe gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return !disabled && Math.abs(gestureState.dx) > 5;
      },
      onPanResponderGrant: () => {
        Animated.spring(scaleAnim, {
          toValue: 0.95,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderMove: (_, gestureState) => {
        const currentX = currentModeIndex * ITEM_WIDTH;
        const newX = currentX + gestureState.dx;

        // Constrain movement within bounds
        const constrainedX = Math.max(
          0,
          Math.min(newX, (MODES.length - 1) * ITEM_WIDTH)
        );
        translateX.setValue(constrainedX);
      },
      onPanResponderRelease: (_, gestureState) => {
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
        }).start();

        // Calculate which mode to snap to
        const currentX = currentModeIndex * ITEM_WIDTH + gestureState.dx;
        const targetIndex = Math.round(currentX / ITEM_WIDTH);
        const constrainedIndex = Math.max(
          0,
          Math.min(targetIndex, MODES.length - 1)
        );

        if (constrainedIndex !== currentModeIndex) {
          const newMode = MODES[constrainedIndex];
          if (newMode) {
            selectMode(newMode);
          }
        } else {
          // Snap back to current position
          Animated.spring(translateX, {
            toValue: currentModeIndex * ITEM_WIDTH,
            tension: 65,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Handle long press for descriptions
  const handleLongPress = useCallback((mode: ScanMode) => {
    longPressTimer.current = setTimeout(() => {
      setShowDescription(true);
      AccessibilityInfo.announceForAccessibility(MODE_DESCRIPTIONS[mode]);

      // Hide description after 2 seconds
      setTimeout(() => setShowDescription(false), 2000);
    }, 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <View
        style={[
          styles.selector,
          { width: SELECTOR_WIDTH },
          isDarkMode && styles.selectorDark,
        ]}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={`Mode selector, current mode is ${MODE_LABELS[currentMode]}`}
        accessibilityHint="Swipe left or right to change scanning mode"
      >
        {/* Background track */}
        <View style={[styles.track, isDarkMode && styles.trackDark]} />

        {/* Active indicator */}
        <Animated.View
          style={[
            styles.activeIndicator,
            {
              width: ITEM_WIDTH - 8,
              transform: [{ translateX }, { scale: scaleAnim }],
              backgroundColor: MODE_COLORS[currentMode],
            },
          ]}
        />

        {/* Mode items */}
        <View style={styles.modesContainer}>
          {MODES.map((mode) => {
            const Icon = MODE_ICONS[mode];
            const isActive = mode === currentMode;
            const iconColor = isActive
              ? 'white'
              : isDarkMode
                ? 'rgba(255, 255, 255, 0.6)'
                : 'rgba(0, 0, 0, 0.6)';

            return (
              <TouchableOpacity
                key={mode}
                style={styles.modeItem}
                onPress={() => selectMode(mode)}
                onLongPress={() => handleLongPress(mode)}
                onPressOut={cancelLongPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`${MODE_LABELS[mode]} mode`}
                accessibilityHint={MODE_DESCRIPTIONS[mode]}
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.modeContent}>
                  <Icon color={iconColor} />
                  <Animated.Text
                    style={[
                      styles.modeText,
                      isActive && styles.activeModeText,
                      isDarkMode && styles.modeTextDark,
                      { opacity: fadeAnim },
                    ]}
                  >
                    {MODE_LABELS[mode]}
                  </Animated.Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Mode description tooltip */}
      {showDescription && (
        <Animated.View
          style={[
            styles.descriptionContainer,
            isDarkMode && styles.descriptionContainerDark,
          ]}
        >
          <Text
            style={[
              styles.descriptionText,
              isDarkMode && styles.descriptionTextDark,
            ]}
          >
            {MODE_DESCRIPTIONS[currentMode]}
          </Text>
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  selector: {
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 22,
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  track: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 22,
  },
  activeIndicator: {
    position: 'absolute',
    height: 36,
    borderRadius: 18,
    marginHorizontal: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  modesContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  modeItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 2,
  },
  activeModeText: {
    color: 'white',
  },
  descriptionContainer: {
    position: 'absolute',
    bottom: 60,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    maxWidth: '90%',
  },
  descriptionText: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
  },
  // Dark mode styles
  selectorDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  trackDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  modeTextDark: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  descriptionContainerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  descriptionTextDark: {
    color: 'black',
  },
  // Icon styles
  modeContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  iconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  barcodeBar: {
    width: 16,
    height: 2,
    marginVertical: 1,
  },
  barcodeBarThin: {
    width: 12,
  },
});

export default ModeSelector;
