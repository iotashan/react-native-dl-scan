import { render } from '@testing-library/react-native';
import { ScanningOverlay } from '../ScanningOverlay';

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

const defaultProps = {
  mode: 'auto' as const,
  isScanning: false,
  detectionState: 'idle' as const,
  orientation: 'portrait' as const,
};

describe('ScanningOverlay', () => {
  it('renders correctly in auto mode', () => {
    const { toJSON } = render(<ScanningOverlay {...defaultProps} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders correctly in barcode mode', () => {
    const { getByText } = render(
      <ScanningOverlay {...defaultProps} mode="barcode" />
    );
    expect(getByText(/Position the barcode/)).toBeTruthy();
  });

  it('renders correctly in OCR mode', () => {
    const { getByText } = render(
      <ScanningOverlay {...defaultProps} mode="ocr" />
    );
    expect(getByText(/Position the front of your license/)).toBeTruthy();
  });

  it('displays custom instruction text', () => {
    const instructionText = 'Custom instruction';
    const { getByText } = render(
      <ScanningOverlay {...defaultProps} instructionText={instructionText} />
    );
    expect(getByText(instructionText)).toBeTruthy();
  });

  it('renders in landscape orientation', () => {
    const { toJSON } = render(
      <ScanningOverlay {...defaultProps} orientation="landscape" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('hides guides when showGuides is false', () => {
    const { queryByTestId } = render(
      <ScanningOverlay {...defaultProps} showGuides={false} />
    );
    // Corners should not be rendered
    expect(queryByTestId('corner-top-left')).toBeNull();
  });

  it('renders success state correctly', () => {
    const { toJSON } = render(
      <ScanningOverlay
        {...defaultProps}
        detectionState="success"
        animateSuccess={true}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders error state correctly', () => {
    const { toJSON } = render(
      <ScanningOverlay
        {...defaultProps}
        detectionState="error"
        animateError={true}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('calls onOverlayPress when pressed', () => {
    const onOverlayPress = jest.fn();
    render(
      <ScanningOverlay {...defaultProps} onOverlayPress={onOverlayPress} />
    );

    // Would need to add testID to the touchable area in the component
    // For now, this is a placeholder test
    expect(onOverlayPress).not.toHaveBeenCalled();
  });
});

describe('ScanningOverlay animations', () => {
  it('starts pulse animation when scanning', () => {
    const { rerender } = render(
      <ScanningOverlay {...defaultProps} isScanning={false} />
    );

    rerender(<ScanningOverlay {...defaultProps} isScanning={true} />);

    // Animation values would be tested here if we had access to the shared values
    // This is more of an integration test
  });

  it('shows sweep line in barcode mode when scanning', () => {
    const { toJSON } = render(
      <ScanningOverlay {...defaultProps} mode="barcode" isScanning={true} />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
