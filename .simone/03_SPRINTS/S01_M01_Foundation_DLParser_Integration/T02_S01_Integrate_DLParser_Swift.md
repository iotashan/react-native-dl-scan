# T02_S01 - Integrate DLParser-Swift Library

**Sprint:** S01 - Foundation & DLParser-Swift Integration  
**Milestone:** M01 - Core PDF417 Barcode Scanning  
**Status:** 📋 PLANNED  
**Priority:** HIGH  
**Estimated Effort:** 6 hours  

## Task Overview

Integrate the DLParser-Swift library via Swift Package Manager and implement basic AAMVA parsing functionality. This task establishes the core parsing capability that will handle PDF417 barcode data.

## Acceptance Criteria

- ✅ DLParser-Swift added via Swift Package Manager
- ✅ Library successfully imports in iOS project
- ✅ Basic parsing function implemented
- ✅ Error handling for DLParser-Swift errors
- ✅ Data conversion from Swift to JavaScript format
- ✅ Unit tests for parsing functionality

## Implementation Details

### Swift Package Manager Integration

1. **Add to iOS Project:**
   - Open `ios/DlScan.xcworkspace` in Xcode
   - Add Package Dependency: `https://github.com/slapglif/DLParser`
   - Target: DlScan iOS framework

2. **Update Podspec:**
   ```ruby
   # DlScan.podspec
   s.dependency 'DLParser'
   ```

### Core Implementation

1. **Create `ios/LicenseParser.swift`:**
   ```swift
   import DLParser
   import Foundation
   
   class LicenseParser {
       static func parse(_ barcodeData: String) throws -> [String: Any] {
           let licenseData = try DLParser.parse(barcodeData)
           return formatForReactNative(licenseData)
       }
       
       private static func formatForReactNative(_ data: LicenseData) -> [String: Any] {
           // Convert DLParser.LicenseData to dictionary
       }
   }
   ```

2. **Update `ios/DlScan.mm`:**
   ```objc
   #import "DlScan.h"
   #import "LicenseParser.h"
   
   @implementation DlScan
   RCT_EXPORT_MODULE()
   
   - (NSDictionary *)scanLicense:(NSString *)barcodeData {
       @try {
           return [LicenseParser parse:barcodeData];
       } @catch (NSException *exception) {
           return @{
               @"error": @{
                   @"code": @"PARSING_FAILED",
                   @"message": exception.reason
               }
           };
       }
   }
   @end
   ```

### Error Translation

Create error mapping from DLParser-Swift to React Native format:

```swift
// ios/ErrorTranslator.swift
enum ScanErrorCode: String {
    case parsingFailed = "PARSING_FAILED"
    case invalidFormat = "INVALID_FORMAT"
    case unsupportedVersion = "UNSUPPORTED_VERSION"
    case corruptedData = "CORRUPTED_DATA"
}

class ErrorTranslator {
    static func translate(_ error: Error) -> [String: Any] {
        // Map DLParser errors to standardized format
    }
}
```

### Data Format Mapping

Map all DLParser-Swift fields to JavaScript format:

```swift
private static func formatForReactNative(_ data: LicenseData) -> [String: Any] {
    var result: [String: Any] = [:]
    
    // Personal Information
    result["firstName"] = data.firstName
    result["lastName"] = data.lastName
    result["middleName"] = data.middleName
    
    // Dates (convert to ISO strings)
    if let dob = data.dateOfBirth {
        result["dateOfBirth"] = ISO8601DateFormatter().string(from: dob)
    }
    
    // Address
    result["address"] = [
        "street": data.streetAddress,
        "city": data.city,
        "state": data.state,
        "postalCode": data.postalCode
    ]
    
    // License Information
    result["licenseNumber"] = data.licenseNumber
    result["licenseClass"] = data.licenseClass
    
    // Additional fields
    result["isOrganDonor"] = data.isOrganDonor
    result["isVeteran"] = data.isVeteran
    
    return result
}
```

## Testing Requirements

### Unit Tests

Create `ios/DlScanTests/LicenseParserTests.swift`:

```swift
import XCTest
import DLParser
@testable import DlScan

class LicenseParserTests: XCTestCase {
    
    func testValidAAMVAParsing() throws {
        let testData = MockAAMVAData.valid()
        let result = try LicenseParser.parse(testData)
        
        XCTAssertNotNil(result["firstName"])
        XCTAssertNotNil(result["lastName"])
        XCTAssertNotNil(result["licenseNumber"])
    }
    
    func testInvalidDataHandling() {
        let invalidData = "INVALID_BARCODE"
        
        XCTAssertThrowsError(try LicenseParser.parse(invalidData))
    }
}
```

### Integration Tests

- Test with sample AAMVA data from multiple states
- Validate error handling for various failure modes
- Confirm data format consistency

## Dependencies

- **T01_S01_Replace_Template_Code** must be completed first
- DLParser-Swift library must be accessible
- iOS project must support Swift Package Manager

## Blockers

- DLParser-Swift library compatibility issues
- Swift Package Manager configuration problems
- iOS deployment target conflicts

## Resources

- [DLParser-Swift GitHub](https://github.com/slapglif/DLParser)
- [AAMVA Implementation Guide](../../../docs/AAMVA_IMPLEMENTATION.md)
- [Swift Package Manager Documentation](https://swift.org/package-manager/)

## Definition of Done

- DLParser-Swift successfully integrated
- Basic parsing functionality working
- Comprehensive error handling
- Unit tests passing
- Ready for frame processor integration