# OCR Configuration Guide

This guide provides best practices and configuration examples for the Vision Framework OCR implementation in React Native DL Scan.

## Overview

The OCR (Optical Character Recognition) functionality serves as a fallback mechanism when PDF417 barcode scanning fails. It uses iOS Vision Framework's text recognition capabilities to extract information from the front side of driver's licenses.

## Configuration Parameters

### VNRecognizeTextRequest Settings

```swift
// Optimal configuration for license text recognition
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate       // Prioritize accuracy over speed
request.usesLanguageCorrection = false    // Preserve license numbers/codes
request.recognitionLanguages = ["en-US"]  // US English for licenses
request.minimumTextHeight = 0.03         // Filter out noise/small text
```

### Key Configuration Decisions

1. **Recognition Level**: We use `.accurate` instead of `.fast` because:
   - License text is critical data requiring high accuracy
   - Processing happens in real-time but at lower frequency (2 FPS)
   - Accuracy improvements outweigh the performance cost

2. **Language Correction**: Disabled to preserve:
   - License numbers (e.g., "A1234567")
   - State codes (e.g., "CA", "TX")
   - Special identifiers that might be "corrected" incorrectly

3. **Minimum Text Height**: Set to 3% of image height to:
   - Filter out background noise and watermarks
   - Focus on primary license text
   - Improve processing performance

## Frame Quality Requirements

### Resolution Requirements
- **Minimum**: 1280x720 (720p)
- **Recommended**: 1920x1080 (1080p)
- **Optimal**: 2560x1440 (1440p)

### Quality Thresholds
```swift
// OCR-specific quality requirements (stricter than barcode)
let OCR_MIN_BLUR_SCORE = 75.0      // vs 50.0 for barcode
let OCR_MIN_BRIGHTNESS = 60.0      // vs 50.0 for barcode  
let OCR_MAX_BRIGHTNESS = 190.0     // vs 200.0 for barcode
let OCR_MIN_CONTRAST = 40.0        // New requirement for OCR
```

## Usage Examples

### Basic OCR Mode
```typescript
// Use OCR mode explicitly
const result = await runAsync(frame, 'scanLicense', { mode: 'ocr' });
```

### Automatic Fallback (Future Integration)
```typescript
// Automatic fallback from barcode to OCR
const result = await runAsync(frame, 'scanLicense', { 
  mode: 'auto',  // Will try barcode first, then OCR
  fallbackTimeout: 5000  // Switch to OCR after 5 seconds
});
```

## Performance Optimization

### Frame Rate Limiting
- **Barcode Mode**: 10 FPS (100ms between frames)
- **OCR Mode**: 2 FPS (500ms between frames)

This difference accounts for:
- Higher computational cost of text recognition
- More stable frame requirements for OCR
- Better user experience with less frequent updates

### Memory Management
```swift
// Use autoreleasepool for memory efficiency
return autoreleasepool { () -> [String: Any]? in
    // OCR processing here
    let result = performOCR(pixelBuffer)
    return result
}
```

## Common Driver's License Terms

Future enhancement to add custom vocabulary:
```swift
// Common terms found on licenses (to be implemented)
let customWords = [
    // Headers
    "DRIVER", "LICENSE", "IDENTIFICATION", 
    
    // Fields
    "NAME", "ADDRESS", "DOB", "EXP", "ISS",
    "CLASS", "ENDORSEMENTS", "RESTRICTIONS",
    
    // States
    "CALIFORNIA", "TEXAS", "FLORIDA", "NEW YORK",
    
    // Descriptors
    "HEIGHT", "WEIGHT", "EYES", "HAIR", "SEX"
]
```

## Error Handling

### OCR-Specific Error Codes
- `OCR_NO_TEXT_DETECTED`: No readable text found
- `OCR_LOW_CONFIDENCE`: Text confidence below threshold
- `OCR_DOCUMENT_NOT_FOUND`: Unable to detect license boundaries
- `OCR_INSUFFICIENT_QUALITY`: Image quality too poor
- `OCR_PARTIAL_EXTRACTION`: Only some fields could be read
- `OCR_PROCESSING_TIMEOUT`: OCR took too long

### Error Recovery Strategies
1. **Quality Issues**: Guide user to improve lighting/positioning
2. **No Text Detected**: Suggest cleaning license or removing glare
3. **Partial Extraction**: Offer manual entry for missing fields
4. **Timeout**: Reduce processing region or skip to manual entry

## Best Practices

### 1. Document Detection First
Always attempt document detection before OCR to:
- Crop to license boundaries
- Reduce processing area
- Improve accuracy

### 2. Progressive Enhancement
Start with basic text extraction and enhance:
- Phase 1: Raw text detection (current)
- Phase 2: Field parsing and structure
- Phase 3: State-specific templates
- Phase 4: Machine learning improvements

### 3. User Guidance
Provide real-time feedback:
- Frame quality indicators
- Positioning guides
- Lighting suggestions
- Progress indication

### 4. Testing Considerations
- Test with licenses from multiple states
- Include worn/damaged licenses
- Vary lighting conditions
- Test different device orientations

## Integration with Existing Architecture

The OCR system integrates seamlessly with the existing PDF417 barcode scanning:

1. **Shared Frame Processor**: Both modes use the same frame processor plugin
2. **Common Error Handling**: ErrorTranslator handles both barcode and OCR errors
3. **Unified Response Format**: Similar data structure for both scanning modes
4. **Quality Validation**: Extends existing blur/brightness checks

## Future Enhancements

1. **Custom Vocabulary**: Add license-specific terms to improve recognition
2. **State Templates**: Pre-defined layouts for common state licenses  
3. **Field Validation**: Cross-check extracted data for consistency
4. **Confidence Scoring**: Per-field confidence ratings
5. **Multi-language Support**: For international licenses