# DLParser-Swift Integration Guide

## Overview

This document covers the integration of DLParser-Swift, an open-source AAMVA-compliant driver's license parsing library, into our React Native license scanning module. DLParser-Swift provides robust parsing of US and Canadian driver's licenses without requiring custom AAMVA implementation.

## DLParser-Swift Library

**Repository**: [https://github.com/slapglif/DLParser](https://github.com/slapglif/DLParser)
**License**: MIT (Compatible with our open-source project)
**AAMVA Support**: Versions 1-10
**Platform**: iOS Swift Package Manager

### Key Features
- Complete AAMVA standard compliance
- Support for all US states and Canadian provinces
- Automatic field validation and error handling
- Clean Swift API with proper error types
- No external dependencies
- Well-maintained with recent updates

## Installation

Add DLParser-Swift to your iOS project using Swift Package Manager:

### Option 1: Xcode Integration
1. Open your iOS project in Xcode
2. Go to File → Add Package Dependencies
3. Enter: `https://github.com/slapglif/DLParser`
4. Select version and add to target

### Option 2: Package.swift
```swift
dependencies: [
    .package(url: "https://github.com/slapglif/DLParser", from: "1.0.0")
]
```

### Option 3: CocoaPods
```ruby
pod 'DLParser', :git => 'https://github.com/slapglif/DLParser.git'
```

## DLParser-Swift Integration

### Basic Usage

```swift
import DLParser

// Parse PDF417 barcode data
do {
    let licenseData = try DLParser.parse(pdf417Data)
    
    // Access parsed fields
    print("Name: \(licenseData.firstName) \(licenseData.lastName)")
    print("License: \(licenseData.licenseNumber)")
    print("Expires: \(licenseData.expirationDate)")
    
} catch {
    print("Parsing failed: \(error)")
}
```

### License Data Structure

DLParser-Swift provides a comprehensive `LicenseData` structure:

```swift
public struct LicenseData {
    // Personal Information
    public let firstName: String?
    public let lastName: String?
    public let middleName: String?
    public let suffix: String?
    
    // Dates
    public let dateOfBirth: Date?
    public let issueDate: Date?
    public let expirationDate: Date?
    
    // Physical Description
    public let sex: String?
    public let eyeColor: String?
    public let hairColor: String?
    public let height: String?
    public let weight: String?
    
    // Address
    public let streetAddress: String?
    public let city: String?
    public let state: String?
    public let postalCode: String?
    
    // License Information
    public let licenseNumber: String?
    public let licenseClass: String?
    public let restrictions: String?
    public let endorsements: String?
    
    // Additional Fields
    public let isOrganDonor: Bool
    public let isVeteran: Bool
    
    // All fields as dictionary for flexibility
    public let allFields: [String: String]
}
```

### Error Handling

DLParser-Swift provides clear error types:

```swift
// Error handling with DLParser-Swift
do {
    let licenseData = try DLParser.parse(barcodeData)
    // Success - use licenseData
} catch DLParser.ParseError.invalidFormat {
    // Not a valid AAMVA barcode
} catch DLParser.ParseError.unsupportedVersion(let version) {
    // AAMVA version not supported
} catch DLParser.ParseError.corruptedData {
    // Barcode data is corrupted
} catch {
    // Other parsing errors
}
```

### Frame Processor Integration

```swift
import DLParser
import VisionCamera

class LicenseFrameProcessor: FrameProcessorPlugin {
    
    func callback(_ frame: Frame, _ arguments: [AnyHashable: Any]?) -> Any? {
        
        guard let buffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
            return ["error": "Failed to get image buffer"]
        }
        
        // Extract PDF417 barcode data using Vision framework
        if let barcodeData = extractPDF417(from: buffer) {
            do {
                // Use DLParser-Swift to parse the data
                let licenseData = try DLParser.parse(barcodeData)
                
                // Convert to dictionary for React Native
                return licenseDataToDictionary(licenseData)
                
            } catch {
                return ["error": error.localizedDescription]
            }
        }
        
        return nil
    }
    
    private func extractPDF417(from buffer: CVPixelBuffer) -> String? {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.pdf417]
        
        let handler = VNImageRequestHandler(cvPixelBuffer: buffer, options: [:])
        
        try? handler.perform([request])
        
        guard let results = request.results as? [VNBarcodeObservation],
              let barcode = results.first,
              let payload = barcode.payloadStringValue else {
            return nil
        }
        
        return payload
    }
    
    private func licenseDataToDictionary(_ data: LicenseData) -> [String: Any] {
        var result: [String: Any] = [:]
        
        // Personal Information
        result["firstName"] = data.firstName
        result["lastName"] = data.lastName
        result["middleName"] = data.middleName
        result["suffix"] = data.suffix
        
        // Dates
        if let dob = data.dateOfBirth {
            result["dateOfBirth"] = ISO8601DateFormatter().string(from: dob)
        }
        if let issue = data.issueDate {
            result["issueDate"] = ISO8601DateFormatter().string(from: issue)
        }
        if let exp = data.expirationDate {
            result["expirationDate"] = ISO8601DateFormatter().string(from: exp)
        }
        
        // Physical Description
        result["sex"] = data.sex
        result["eyeColor"] = data.eyeColor
        result["hairColor"] = data.hairColor
        result["height"] = data.height
        result["weight"] = data.weight
        
        // Address
        result["streetAddress"] = data.streetAddress
        result["city"] = data.city
        result["state"] = data.state
        result["postalCode"] = data.postalCode
        
        // License Information
        result["licenseNumber"] = data.licenseNumber
        result["licenseClass"] = data.licenseClass
        result["restrictions"] = data.restrictions
        result["endorsements"] = data.endorsements
        
        // Flags
        result["isOrganDonor"] = data.isOrganDonor
        result["isVeteran"] = data.isVeteran
        
        // All fields for debugging/completeness
        result["allFields"] = data.allFields
        
        return result
    }
}
```

## React Native Bridge Implementation

```typescript
// types/License.ts
export interface LicenseData {
  // Personal Information
  firstName?: string
  lastName?: string
  middleName?: string
  suffix?: string
  
  // Dates
  dateOfBirth?: Date
  issueDate?: Date
  expirationDate?: Date
  
  // Physical Description
  sex?: string
  eyeColor?: string
  hairColor?: string
  height?: string
  weight?: string
  
  // Address
  streetAddress?: string
  city?: string
  state?: string
  postalCode?: string
  
  // License Information
  licenseNumber?: string
  licenseClass?: string
  restrictions?: string
  endorsements?: string
  
  // Additional
  isOrganDonor: boolean
  isVeteran: boolean
  
  // All fields for flexibility
  allFields: Record<string, string>
}

// hooks/useLicenseScanner.ts
import { useCallback } from 'react'
import { useFrameProcessor } from 'react-native-vision-camera'
import { runOnJS } from 'react-native-reanimated'

export function useLicenseScanner() {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const handleLicenseDetected = useCallback((data: LicenseData) => {
    setLicenseData(data)
    setIsProcessing(false)
    setError(null)
  }, [])
  
  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage)
    setIsProcessing(false)
  }, [])
  
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'
    
    const result = __scanLicense(frame)
    
    if (result?.error) {
      runOnJS(handleError)(result.error)
    } else if (result) {
      // Convert date strings to Date objects
      if (result.dateOfBirth) {
        result.dateOfBirth = new Date(result.dateOfBirth)
      }
      if (result.issueDate) {
        result.issueDate = new Date(result.issueDate)
      }
      if (result.expirationDate) {
        result.expirationDate = new Date(result.expirationDate)
      }
      
      runOnJS(handleLicenseDetected)(result as LicenseData)
    }
  }, [handleLicenseDetected, handleError])
  
  return {
    licenseData,
    isProcessing,
    error,
    frameProcessor,
    reset: () => {
      setLicenseData(null)
      setError(null)
      setIsProcessing(false)
    }
  }
}
```

## Testing Integration

```swift
// DLParserIntegrationTests.swift
import XCTest
import DLParser
@testable import LicenseScanner

class DLParserIntegrationTests: XCTestCase {
    
    func testDLParserBasicParsing() throws {
        // Sample AAMVA data
        let testBarcodeData = """
        @\n\x1e\rANSI 636014080002DL00410288ZC03260047DLDAQD12345678
        DCSPUBLIC
        DACJOHN
        DADQUINCY
        DBD08242018
        DBB01151990
        DBA01152025
        DBC1
        DAU072 IN
        DAYGRN
        DAG789 MAIN STREET
        DAINEW YORK
        DAJNY
        DAK100010000
        DCF0123456789
        DCGUSA
        DAW200
        DAZBRO
        DDK1
        """
        
        let result = try DLParser.parse(testBarcodeData)
        
        XCTAssertEqual(result.firstName, "JOHN")
        XCTAssertEqual(result.lastName, "PUBLIC")
        XCTAssertEqual(result.middleName, "QUINCY")
        XCTAssertEqual(result.licenseNumber, "D12345678")
        XCTAssertNotNil(result.dateOfBirth)
        XCTAssertNotNil(result.expirationDate)
        XCTAssertTrue(result.isOrganDonor)
    }
    
    func testFrameProcessorIntegration() {
        let processor = LicenseFrameProcessor()
        let mockFrame = createMockFrame(with: validBarcodeData)
        
        let result = processor.callback(mockFrame, nil)
        
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            XCTAssertEqual(dict["firstName"] as? String, "JOHN")
            XCTAssertEqual(dict["lastName"] as? String, "PUBLIC")
            XCTAssertNotNil(dict["licenseNumber"])
        }
    }
}
```

## Benefits of Using DLParser-Swift

### Development Advantages
- **Reduced Complexity**: No need to implement custom AAMVA parsing logic
- **Proven Reliability**: Library has been tested across multiple states and AAMVA versions
- **Maintenance**: Updates and bug fixes handled by library maintainers
- **Standards Compliance**: Automatically stays current with AAMVA specification changes

### Performance Benefits
- **Optimized Parsing**: Library is optimized for Swift performance
- **Memory Efficient**: No complex custom data structures to maintain
- **Fast Integration**: Minimal setup time compared to custom implementation

### Risk Mitigation
- **Battle-Tested**: Used by other production applications
- **Open Source**: Can review and contribute to source code
- **MIT License**: No licensing restrictions for commercial use
- **Community Support**: Issues and improvements from broader developer community

## Migration Notes

When migrating from a custom AAMVA parser to DLParser-Swift:

1. **API Changes**: Update frame processor to use DLParser.parse() method
2. **Data Structure**: Map DLParser's LicenseData to your existing interfaces
3. **Error Handling**: Adapt to DLParser's error types
4. **Testing**: Update test cases to use DLParser parsing results
5. **Dependencies**: Add DLParser-Swift to your project dependencies

## Support and Resources

- **GitHub Repository**: [https://github.com/slapglif/DLParser](https://github.com/slapglif/DLParser)
- **Issues and Support**: Report issues directly to the DLParser-Swift repository
- **AAMVA Documentation**: [https://www.aamva.org/identity/barcode-standard/](https://www.aamva.org/identity/barcode-standard/)
- **Swift Package Manager**: [https://swift.org/package-manager/](https://swift.org/package-manager/)