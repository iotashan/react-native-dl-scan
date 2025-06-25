# Incremental Refactoring Process

## ⚠️ CRITICAL: Lessons from T005 Failure

This document establishes mandatory processes for all architecture refactoring tasks based on the catastrophic failure of T005, which degraded test infrastructure from 62.6% to ~40% pass rate.

## Core Principles

### 1. Tests Must Always Pass
- **Baseline Protection**: Establish test pass rate before starting
- **Continuous Validation**: Run tests after EVERY change
- **Hard Stop**: If test pass rate drops, STOP and fix immediately
- **No Bypassing**: NEVER use --no-verify or skip pre-commit hooks

### 2. Incremental Changes Only
- **One Change at a Time**: Extract/refactor one component per commit
- **Validate Each Step**: Ensure all tests pass before proceeding
- **Integration First**: Update integration points before moving to next component
- **Mock Synchronization**: Update mocks alongside every architecture change

### 3. Rollback Strategy Required
- **Branch Per Change**: Create feature branch for each extraction
- **Checkpoint Commits**: Commit after each successful validation
- **Revert Plan**: Document how to rollback if issues arise
- **Recovery Time**: Must be able to restore working state in <30 minutes

## Mandatory Process for Architecture Changes

### Phase 1: Planning & Setup
1. **Baseline Metrics**
   - [ ] Record current test pass rate
   - [ ] Document current file sizes/complexity
   - [ ] Identify all integration points
   - [ ] Map mock dependencies

2. **Incremental Plan**
   - [ ] Break work into smallest possible units
   - [ ] Define validation checkpoint after each unit
   - [ ] Estimate time per unit (target: <2 hours each)
   - [ ] Create rollback strategy

3. **Branch Setup**
   - [ ] Create feature branch: `refactor/<component>-incremental`
   - [ ] Set up CI to run on every push
   - [ ] Configure pre-commit hooks

### Phase 2: Incremental Execution

For EACH component extraction/refactoring:

1. **Pre-Change Validation**
   - [ ] Run full test suite
   - [ ] Confirm baseline pass rate maintained
   - [ ] Document current state

2. **Make Single Change**
   - [ ] Extract/refactor ONE component only
   - [ ] Update all imports/references
   - [ ] Update corresponding mocks
   - [ ] Update integration tests

3. **Validation Checkpoint**
   - [ ] Run full test suite
   - [ ] Pass rate must be ≥ baseline
   - [ ] All integration tests must pass
   - [ ] No new warnings/errors

4. **Commit if Successful**
   - [ ] Create descriptive commit
   - [ ] Include test results in commit message
   - [ ] Push to feature branch
   - [ ] Verify CI passes

5. **Stop if Failed**
   - [ ] Do NOT proceed to next component
   - [ ] Fix issues immediately
   - [ ] Consider reverting if fix is complex
   - [ ] Re-validate before continuing

### Phase 3: Integration & Cleanup

1. **Final Validation**
   - [ ] Run full test suite with coverage
   - [ ] Performance benchmarks
   - [ ] Memory leak detection
   - [ ] Integration test suite

2. **Documentation**
   - [ ] Update architecture docs
   - [ ] Document new component structure
   - [ ] Update integration guides
   - [ ] Add migration notes

3. **Merge Strategy**
   - [ ] Squash commits if many small changes
   - [ ] Ensure commit message documents full scope
   - [ ] Include before/after metrics
   - [ ] Reference original task

## Red Flags - Stop Immediately If:

1. **Test Degradation**
   - Test pass rate drops by ANY amount
   - New test failures appear
   - Timeout/async issues emerge
   - Memory leaks detected

2. **Mock Failures**
   - Bridge communication shows 0 calls
   - Integration tests fail
   - Mock expectations not met
   - New mock complexity required

3. **Scope Creep**
   - Temptation to "fix while refactoring"
   - Additional components seem necessary
   - Change exceeds 2-hour estimate
   - Dependencies cascade

## Example: Proper FallbackController Extraction

Based on T005 failure, here's the CORRECT approach:

### Step 1: Extract ScanTimeoutManager (2 hours)
1. Create new file with timeout logic only
2. Update FallbackController to use new class
3. Update ALL mocks to handle new structure
4. Run tests - must maintain baseline
5. Commit: "refactor: extract ScanTimeoutManager from FallbackController"

### Step 2: Extract QualityMetricsProcessor (2 hours)
1. Only proceed if Step 1 tests pass
2. Create quality metrics handler
3. Update integration points
4. Update mocks again
5. Validate and commit

### Step 3: Extract StateTransitionManager (2 hours)
1. Only proceed if Step 2 tests pass
2. Extract state logic
3. Update all references
4. Full test validation
5. Commit independently

### Step 4: Final ScanController Refactor (2 hours)
1. Only proceed if Step 3 tests pass
2. Refactor remaining controller
3. Ensure all integrations work
4. Final validation
5. Complete documentation

Total: 8 hours with 4 validation checkpoints vs 41 minutes of destruction

## Metrics for Success

### Required Metrics at Each Checkpoint:
- Test pass rate: ≥ baseline (no degradation)
- No new warnings in test output
- No increase in test execution time
- Memory usage stable or improved
- Mock complexity stable or reduced

### Final Success Criteria:
- Architecture goals achieved
- Test suite healthier than start
- Clear documentation
- Smooth integration path
- No technical debt introduced

## Emergency Recovery Process

If refactoring fails (like T005):

1. **Immediate Actions**
   - Stop all work
   - Document current state
   - Assess damage to test suite
   - Create recovery task (like T006)

2. **Recovery Approach**
   - Revert to last known good state
   - Fix test infrastructure first
   - Re-plan with smaller increments
   - Add more validation checkpoints

3. **Lessons Documentation**
   - Update this document
   - Add failure example
   - Strengthen process gates
   - Share with team

## Enforcement

This process is MANDATORY for:
- Any refactoring >100 lines of code
- Any architecture extraction/splitting
- Any change affecting >3 files
- Any change touching test infrastructure
- Any change affecting mocks/bridges

NO EXCEPTIONS without written justification and additional safeguards.

Remember: T005 tried to be a hero and became a cautionary tale. Be incremental, be careful, be successful.