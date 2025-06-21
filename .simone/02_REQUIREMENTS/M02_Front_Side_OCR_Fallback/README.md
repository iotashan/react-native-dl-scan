# M02 - Front-side OCR Fallback

**Timeline:** Week 3  
**Status:** 📋 PLANNED  
**Priority:** HIGH

## Milestone Overview

Implement front-side OCR scanning as a fallback option when PDF417 barcode scanning fails or is unavailable. This milestone uses iOS Vision Framework for on-device text recognition and AI-powered field extraction from the front of driver's licenses.

## Success Criteria

✅ **Vision Framework OCR:** Successfully extract text from front-side license images  
✅ **Field Parsing Logic:** Parse names, addresses, license numbers from OCR text  
✅ **Fallback Integration:** Automatic fallback when barcode scanning fails  
✅ **Quality Detection:** Assess image quality before attempting OCR  
✅ **Error Handling:** Handle OCR failures and partial data extraction  
✅ **Performance Optimization:** OCR processing <2 seconds on iPad M3  
✅ **Multi-State Support:** Handle layout variations across US states

## Technical Requirements

### Core OCR Components
- **Document Detection:** `VNDetectDocumentSegmentationRequest` for license boundary detection
- **Text Recognition:** `VNRecognizeTextRequest` with accuracy-optimized settings
- **Field Extraction:** Heuristic parsing engine for structure data extraction
- **Quality Assessment:** Pre-processing checks for blur, lighting, and orientation

### Parsing Engine
- **Name Extraction:** First, middle, last name parsing with common variations
- **Address Parsing:** Street, city, state, ZIP extraction with validation
- **License Number:** Pattern recognition for state-specific formats
- **Date Recognition:** DOB and expiration date extraction with multiple formats
- **Physical Description:** Height, weight, eye color, hair color extraction

### Integration Points
- **Fallback Logic:** Trigger OCR after barcode timeout or failure
- **Data Validation:** Cross-validation with expected license data patterns
- **Confidence Scoring:** Reliability assessment for extracted fields
- **Error Recovery:** Graceful handling of partial or failed extractions

## Implementation Phases

### Phase 2.1: Vision Framework OCR Setup
- Configure `VNRecognizeTextRequest` with optimal settings
- Implement document detection and boundary cropping
- Add image quality assessment and preprocessing
- Create text extraction pipeline

### Phase 2.2: Field Parsing Engine
- Build heuristic engine for field extraction
- Implement state-specific parsing rules
- Add confidence scoring for extracted data
- Handle common OCR errors and corrections

### Phase 2.3: Fallback Integration
- Integrate with existing scanning infrastructure
- Add automatic fallback logic
- Implement timeout and retry mechanisms
- Create seamless user experience

## Technical Architecture

### Vision Framework Configuration

```swift
// Optimal OCR settings for license scanning
private func createTextRecognitionRequest() -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate  // Prioritize accuracy over speed
    request.usesLanguageCorrection = false  // Important for license numbers
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = 0.03  // Filter out noise
    return request
}
```

### Field Extraction Heuristics

```swift
// Example parsing logic for license fields
class LicenseFieldExtractor {
    func extractFields(from text: [VNRecognizedTextObservation]) -> LicenseData {
        let combinedText = text.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        
        return LicenseData(
            firstName: extractFirstName(from: combinedText),
            lastName: extractLastName(from: combinedText),
            licenseNumber: extractLicenseNumber(from: combinedText),
            address: extractAddress(from: combinedText),
            dateOfBirth: extractDateOfBirth(from: combinedText)
        )
    }
}
```

### Quality Assessment

```swift
// Pre-processing quality checks
private func assessImageQuality(_ buffer: CVPixelBuffer) -> QualityAssessment {
    return QualityAssessment(
        blurScore: calculateBlurScore(buffer),
        brightnessScore: calculateBrightness(buffer),
        contrastScore: calculateContrast(buffer),
        orientationCorrect: checkOrientation(buffer),
        documentBounds: detectDocumentBounds(buffer)
    )
}
```

## State-Specific Parsing Rules

### Common License Layouts
- **Name:** Usually top 1-3 lines, often "LAST, FIRST MIDDLE" format
- **License Number:** Alphanumeric, state-specific patterns (CA: 1 letter + 7 digits)
- **Address:** Multi-line, city/state/zip on separate lines
- **DOB:** Various formats (MM/DD/YYYY, MM-DD-YY, etc.)
- **Physical Info:** Height, weight, often abbreviated

### Example State Patterns

```swift
let statePatterns: [String: LicensePattern] = [
    "CA": LicensePattern(
        licenseNumberRegex: #"^[A-Z]\d{7}$"#,
        namePattern: .lastFirstMiddle,
        addressLines: 3
    ),
    "TX": LicensePattern(
        licenseNumberRegex: #"^\d{8}$"#,
        namePattern: .firstMiddleLast,
        addressLines: 2
    ),
    // ... additional states
]
```

## Error Handling Strategy

### OCR Failure Scenarios
- **No Text Detected:** Poor image quality or orientation
- **Partial Text:** Some fields extracted, others missing
- **Incorrect Parsing:** OCR misread characters (0→O, 1→I, etc.)
- **Unsupported Layout:** State not in parsing rule set

### Confidence Scoring

```swift
struct FieldConfidence {
    let field: String
    let value: String
    let confidence: Double  // 0.0 - 1.0
    let source: ExtractionSource  // OCR, pattern match, validation
}

// Overall confidence calculation
func calculateOverallConfidence(_ fields: [FieldConfidence]) -> Double {
    let weights = ["firstName": 0.2, "lastName": 0.2, "licenseNumber": 0.4, "address": 0.2]
    return fields.reduce(0.0) { sum, field in
        sum + (field.confidence * (weights[field.field] ?? 0.0))
    }
}
```

## Performance Requirements

### Target Metrics (iPad M3)
- **OCR Processing:** <2 seconds for 1920x1080 image
- **Field Extraction:** <500ms after OCR completion
- **Memory Usage:** <100MB during processing
- **Accuracy:** 80%+ for clearly positioned licenses

### Optimization Strategies
- **Region of Interest:** Crop to license boundaries before OCR
- **Multi-threading:** Process OCR on background queue
- **Caching:** Cache OCR results to avoid reprocessing
- **Early Termination:** Stop processing if confidence too low

## Testing Strategy

### Test Data Requirements
- Sample license images from 10+ states
- Various quality conditions (blur, lighting, angles)
- Edge cases (damaged licenses, partial occlusion)
- Performance benchmarks on target devices

### Validation Metrics
- **Field Accuracy:** Percentage of correctly extracted fields
- **False Positive Rate:** Incorrect field extractions
- **Processing Time:** OCR and parsing performance
- **Memory Usage:** Resource consumption during processing

## Integration with M01

### Shared Infrastructure
- Reuse error handling patterns from M01
- Leverage existing React Native bridge
- Extend license data types for OCR confidence scores
- Use same testing framework and CI/CD pipeline

### Fallback Logic
```typescript
// Enhanced scanning hook with fallback
export function useLicenseScanner() {
  const scanWithFallback = async (imageBuffer: Buffer, mode: 'auto' | 'barcode' | 'ocr') => {
    if (mode === 'auto' || mode === 'barcode') {
      try {
        return await scanPDF417Barcode(imageBuffer);
      } catch (error) {
        if (mode === 'auto') {
          console.log('Barcode failed, falling back to OCR');
          return await scanFrontSideOCR(imageBuffer);
        }
        throw error;
      }
    } else {
      return await scanFrontSideOCR(imageBuffer);
    }
  };
}
```

## Risk Assessment

### High Risk Areas
- **OCR Accuracy:** Text recognition may fail on poor quality images
- **State Variations:** Parsing rules may not cover all license layouts
- **Performance:** OCR processing may be too slow for real-time use

### Mitigation Strategies
- **Quality Guidance:** Provide real-time feedback for image positioning
- **Progressive Enhancement:** Start with high-confidence states, expand gradually
- **Performance Optimization:** Use Neural Engine acceleration, optimize image preprocessing

## Success Metrics

- **Functional:** Successfully extract key fields from front-side license images
- **Accuracy:** 80%+ field extraction accuracy on well-positioned licenses
- **Performance:** <2 second processing time for OCR + parsing
- **Coverage:** Support for top 10 US states initially
- **User Experience:** Seamless fallback with clear guidance

## Dependencies & Blockers

### External Dependencies
- iOS Vision Framework text recognition capabilities
- Device hardware performance (Neural Engine recommended)
- Quality of source license images

### Internal Dependencies
- **M01 completion** for shared infrastructure
- Vision Camera integration for image capture
- Error handling framework from M01

## Documentation Deliverables

- OCR configuration guide
- State-specific parsing rule documentation
- Performance optimization guide
- Troubleshooting guide for OCR failures

## Next Milestone

This milestone enables **M03 - Dual-Mode UI & Integration** by providing:
- Complete fallback scanning capability
- OCR confidence scoring system
- Performance-optimized text recognition
- Foundation for intelligent mode switching