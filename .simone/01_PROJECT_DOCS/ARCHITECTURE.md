# React Native Driver's License Scanner - Architecture

## Project Overview

**Project Name**: react-native-dl-scan  
**Type**: React Native iOS Module  
**Purpose**: Build a custom React Native module for offline driver's license scanning on iOS devices, specifically optimized for M3 iPad Air 13"

### Key Features
- Offline driver's license scanning (US/Canada focus with international support)
- Real-time processing at 30-60 FPS
- PDF417 barcode decoding
- OCR text extraction
- AAMVA data parsing
- Hardware-accelerated processing using M3 Neural Engine

## Technical Architecture

### Core Technologies

#### iOS Native Frameworks
1. **Vision Framework** (iOS 18+)
   - Primary OCR engine (95-98% accuracy)
   - Document detection and perspective correction
   - Hardware-accelerated via Neural Engine
   - `VNRecognizeTextRequest` for text recognition
   - `VNDetectDocumentsRequest` for document boundaries

2. **AVFoundation**
   - Camera frame capture pipeline
   - PDF417 barcode detection
   - YUV pixel format for 50% memory reduction
   - Real-time video processing at 1920x1080

3. **CoreML**
   - Neural Engine optimization
   - Custom ML model support
   - Multi-compute unit utilization (Neural Engine + GPU + CPU)

#### React Native Integration
- **React Native Vision Camera** v3+
  - JSI-based frame processors
  - Direct native communication (no bridge bottleneck)
  - Synchronous processing at 60+ FPS
  - Worklet-based JavaScript execution

### Module Structure

```
react-native-dl-scan/
├── ios/
│   ├── LicenseScanner/
│   │   ├── Core/                    # Core processing logic
│   │   │   ├── VisionProcessor.swift
│   │   │   ├── PDF417Decoder.swift
│   │   │   └── AAMVAParser.swift
│   │   ├── FrameProcessor/          # Vision Camera integration
│   │   │   └── LicenseScannerPlugin.swift
│   │   └── Bridge/                  # React Native bridge
│   │       └── RNLicenseScanner.m
│   └── LicenseScanner.podspec
├── src/
│   ├── LicenseScanner.tsx          # Main React component
│   ├── hooks/                       # Custom React hooks
│   │   └── useLicenseScanner.ts
│   └── types.ts                     # TypeScript definitions
└── example/                         # Demo application
```

### Data Flow Architecture

1. **Frame Capture** (AVFoundation)
   - Camera captures frames at 1920x1080
   - YUV format for optimal memory usage
   - 60 FPS capability with frame dropping

2. **Frame Processing** (Vision Camera)
   - JSI frame processor receives pixel buffer
   - Worklet executes native plugin synchronously
   - Adaptive frame rate (5-10 FPS for heavy processing)

3. **Parallel Processing** (Native)
   - Concurrent PDF417 decoding
   - Simultaneous OCR text extraction
   - Document boundary detection
   - Results aggregation with confidence scoring

4. **Data Extraction** (AAMVA Parser)
   - Parse standardized license format
   - Extract personal information
   - Validate data integrity
   - Structure results for JavaScript

5. **React Native Bridge**
   - Type-safe data transfer
   - Automatic memory management
   - Error boundary handling

### Performance Optimizations

#### Memory Management
- Autoreleasepool for frame processing
- Buffer pooling for pixel buffers
- Weak reference handling in closures
- Dispatch queue management

#### Processing Optimization
- Parallel processing with DispatchGroup
- Adaptive frame rate based on complexity
- Early exit on high-confidence results
- Reduced precision for GPU calculations

#### M3 iPad Specific
- Neural Engine utilization (18 TOPS)
- Multi-core CPU distribution
- Hardware-accelerated Vision operations
- Optimized for 8GB unified memory

## Technical Decisions

### Why Vision Framework over Open Source OCR?
- 95-98% accuracy vs 80-85% (Tesseract)
- Hardware acceleration on Apple Silicon
- Native iOS integration
- Better performance and battery efficiency

### Why React Native Vision Camera?
- JSI eliminates bridge overhead
- Frame processor API for real-time processing
- Active maintenance and community
- Best performance for video processing in RN

### Why YUV over RGB Pixel Format?
- 50% memory reduction
- Native format from camera sensor
- Sufficient quality for document processing
- Better frame rate sustainability

## Security Considerations

- All processing happens on-device (offline)
- No network requests for scanning
- Secure memory handling for sensitive data
- Optional encryption for stored results

## Constraints and Requirements

### Platform Requirements
- iOS 15.0+ (iOS 18 recommended)
- React Native 0.72+
- React Native Vision Camera 3.0+
- M-series iPad recommended (M3 optimal)

### Performance Targets
- Initial detection: < 2 seconds
- Continuous scanning: 10 FPS minimum
- Memory usage: < 200MB active
- Battery impact: < 10% per hour

### Accuracy Requirements
- PDF417 decode rate: > 90%
- OCR accuracy: > 95%
- False positive rate: < 1%
- AAMVA compliance: 100%

## Future Considerations

### Planned Enhancements
- Android support via ML Kit
- Additional document types (passports, ID cards)
- Face extraction and verification
- Offline machine learning model updates

### Scalability Options
- Cloud processing fallback
- Batch processing mode
- Multi-document scanning
- Export to various formats

## Dependencies

### Core Dependencies
- react-native: ^0.72.0
- react-native-vision-camera: ^3.0.0
- iOS Deployment Target: 15.0

### Native iOS Dependencies
- Vision.framework
- AVFoundation.framework
- CoreML.framework
- CoreImage.framework

### Optional Dependencies
- ZXing-Swift (PDF417 fallback)
- TesseractOCRiOS (legacy iOS support)