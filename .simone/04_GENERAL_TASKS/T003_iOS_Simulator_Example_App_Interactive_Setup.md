---
task_id: T003
status: blocked
complexity: Medium
last_updated: 2025-06-23T17:31:00Z
created: 2025-06-23T16:58:48Z
---

# Task: iOS Simulator Example App Interactive Setup

## Description

Set up and run the React Native DL scan example app on iOS simulator with interactive testing capabilities using Mobile MCP. This task establishes a complete development environment for manual testing, UI validation, and iterative development with the ability to request sample ID card images/videos as needed during testing.

The existing SIMULATOR_TESTING_GUIDE.md focuses on automated testing with Jest/Detox mocks, but this task implements the interactive approach using Mobile MCP with WebDriverAgent for real-time app control and testing.

## Goal / Objectives

- Establish a fully functional iOS simulator development environment
- Enable interactive testing using Mobile MCP tools with WebDriverAgent
- Create a framework for requesting and integrating sample ID card test data
- Validate camera permission flows and UI interactions in simulator
- Document the complete setup and testing workflow for future development

## Acceptance Criteria

- [ ] React Native example app successfully builds and runs on iOS simulator
- [ ] Mobile MCP can control the simulator and interact with the app
- [ ] Camera permission flow works correctly (even though camera is non-functional in simulator)
- [ ] "Test Scan" functionality displays sample license data properly
- [ ] UI navigation flow works: Open Camera → Camera View → Close/Back → Main View
- [ ] Sample data integration framework is established for requesting test images
- [ ] Error states are properly handled and displayed
- [ ] Complete workflow is documented for future development sessions

## Subtasks

### Phase 1: Environment Setup
- [x] Verify Node.js 18+ and Yarn 3.6.1 installation
- [x] Verify Xcode and iOS simulator installation  
- [x] Install project dependencies from root directory
- [x] Install example app dependencies and CocoaPods
- [x] Verify iPad Air 11-inch (M3) simulator availability

### Phase 2: App Launch and Validation
- [x] Start Metro bundler in example directory
- [ ] Build and launch app on iOS simulator successfully
- [ ] Verify app displays "DL Scan Test" interface correctly
- [ ] Confirm "Open Camera" and "Test Scan" buttons are present and functional

### Phase 3: Mobile MCP Integration
- [ ] Establish Mobile MCP connection to iOS simulator
- [ ] Verify WebDriverAgent connectivity and functionality
- [ ] Test basic Mobile MCP commands (screenshot, element listing, coordinates)
- [ ] Validate simulator control capabilities

### Phase 4: Interactive Testing Framework
- [ ] Test camera permission request flow using Mobile MCP
- [ ] Validate navigation between main view and camera view
- [ ] Test "Test Scan" button functionality and results display
- [ ] Verify error handling and user-friendly error messages
- [ ] Test reset functionality to return to initial state

### Phase 5: Sample Data Pipeline
- [ ] Establish framework for requesting sample ID card images from user
- [ ] Document sample data requirements (CA/TX licenses, poor lighting, damaged cards)
- [ ] Create process for integrating provided sample images into testing workflow
- [ ] Test sample data integration if images are provided

### Phase 6: Documentation and Validation
- [ ] Document complete setup process with troubleshooting tips
- [ ] Create Mobile MCP command reference for common testing scenarios
- [ ] Validate all functionality works end-to-end
- [ ] Document any simulator limitations and workarounds

## Technical Guidance

### Key Files and Integration Points

**Example App Structure:**
- `example/package.json` - React Native 0.79.2 with New Architecture enabled
- `example/ios/Podfile` - iOS configuration with camera permissions
- `example/src/App.tsx` - Main app component with scanning functionality
- `example/ios/DlScanExample/Info.plist` - Camera permission configuration

**Core Dependencies:**
- React Native Vision Camera v3+ for camera functionality
- DLParser 3.1.0 for license parsing
- React Native Reanimated for animations
- WebDriverAgent for simulator control

**Mobile MCP Commands Reference:**
```javascript
mobile_use_default_device()           // Connect to default simulator
mobile_take_screenshot()              // Capture current state
mobile_list_elements_on_screen()      // Find interactive elements
mobile_click_on_screen_at_coordinates(x, y)  // Tap elements
mobile_type_keys(text, submit)        // Input text
mobile_press_button("HOME"|"BACK")    // Device navigation
swipe_on_screen(direction, distance)  // Scroll gestures
```

### Implementation Approach

**Setup Sequence:**
1. Navigate to project root and run `yarn install`
2. Navigate to example directory: `cd example`
3. Install Ruby dependencies: `bundle install`
4. Install iOS dependencies: `bundle exec pod install --project-directory=ios`
5. Start Metro bundler: `yarn start` (keep running)
6. Launch on simulator: `yarn ios` (new terminal)

**Interactive Testing Workflow:**
1. Use Mobile MCP to take initial screenshot
2. List elements to find button coordinates
3. Test camera permission flow by tapping "Open Camera"
4. Navigate through camera view and back to main view
5. Test "Test Scan" functionality with sample data
6. Verify error handling and reset functionality

**Sample Data Integration:**
- Request sample images when needed: "I need sample ID card images for testing"
- Specify requirements: front-side CA/TX licenses, various lighting conditions
- Document how to integrate provided images into test workflow

### Architecture Alignment

This task aligns with the project's architecture by:
- Supporting the iOS Vision Framework focus
- Enabling development on M3 iPad Air target platform
- Facilitating testing of camera permission flows
- Supporting the offline processing requirement validation
- Providing framework for validating OCR accuracy with real samples

### Known Limitations and Workarounds

- **Camera functionality**: iOS simulator cannot access camera hardware
- **Workaround**: Use "Test Scan" button with mock data and request real sample images for UI testing
- **Performance**: Simulator performance may differ from physical device
- **Workaround**: Document performance observations and note device testing requirements

## Output Log

*(This section will be populated as work progresses on the task)*

[2025-06-23 16:58:48] Created task - iOS Simulator Example App Interactive Setup
[2025-06-23 17:09]: Task status updated to in_progress. Beginning work on iOS simulator setup and Mobile MCP integration.
[2025-06-23 17:13]: Phase 1 completed - Environment setup verified: Node.js v20.19.0, Yarn 3.6.1, Xcode 16.2, iPad Air 11-inch (M3) simulator available and booted.
[2025-06-23 17:23]: Phase 2 - Metro bundler started successfully. Initial iOS build attempt failed with Swift module compilation errors. Opened project in Xcode for manual build attempt.
[2025-06-23 17:30]: Code Review - PASS
Result: **PASS** - Task execution follows documented specifications correctly.
**Scope:** Task T003 - iOS Simulator Example App Interactive Setup
**Findings:** 
- No code changes made (infrastructure setup task)
- Phase 1 environment setup completed as specified
- Phase 2 partially completed with legitimate blocker (Swift compilation errors)
- All executed steps match task documentation requirements
**Summary:** Task is progressing according to specification. The Swift module compilation error is a legitimate technical blocker that requires resolution before proceeding to remaining phases.
**Recommendation:** Continue with manual Xcode build resolution, then complete remaining phases (Mobile MCP integration, interactive testing, documentation).
[2025-06-23 17:31]: Task status changed to blocked due to Swift module compilation errors preventing iOS app build.