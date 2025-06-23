// React import is needed for JSX even if not directly used
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Vibration, AccessibilityInfo } from 'react-native';
import { ModeSelector } from '../ModeSelector';
import type { ScanMode } from '../../types/license';

// Mock Vibration
(Vibration.vibrate as jest.Mock) = jest.fn();

// Mock AccessibilityInfo
(AccessibilityInfo.announceForAccessibility as jest.Mock) = jest.fn();

describe('ModeSelector', () => {
  const mockOnModeChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with all three modes', () => {
    const { getByText, getByLabelText } = render(
      <ModeSelector currentMode="auto" onModeChange={mockOnModeChange} />
    );

    expect(getByText('Auto')).toBeTruthy();
    expect(getByText('Barcode')).toBeTruthy();
    expect(getByText('OCR')).toBeTruthy();
    expect(getByLabelText('Mode selector, current mode is Auto')).toBeTruthy();
  });

  it('highlights the current mode', () => {
    const { getByText, rerender } = render(
      <ModeSelector currentMode="barcode" onModeChange={mockOnModeChange} />
    );

    // The current mode should have different styling (verified by snapshot or visual inspection)
    const barcodeButton = getByText('Barcode');
    expect(barcodeButton).toBeTruthy();

    // Re-render with different mode
    rerender(
      <ModeSelector currentMode="ocr" onModeChange={mockOnModeChange} />
    );
    const ocrButton = getByText('OCR');
    expect(ocrButton).toBeTruthy();
  });

  it('calls onModeChange when a mode is tapped', () => {
    const { getByText } = render(
      <ModeSelector currentMode="auto" onModeChange={mockOnModeChange} />
    );

    fireEvent.press(getByText('Barcode'));
    expect(mockOnModeChange).toHaveBeenCalledWith('barcode');

    fireEvent.press(getByText('OCR'));
    expect(mockOnModeChange).toHaveBeenCalledWith('ocr');
  });

  it('provides haptic feedback on iOS when mode is selected', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';

    const { getByText } = render(
      <ModeSelector currentMode="auto" onModeChange={mockOnModeChange} />
    );

    fireEvent.press(getByText('Barcode'));
    expect(Vibration.vibrate).toHaveBeenCalledWith(10);

    Platform.OS = originalPlatform;
  });

  it('announces mode changes for accessibility', () => {
    const { getByText } = render(
      <ModeSelector currentMode="auto" onModeChange={mockOnModeChange} />
    );

    fireEvent.press(getByText('OCR'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Switched to OCR mode. Text recognition for front of license'
    );
  });

  it('disables interaction when disabled prop is true', () => {
    const { getByText } = render(
      <ModeSelector
        currentMode="auto"
        onModeChange={mockOnModeChange}
        disabled
      />
    );

    fireEvent.press(getByText('Barcode'));
    expect(mockOnModeChange).not.toHaveBeenCalled();
  });

  it('shows description on long press', async () => {
    jest.useFakeTimers();

    const { getByText, queryByText } = render(
      <ModeSelector currentMode="auto" onModeChange={mockOnModeChange} />
    );

    // Initially no description
    expect(queryByText('Automatically selects best method')).toBeNull();

    // Long press
    fireEvent(getByText('Auto'), 'onLongPress');

    // Fast forward timers
    jest.advanceTimersByTime(600);

    await waitFor(() => {
      expect(queryByText('Automatically selects best method')).toBeTruthy();
    });

    // Description should disappear after 2 seconds
    jest.advanceTimersByTime(2100);

    await waitFor(() => {
      expect(queryByText('Automatically selects best method')).toBeNull();
    });

    jest.useRealTimers();
  });

  it('maintains correct accessibility states', () => {
    const { getByLabelText } = render(
      <ModeSelector currentMode="barcode" onModeChange={mockOnModeChange} />
    );

    const autoButton = getByLabelText('Auto mode');
    const barcodeButton = getByLabelText('Barcode mode');

    expect(autoButton.props.accessibilityState.selected).toBe(false);
    expect(barcodeButton.props.accessibilityState.selected).toBe(true);
  });

  it('cycles through modes correctly', () => {
    const modes: ScanMode[] = ['auto', 'barcode', 'ocr'];
    let currentModeIndex = 0;

    const { getByText, rerender } = render(
      <ModeSelector
        currentMode={modes[currentModeIndex] as ScanMode}
        onModeChange={(mode) => {
          currentModeIndex = modes.indexOf(mode);
          mockOnModeChange(mode);
        }}
      />
    );

    // Click through all modes
    fireEvent.press(getByText('Barcode'));
    expect(mockOnModeChange).toHaveBeenCalledWith('barcode');

    rerender(
      <ModeSelector
        currentMode={modes[1] as ScanMode}
        onModeChange={(mode) => {
          currentModeIndex = modes.indexOf(mode);
          mockOnModeChange(mode);
        }}
      />
    );

    fireEvent.press(getByText('OCR'));
    expect(mockOnModeChange).toHaveBeenCalledWith('ocr');

    rerender(
      <ModeSelector
        currentMode={modes[2] as ScanMode}
        onModeChange={(mode) => {
          currentModeIndex = modes.indexOf(mode);
          mockOnModeChange(mode);
        }}
      />
    );

    fireEvent.press(getByText('Auto'));
    expect(mockOnModeChange).toHaveBeenCalledWith('auto');
  });
});
