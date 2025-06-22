---
task_id: T002
status: open
complexity: High
created_date: 2025-06-22 17:08:36
last_updated: 2025-06-22 17:08:36
---

# Task: Fix Critical Test Infrastructure - React act() warnings and async leaks in fallback integration

## Context

The project is currently in Sprint S05 (Fallback Integration) with 3/5 tasks completed. The test infrastructure has critical issues that are blocking production readiness, as identified in the project review dated 2025-06-22 16:55:

- **Test Suite Status**: FAILING (129/140 tests)
- **Test Pass Rate**: 92.1% (129 passed, 11 failed)
- **Test Health Score**: 6/10
- **Infrastructure Health**: DEGRADED
- **Blocking Status**: BLOCKED - Core feature tests failing

This task is separate from T001 (which fixed frame processor mocking issues) and focuses specifically on React act() warnings and async operation leaks in the fallback integration tests.

## Description

Fix critical test infrastructure issues in `src/__tests__/fallback-integration.test.ts` that are causing React act() warnings and requiring Jest to force exit due to async operation leaks. These issues indicate that state updates are not properly wrapped in act() and that timers/promises are not cleaning up, which will cause production memory leaks and instability.

## Goal / Objectives

- Eliminate all React act() warnings in fallback integration tests
- Fix async operation leaks that require Jest force exit
- Ensure all 140 tests pass (currently 129/140)
- Prevent future production memory leaks and instability
- Restore test infrastructure to healthy state

## Technical Specifications

### 1. React act() Warnings
**Files affected**: 
- `src/__tests__/fallback-integration.test.ts`
- `src/hooks/useLicenseScanner.ts`

**Issues**:
- State updates in `setError()` at line 201 not wrapped in act()
- State updates in `setIsScanning()` at line 210 not wrapped in act()
- Async operations in hook callbacks not properly handled

### 2. Async Operation Leaks
**Files affected**:
- `src/utils/FallbackController.ts` (contains setTimeout operations)
- `src/__tests__/fallback-integration.test.ts`

**Issues**:
- Timers in FallbackController (lines 191, 196) not cleaned up
- Promise chains not properly awaited or cancelled
- Test process requires force exit indicating unresolved async operations

### 3. Failing Tests
**File**: `src/__tests__/fallback-integration.test.ts`
- 11 tests failing in fallback integration
- Core functionality tests for the main feature of S05

## Acceptance Criteria

- [ ] All 140 tests pass (100% pass rate)
- [ ] No React act() warnings in test output
- [ ] Jest exits cleanly without requiring force exit
- [ ] All async operations properly cleanup in tests
- [ ] CI/CD pipeline shows green status
- [ ] No regression in existing passing tests
- [ ] Performance metrics remain within acceptable range (<4s fallback time)

## Dependencies

- **Architecture**: Follows patterns in `/Users/shan/dev/iotashan/react-native-dl-scan/.simone/01_PROJECT_DOCS/ARCHITECTURE.md`
- **Testing Strategy**: Aligns with `/Users/shan/dev/iotashan/react-native-dl-scan/docs/TESTING_STRATEGY.md`
- **Error Handling**: Respects patterns in `/Users/shan/dev/iotashan/react-native-dl-scan/docs/ERROR_HANDLING.md`
- **Sprint Context**: Part of S05 - Fallback Integration milestone

## Technical Guidance

### Key Interfaces and Integration Points
1. **useLicenseScanner Hook** (`src/hooks/useLicenseScanner.ts`)
   - scan() method with async state updates (lines 170-214)
   - scanBarcode() and scanOCR() legacy methods
   - Integration with FallbackController

2. **FallbackController** (`src/utils/FallbackController.ts`)
   - setTimeout operations for transitions (lines 191, 196)
   - Promise-based timeout handling
   - State machine transitions

3. **Test Infrastructure**
   - @testing-library/react-native renderHook and act utilities
   - Jest mock system for native modules
   - Async test patterns

### Existing Patterns to Follow
1. **Successful act() usage** in `src/hooks/__tests__/useLicenseScanner.test.ts`:
   - Proper wrapping of async operations
   - Correct test lifecycle management

2. **Timer cleanup patterns** in other test files:
   - jest.clearAllTimers() in afterEach blocks
   - Proper promise resolution/rejection handling

### Implementation Notes

1. **Fix React act() warnings**:
   - Wrap all state updates in act() calls
   - Use `await act(async () => { ... })` for async operations
   - Ensure promises resolve within act() boundaries

2. **Fix async leaks**:
   - Add cleanup function to FallbackController for timer cancellation
   - Implement proper test cleanup in afterEach blocks
   - Use jest.useFakeTimers() for controlled timer testing
   - Clear all timers and pending promises after each test

3. **Test pattern updates**:
   - Update test expectations to match actual async behavior
   - Add proper waitFor() utilities where needed
   - Ensure all promises are awaited before test completion

4. **Performance considerations**:
   - Maintain <200ms transition time requirement
   - Keep overall fallback time under 4 seconds
   - No degradation in test execution speed

## Subtasks

- [ ] Analyze all 11 failing tests in fallback-integration.test.ts
- [ ] Implement proper act() wrapping for async state updates
- [ ] Add timer cleanup to FallbackController
- [ ] Update test patterns to properly handle async operations
- [ ] Add afterEach cleanup blocks to all test suites
- [ ] Verify no memory leaks with Jest --detectLeaks flag
- [ ] Run full test suite to ensure 100% pass rate
- [ ] Update documentation if test patterns change

## Output Log

[2025-06-22 17:08:36] Task created