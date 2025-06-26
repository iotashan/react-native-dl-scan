import React, { forwardRef, useRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TouchableOpacityProps,
} from 'react-native';
import {
  getAccessibilityProps,
  useDynamicType,
  useHighContrast,
  useBoldText,
  getHighContrastColors,
  AccessibilityConfig,
} from '../../utils/accessibility';
import type { ScanMode } from '../../types/license';

/**
 * Accessible Button Component
 * Enhanced TouchableOpacity with accessibility features
 */
interface AccessibleButtonProps extends TouchableOpacityProps {
  label: string;
  hint?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

export const AccessibleButton = forwardRef<
  TouchableOpacity,
  AccessibleButtonProps
>(
  (
    {
      label,
      hint,
      variant = 'primary',
      size = 'medium',
      loading = false,
      disabled = false,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const { fontSize } = useDynamicType();
    const isHighContrast = useHighContrast();
    const isBoldText = useBoldText();
    const highContrastColors = getHighContrastColors(isHighContrast);

    const accessibilityProps = getAccessibilityProps({
      label,
      hint,
      role: 'button',
      state: {
        disabled: disabled || loading,
        busy: loading,
      },
    });

    const buttonStyles = [
      styles.button,
      styles[`button_${variant}`],
      styles[`button_${size}`],
      highContrastColors && styles.highContrastButton,
      disabled && styles.buttonDisabled,
      style,
    ];

    const textStyles = [
      styles.buttonText,
      styles[`buttonText_${variant}`],
      styles[`buttonText_${size}`],
      { fontSize: fontSize(16) },
      isBoldText && styles.boldText,
      highContrastColors && { color: highContrastColors.text },
      disabled && styles.buttonTextDisabled,
    ];

    return (
      <TouchableOpacity
        ref={ref}
        style={buttonStyles}
        disabled={disabled || loading}
        {...accessibilityProps}
        {...props}
      >
        {children || <Text style={textStyles}>{label}</Text>}
      </TouchableOpacity>
    );
  }
);

/**
 * Accessible Camera View Component
 * Camera view with proper accessibility labels and live region updates
 */
interface AccessibleCameraViewProps {
  isScanning: boolean;
  qualityDescription: string;
  documentDetected: boolean;
  currentMode: ScanMode;
  children: React.ReactNode;
  style?: ViewStyle;
}

export const AccessibleCameraView: React.FC<AccessibleCameraViewProps> = ({
  isScanning,
  qualityDescription,
  documentDetected,
  currentMode,
  children,
  style,
}) => {
  const isHighContrast = useHighContrast();
  const highContrastColors = getHighContrastColors(isHighContrast);

  const statusText = `${isScanning ? 'Scanning' : 'Ready'}. ${
    documentDetected ? 'License detected.' : 'No license detected.'
  } ${qualityDescription}`;

  const accessibilityProps = getAccessibilityProps({
    label: AccessibilityConfig.labels.cameraView,
    hint: AccessibilityConfig.hints.positioningGuide,
    role: 'none',
    liveRegion: 'polite',
    value: { text: statusText },
  });

  return (
    <View
      style={[
        styles.cameraView,
        highContrastColors && { borderColor: highContrastColors.border },
        style,
      ]}
      {...accessibilityProps}
    >
      {children}

      {/* Hidden text for screen readers */}
      <Text style={styles.srOnly}>
        Current scanning mode: {currentMode}. {statusText}
      </Text>
    </View>
  );
};

/**
 * Accessible Mode Selector Component
 */
interface AccessibleModeSelectorProps {
  currentMode: ScanMode;
  availableModes: ScanMode[];
  onModeChange: (mode: ScanMode) => void;
  disabled?: boolean;
}

export const AccessibleModeSelector: React.FC<AccessibleModeSelectorProps> = ({
  currentMode,
  availableModes,
  onModeChange,
  disabled = false,
}) => {
  const { fontSize } = useDynamicType();
  const isHighContrast = useHighContrast();
  const isBoldText = useBoldText();
  const highContrastColors = getHighContrastColors(isHighContrast);

  const modeLabels = {
    auto: 'Automatic',
    manual: 'Manual',
    batch: 'Batch',
  };

  return (
    <View style={styles.modeSelector}>
      <Text
        style={[
          styles.modeSelectorLabel,
          { fontSize: fontSize(14) },
          isBoldText && styles.boldText,
          highContrastColors && { color: highContrastColors.text },
        ]}
      >
        Scanning Mode
      </Text>

      {availableModes.map((mode) => (
        <TouchableOpacity
          key={mode}
          style={[
            styles.modeOption,
            currentMode === mode && styles.modeOptionSelected,
            highContrastColors &&
              currentMode === mode && {
                backgroundColor: highContrastColors.primary,
                borderColor: highContrastColors.border,
              },
            disabled && styles.modeOptionDisabled,
          ]}
          onPress={() => onModeChange(mode)}
          disabled={disabled}
          {...getAccessibilityProps({
            label: `${modeLabels[mode]} scanning mode`,
            hint: currentMode === mode ? 'Currently selected' : 'Tap to select',
            role: 'button',
            state: {
              selected: currentMode === mode,
              disabled,
            },
          })}
        >
          <Text
            style={[
              styles.modeOptionText,
              { fontSize: fontSize(16) },
              currentMode === mode && styles.modeOptionTextSelected,
              isBoldText && styles.boldText,
              highContrastColors &&
                currentMode === mode && {
                  color: highContrastColors.secondary,
                },
              disabled && styles.modeOptionTextDisabled,
            ]}
          >
            {modeLabels[mode]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

/**
 * Accessible Result Field Component
 */
interface AccessibleResultFieldProps {
  label: string;
  value?: string;
  confidence?: number;
  isLoading?: boolean;
  hasError?: boolean;
}

export const AccessibleResultField: React.FC<AccessibleResultFieldProps> = ({
  label,
  value,
  confidence,
  isLoading = false,
  hasError = false,
}) => {
  const { fontSize } = useDynamicType();
  const isHighContrast = useHighContrast();
  const isBoldText = useBoldText();
  const highContrastColors = getHighContrastColors(isHighContrast);

  const confidenceText = confidence
    ? `Confidence: ${Math.round(confidence * 100)}%`
    : '';

  const statusText = isLoading
    ? 'Loading'
    : hasError
      ? 'Error detected'
      : value
        ? 'Value detected'
        : 'No value detected';

  const accessibilityLabel = AccessibilityConfig.labels.resultField(
    label,
    value || ''
  );
  const accessibilityValue = `${statusText}. ${confidenceText}`;

  return (
    <View
      style={[
        styles.resultField,
        hasError && styles.resultFieldError,
        highContrastColors &&
          hasError && {
            borderColor: highContrastColors.error,
          },
      ]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: accessibilityValue }}
      accessibilityState={{ busy: isLoading }}
    >
      <Text
        style={[
          styles.resultFieldLabel,
          { fontSize: fontSize(12) },
          isBoldText && styles.boldText,
          highContrastColors && { color: highContrastColors.text },
        ]}
      >
        {label}
      </Text>

      <Text
        style={[
          styles.resultFieldValue,
          { fontSize: fontSize(16) },
          isBoldText && styles.boldText,
          hasError && styles.resultFieldValueError,
          highContrastColors && { color: highContrastColors.text },
          highContrastColors && hasError && { color: highContrastColors.error },
        ]}
      >
        {isLoading ? 'Loading...' : value || 'Not detected'}
      </Text>

      {confidence && (
        <Text
          style={[
            styles.confidenceText,
            { fontSize: fontSize(10) },
            highContrastColors && { color: highContrastColors.textSecondary },
          ]}
        >
          {confidenceText}
        </Text>
      )}
    </View>
  );
};

/**
 * Accessible Quality Indicator Component
 */
interface AccessibleQualityIndicatorProps {
  quality: number;
  qualityLevel: 'poor' | 'good' | 'excellent';
  animated?: boolean;
}

export const AccessibleQualityIndicator: React.FC<
  AccessibleQualityIndicatorProps
> = ({ quality, qualityLevel }) => {
  const { fontSize } = useDynamicType();
  const isHighContrast = useHighContrast();
  const highContrastColors = getHighContrastColors(isHighContrast);

  const qualityPercent = Math.round(quality * 100);
  const qualityDescription = `Image quality: ${qualityLevel}, ${qualityPercent}%`;

  const indicatorColor = isHighContrast
    ? highContrastColors?.primary
    : qualityLevel === 'excellent'
      ? '#4CAF50'
      : qualityLevel === 'good'
        ? '#FF9800'
        : '#F44336';

  return (
    <View
      style={styles.qualityIndicator}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={AccessibilityConfig.labels.qualityIndicator}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: qualityPercent,
        text: qualityDescription,
      }}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.qualityBar, { backgroundColor: indicatorColor }]} />

      <Text
        style={[
          styles.qualityText,
          { fontSize: fontSize(12) },
          isHighContrast && { color: highContrastColors?.text },
        ]}
      >
        {qualityLevel.charAt(0).toUpperCase() + qualityLevel.slice(1)} Quality
      </Text>

      {/* Screen reader only percentage */}
      <Text style={styles.srOnly}>{qualityPercent}% quality</Text>
    </View>
  );
};

/**
 * Accessible Modal Component
 * Modal with proper focus trap and accessibility
 */
interface AccessibleModalProps {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onDismiss: () => void;
}

export const AccessibleModal = forwardRef<View, AccessibleModalProps>(
  ({ visible, title, children, onDismiss }, ref) => {
    const modalRef = useRef<View>(null);

    useImperativeHandle(ref, () => modalRef.current as View);

    if (!visible) return null;

    return (
      <View
        ref={modalRef}
        style={styles.modal}
        accessible={false}
        accessibilityViewIsModal={true}
      >
        <View
          style={styles.modalContent}
          accessible={true}
          accessibilityRole="none"
          accessibilityLabel={`Modal: ${title}`}
        >
          <TouchableOpacity
            style={styles.modalClose}
            onPress={onDismiss}
            {...getAccessibilityProps({
              label: 'Close modal',
              hint: 'Double tap to close',
              role: 'button',
            })}
          >
            <Text style={styles.modalCloseText}>×</Text>
          </TouchableOpacity>

          {children}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  // Button styles
  button: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // Minimum touch target size
  },
  button_primary: {
    backgroundColor: '#007AFF',
  },
  button_secondary: {
    backgroundColor: '#8E8E93',
  },
  button_danger: {
    backgroundColor: '#FF3B30',
  },
  button_success: {
    backgroundColor: '#34C759',
  },
  button_small: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 32,
  },
  button_medium: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  button_large: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    minHeight: 56,
  },
  buttonDisabled: {
    opacity: 0.3,
  },
  highContrastButton: {
    borderWidth: 2,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonText_primary: {
    color: '#FFFFFF',
  },
  buttonText_secondary: {
    color: '#FFFFFF',
  },
  buttonText_danger: {
    color: '#FFFFFF',
  },
  buttonText_success: {
    color: '#FFFFFF',
  },
  buttonText_small: {
    fontSize: 14,
  },
  buttonText_medium: {
    fontSize: 16,
  },
  buttonText_large: {
    fontSize: 18,
  },
  buttonTextDisabled: {
    opacity: 0.6,
  },
  boldText: {
    fontWeight: 'bold',
  },

  // Camera view styles
  cameraView: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 8,
  },

  // Mode selector styles
  modeSelector: {
    padding: 16,
  },
  modeSelectorLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333333',
  },
  modeOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginVertical: 4,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
  },
  modeOptionSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  modeOptionDisabled: {
    opacity: 0.3,
  },
  modeOptionText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#333333',
  },
  modeOptionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  modeOptionTextDisabled: {
    opacity: 0.6,
  },

  // Result field styles
  resultField: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    marginVertical: 4,
    backgroundColor: '#FFFFFF',
  },
  resultFieldError: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFF5F5',
  },
  resultFieldLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 4,
  },
  resultFieldValue: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '500',
  },
  resultFieldValueError: {
    color: '#FF3B30',
  },
  confidenceText: {
    fontSize: 10,
    color: '#8E8E93',
    marginTop: 4,
  },

  // Quality indicator styles
  qualityIndicator: {
    padding: 8,
    alignItems: 'center',
  },
  qualityBar: {
    width: 60,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  qualityText: {
    fontSize: 12,
    textAlign: 'center',
  },

  // Modal styles
  modal: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    margin: 20,
    minWidth: 280,
    maxWidth: '90%',
  },
  modalClose: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  modalCloseText: {
    fontSize: 24,
    color: '#8E8E93',
  },

  // Screen reader only
  srOnly: {
    position: 'absolute',
    left: -10000,
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});

AccessibleButton.displayName = 'AccessibleButton';
AccessibleModal.displayName = 'AccessibleModal';
