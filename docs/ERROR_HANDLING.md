# Error Handling for React Native License Scanner

## Overview

This document provides a practical error handling strategy for the React Native driver's license scanning module using DLParser-Swift. The approach focuses on real-world error scenarios, user-friendly recovery, and integration-specific error handling.

## Error Categories

### Core Error Types

```typescript
// types/errors.ts
export interface ScanError {
  code: string
  message: string
  userMessage: string
  recoverable: boolean
}

export enum ErrorCode {
  // Camera Errors
  CAMERA_PERMISSION_DENIED = 'camera_permission_denied',
  CAMERA_NOT_AVAILABLE = 'camera_not_available',
  CAMERA_FAILED = 'camera_failed',
  
  // Processing Errors
  BARCODE_NOT_FOUND = 'barcode_not_found',
  BARCODE_UNREADABLE = 'barcode_unreadable',
  PARSING_FAILED = 'parsing_failed',
  
  // Quality Errors
  IMAGE_TOO_BLURRY = 'image_too_blurry',
  POOR_LIGHTING = 'poor_lighting',
  DOCUMENT_NOT_DETECTED = 'document_not_detected',
  
  // System Errors
  UNKNOWN_ERROR = 'unknown_error'
}
```

### DLParser-Swift Error Integration

```swift
// ErrorTranslator.swift
class ErrorTranslator {
    
    static func translateDLParserError(_ error: Error) -> [String: Any] {
        if let dlError = error as? DLParser.ParseError {
            switch dlError {
            case .invalidFormat:
                return createError(
                    code: "PARSING_FAILED",
                    message: "Invalid AAMVA format",
                    userMessage: "This doesn't appear to be a valid driver's license. Please try again.",
                    recoverable: true
                )
            case .unsupportedVersion(let version):
                return createError(
                    code: "PARSING_FAILED", 
                    message: "Unsupported AAMVA version: \(version)",
                    userMessage: "This license format isn't supported yet. Please try a different license.",
                    recoverable: false
                )
            case .corruptedData:
                return createError(
                    code: "BARCODE_UNREADABLE",
                    message: "Barcode data is corrupted",
                    userMessage: "The barcode appears damaged. Try cleaning the license or better lighting.",
                    recoverable: true
                )
            }
        }
        
        return createError(
            code: "UNKNOWN_ERROR",
            message: error.localizedDescription,
            userMessage: "Something went wrong. Please try again.",
            recoverable: true
        )
    }
    
    private static func createError(code: String, message: String, userMessage: String, recoverable: Bool) -> [String: Any] {
        return [
            "code": code,
            "message": message,
            "userMessage": userMessage,
            "recoverable": recoverable
        ]
    }
}
```

## React Native Error Handling

### Error Context Provider

```typescript
// contexts/ErrorContext.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react'

interface ErrorContextType {
  error: ScanError | null
  showError: (error: ScanError) => void
  clearError: () => void
  retry: () => void
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined)

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ScanError | null>(null)
  
  const showError = (error: ScanError) => {
    setError(error)
    
    // Auto-clear recoverable errors after delay
    if (error.recoverable) {
      setTimeout(() => setError(null), 5000)
    }
  }
  
  const clearError = () => setError(null)
  
  const retry = () => {
    setError(null)
    // Trigger scan retry logic
  }
  
  return (
    <ErrorContext.Provider value={{ error, showError, clearError, retry }}>
      {children}
    </ErrorContext.Provider>
  )
}

export const useError = () => {
  const context = useContext(ErrorContext)
  if (!context) {
    throw new Error('useError must be used within ErrorProvider')
  }
  return context
}
```

### Scanner Hook with Error Handling

```typescript
// hooks/useLicenseScanner.ts
import { useState, useCallback } from 'react'
import { useFrameProcessor } from 'react-native-vision-camera'
import { runOnJS } from 'react-native-reanimated'
import { useError } from '../contexts/ErrorContext'

export function useLicenseScanner() {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const { showError } = useError()
  
  const handleSuccess = useCallback((data: LicenseData) => {
    setLicenseData(data)
    setIsProcessing(false)
  }, [])
  
  const handleError = useCallback((error: ScanError) => {
    showError(error)
    setIsProcessing(false)
  }, [showError])
  
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'
    
    try {
      const result = __scanLicense(frame)
      
      if (result?.error) {
        runOnJS(handleError)(result.error)
      } else if (result?.licenseData) {
        runOnJS(handleSuccess)(result.licenseData)
      }
    } catch (error) {
      runOnJS(handleError)({
        code: 'UNKNOWN_ERROR',
        message: error.message,
        userMessage: 'Something went wrong. Please try again.',
        recoverable: true
      })
    }
  }, [handleSuccess, handleError])
  
  return {
    frameProcessor,
    licenseData,
    isProcessing,
    reset: () => {
      setLicenseData(null)
      setIsProcessing(false)
    }
  }
}
```

## User Interface Error Handling

### Error Display Component

```typescript
// components/ErrorDisplay.tsx
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useError } from '../contexts/ErrorContext'

export function ErrorDisplay() {
  const { error, clearError, retry } = useError()
  
  if (!error) return null
  
  return (
    <View style={styles.container}>
      <View style={styles.errorCard}>
        <Text style={styles.title}>Scan Issue</Text>
        <Text style={styles.message}>{error.userMessage}</Text>
        
        <View style={styles.buttons}>
          {error.recoverable && (
            <TouchableOpacity style={styles.retryButton} onPress={retry}>
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity style={styles.dismissButton} onPress={clearError}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 350,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  message: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    lineHeight: 22,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  retryText: {
    color: 'white',
    fontWeight: '600',
  },
  dismissButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dismissText: {
    color: '#007AFF',
    fontWeight: '600',
  },
})
```

### Scanning Guidance Component

```typescript
// components/ScanningGuidance.tsx
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

interface ScanningGuidanceProps {
  quality: 'good' | 'poor' | 'none'
  issue?: string
}

export function ScanningGuidance({ quality, issue }: ScanningGuidanceProps) {
  const getMessage = () => {
    switch (quality) {
      case 'good':
        return 'Hold steady...'
      case 'poor':
        return issue || 'Adjust position for better quality'
      case 'none':
        return 'Position license in the frame'
      default:
        return 'Position your license'
    }
  }
  
  const getColor = () => {
    switch (quality) {
      case 'good':
        return '#4CAF50'
      case 'poor':
        return '#FF9800'
      case 'none':
        return '#757575'
      default:
        return '#757575'
    }
  }
  
  return (
    <View style={styles.container}>
      <Text style={[styles.message, { color: getColor() }]}>
        {getMessage()}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  message: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
})
```

## Native iOS Error Handling

### Frame Processor Error Management

```swift
// LicenseFrameProcessor.swift
import DLParser
import VisionCamera

class LicenseFrameProcessor: FrameProcessorPlugin {
  
  override func callback(_ frame: Frame, _ arguments: [AnyHashable: Any]?) -> Any? {
    
    guard let buffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return createError(code: "CAMERA_FAILED", message: "Failed to get camera buffer")
    }
    
    // Check image quality first
    if let qualityIssue = checkImageQuality(buffer) {
      return createError(code: qualityIssue.code, message: qualityIssue.message)
    }
    
    // Extract PDF417 barcode
    guard let barcodeData = extractPDF417(from: buffer) else {
      return createError(code: "BARCODE_NOT_FOUND", message: "No barcode detected")
    }
    
    // Parse with DLParser-Swift
    do {
      let licenseData = try DLParser.parse(barcodeData)
      return formatLicenseData(licenseData)
    } catch {
      return ErrorTranslator.translateDLParserError(error)
    }
  }
  
  private func checkImageQuality(_ buffer: CVPixelBuffer) -> (code: String, message: String)? {
    // Simple blur detection
    if isImageBlurry(buffer) {
      return ("IMAGE_TOO_BLURRY", "Image is too blurry")
    }
    
    // Simple brightness check
    if isImageTooDark(buffer) {
      return ("POOR_LIGHTING", "Image is too dark")
    }
    
    return nil
  }
  
  private func createError(code: String, message: String) -> [String: Any] {
    return [
      "error": [
        "code": code,
        "message": message,
        "userMessage": getUserMessage(for: code),
        "recoverable": isRecoverable(code)
      ]
    ]
  }
  
  private func getUserMessage(for code: String) -> String {
    switch code {
    case "CAMERA_FAILED":
      return "Camera issue detected. Please try again."
    case "BARCODE_NOT_FOUND":
      return "Position the license so the barcode is visible."
    case "IMAGE_TOO_BLURRY":
      return "Hold the device steady for a clearer image."
    case "POOR_LIGHTING":
      return "Move to better lighting or adjust the angle."
    default:
      return "Please try again."
    }
  }
  
  private func isRecoverable(_ code: String) -> Bool {
    switch code {
    case "CAMERA_FAILED":
      return false
    default:
      return true
    }
  }
}
```

## Error Recovery Strategies

### Automatic Retry Logic

```typescript
// hooks/useAutoRetry.ts
import { useRef, useEffect } from 'react'

export function useAutoRetry(error: ScanError | null, onRetry: () => void) {
  const retryTimeoutRef = useRef<NodeJS.Timeout>()
  const retryCountRef = useRef(0)
  
  useEffect(() => {
    if (error?.recoverable && retryCountRef.current < 3) {
      retryTimeoutRef.current = setTimeout(() => {
        retryCountRef.current++
        onRetry()
      }, 2000)
    }
    
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [error, onRetry])
  
  useEffect(() => {
    if (!error) {
      retryCountRef.current = 0
    }
  }, [error])
}
```

### Permission Handling

```typescript
// utils/permissions.ts
import { Camera } from 'react-native-vision-camera'

export async function checkCameraPermission(): Promise<{
  hasPermission: boolean
  error?: ScanError
}> {
  try {
    const status = await Camera.getCameraPermissionStatus()
    
    if (status === 'authorized') {
      return { hasPermission: true }
    }
    
    if (status === 'not-determined') {
      const newStatus = await Camera.requestCameraPermission()
      if (newStatus === 'authorized') {
        return { hasPermission: true }
      }
    }
    
    return {
      hasPermission: false,
      error: {
        code: 'CAMERA_PERMISSION_DENIED',
        message: 'Camera permission denied',
        userMessage: 'Camera access is required to scan licenses. Please enable it in Settings.',
        recoverable: false
      }
    }
  } catch (error) {
    return {
      hasPermission: false,
      error: {
        code: 'CAMERA_NOT_AVAILABLE',
        message: 'Camera not available',
        userMessage: 'Camera is not available on this device.',
        recoverable: false
      }
    }
  }
}
```

## Testing Error Scenarios

### Error Simulation

```typescript
// utils/errorSimulation.ts (for testing only)
export const simulateError = (type: string): ScanError => {
  const errors = {
    blur: {
      code: 'IMAGE_TOO_BLURRY',
      message: 'Simulated blur',
      userMessage: 'Hold the device steady for a clearer image.',
      recoverable: true
    },
    dark: {
      code: 'POOR_LIGHTING',
      message: 'Simulated low light',
      userMessage: 'Move to better lighting or adjust the angle.',
      recoverable: true
    },
    noBarcode: {
      code: 'BARCODE_NOT_FOUND',
      message: 'Simulated no barcode',
      userMessage: 'Position the license so the barcode is visible.',
      recoverable: true
    }
  }
  
  return errors[type] || errors.blur
}
```

### Unit Tests

```typescript
// __tests__/errorHandling.test.ts
import { ErrorTranslator } from '../src/utils/ErrorTranslator'

describe('Error Handling', () => {
  test('should translate DLParser errors correctly', () => {
    const error = new DLParser.ParseError.invalidFormat()
    const translated = ErrorTranslator.translateDLParserError(error)
    
    expect(translated.code).toBe('PARSING_FAILED')
    expect(translated.recoverable).toBe(true)
    expect(translated.userMessage).toContain('valid driver\'s license')
  })
  
  test('should handle unknown errors gracefully', () => {
    const error = new Error('Unknown error')
    const translated = ErrorTranslator.translateDLParserError(error)
    
    expect(translated.code).toBe('UNKNOWN_ERROR')
    expect(translated.recoverable).toBe(true)
  })
})
```

## Best Practices

### Error Handling Guidelines

1. **User-Friendly Messages**: Always provide clear, actionable guidance
2. **Recovery Options**: Make errors recoverable when possible
3. **Graceful Degradation**: Continue functioning when non-critical errors occur
4. **Consistent Interface**: Use standardized error format across the app
5. **Logging**: Log technical details while showing user-friendly messages

### Performance Considerations

- Avoid throwing errors in frame processors (return error objects instead)
- Use error codes for efficient error type checking
- Batch similar errors to prevent UI spam
- Clear errors automatically when appropriate

## Conclusion

This error handling strategy provides practical, user-focused error management while leveraging DLParser-Swift's built-in error types. The approach emphasizes recovery, clear communication, and maintaining a smooth user experience even when scanning issues occur.