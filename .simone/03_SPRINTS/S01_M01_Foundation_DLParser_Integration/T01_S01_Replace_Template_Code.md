# T01_S01 - Replace Template Code

**Sprint:** S01 - Foundation & DLParser-Swift Integration  
**Milestone:** M01 - Core PDF417 Barcode Scanning  
**Status:** 📋 PLANNED  
**Priority:** HIGH  
**Estimated Effort:** 4 hours  

## Task Overview

Remove all template multiply() functions and replace with license scanning infrastructure. This includes updating the React Native module interface, native iOS implementation, and TypeScript definitions.

## Acceptance Criteria

- ✅ Remove multiply() function from `src/index.tsx`
- ✅ Remove multiply() implementation from `ios/DlScan.mm`
- ✅ Update `src/NativeDlScan.ts` interface with scanning methods
- ✅ Add basic license scanning function placeholders
- ✅ Update TypeScript interfaces for license data
- ✅ Ensure project builds without errors

## Implementation Details

### Files to Modify

1. **`src/index.tsx`**
   - Remove `multiply` export
   - Add `scanLicense` function export
   - Add license data types export

2. **`src/NativeDlScan.ts`**
   - Remove `multiply` interface
   - Add `scanLicense` method signature
   - Define license data and error types

3. **`ios/DlScan.mm`**
   - Remove multiply implementation
   - Add placeholder scanLicense method
   - Update TurboModule implementation

4. **Create `src/types/license.ts`**
   - Define LicenseData interface
   - Define ScanError interface
   - Export type definitions

### Code Structure

```typescript
// src/types/license.ts
export interface LicenseData {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  licenseNumber?: string;
  dateOfBirth?: Date;
  expirationDate?: Date;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  // ... additional fields
}

export interface ScanError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}
```

## Testing Requirements

- ✅ Project builds successfully on iOS
- ✅ Example app runs without crashes
- ✅ TypeScript compilation passes
- ✅ No multiply() references remain in codebase

## Dependencies

- None (this is the foundation task)

## Blockers

- None identified

## Definition of Done

- All template code removed
- Basic scanning infrastructure in place
- Project builds and runs
- Ready for DLParser-Swift integration