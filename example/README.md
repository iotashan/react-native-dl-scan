# React Native DL Scan Example App

A comprehensive example application demonstrating all features of the react-native-dl-scan library.

## Features Demonstrated

1. **Basic Scanning** - Simple barcode scanning with automatic mode selection
2. **Intelligent Mode** - Automatic switching between PDF417 and OCR modes
3. **Manual Mode Selection** - Choose between barcode and OCR scanning modes
4. **Quality Indicators** - Real-time feedback on scan quality
5. **Accessibility Features** - Voice guidance and haptic feedback
6. **Error Handling** - Test various error scenarios
7. **Performance Test** - Measure scanning performance
8. **History & Storage** - View scan history and storage examples

## Getting Started

### Prerequisites

Make sure you have completed the [React Native - Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

### Installation

1. Install dependencies:
```bash
cd example
yarn install
```

2. Install iOS pods (iOS only):
```bash
cd ios
bundle install  # First time only
bundle exec pod install
```

### Running the App

Start Metro bundler:
```bash
yarn start
```

Run on iOS:
```bash
yarn ios
```

Run on Android:
```bash
yarn android
```

## Navigation Structure

The app uses React Navigation with a stack navigator. All screens are accessible from the home screen:

```
Home Screen
├── Basic Scanning
├── Intelligent Mode
├── Manual Mode Selection
├── Quality Indicators
├── Accessibility Features
├── Error Handling
├── Performance Test
└── History & Storage
```

## Feature Details

### Basic Scanning
Shows the simplest integration with minimal configuration. Automatically detects and uses the best scanning mode.

### Intelligent Mode
Demonstrates automatic switching between PDF417 barcode and OCR modes with visual feedback showing mode changes.

### Manual Mode Selection
Allows users to explicitly choose between barcode and OCR scanning modes, useful when you know which format to expect.

### Quality Indicators
Real-time feedback on scan quality including:
- Document detection confidence
- Lighting conditions
- Focus clarity
- Positioning coverage

### Accessibility Features
- Voice guidance during scanning
- Haptic feedback for scan events
- High contrast mode
- Screen reader optimizations

### Error Handling
Simulates various error scenarios:
- Permission denied
- Invalid license format
- Scan timeout
- Camera not available
- Processing errors
- Unsupported license types

### Performance Test
Measures and displays:
- Scan duration for each mode
- Success rates
- Average processing times
- Performance comparison between modes

### History & Storage
Demonstrates:
- Storing scan results locally
- Retrieving historical data
- Export functionality
- Data management

## Dependencies

- `@react-navigation/native` - Navigation framework
- `@react-navigation/native-stack` - Stack navigator
- `react-native-screens` - Native navigation primitives
- `react-native-safe-area-context` - Safe area handling
- `react-native-reanimated` - Animation library
- `react-native-vision-camera` - Camera functionality

## Troubleshooting

If you're having issues, see the [React Native Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

## Learn More

- [React Native DL Scan Documentation](../README.md)
- [React Native Documentation](https://reactnative.dev)
- [React Navigation Documentation](https://reactnavigation.org)