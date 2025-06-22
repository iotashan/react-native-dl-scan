# T02_S06_Mode_Selector_Implementation.md

## Task Metadata
- **Task ID**: T02_S06
- **Sprint**: S06_M04_Core_UI_Components
- **Priority**: High
- **Estimated LOE**: 3 hours
- **Actual LOE**: 
- **Complexity Score**: Low (3/10)
- **Dependencies**: 
  - T01_S06_Camera_View_Component_Setup (completed)
  - Existing DLParser frame processor with mode support
- **Status**: To Do

## Description
Implement a mode selector component that allows users to switch between Auto, Barcode, and OCR scanning modes. The component should integrate with existing UI patterns and state management while providing intuitive gesture support and visual feedback.

## Acceptance Criteria
1. **Mode Selector Component**
   - [ ] Create ModeSelectorComponent with three modes: Auto, Barcode, OCR
   - [ ] Support tap and swipe gestures for mode switching
   - [ ] Animated transitions between modes
   - [ ] Visual indicators for active mode

2. **State Management Integration**
   - [ ] Integrate with existing context/state management pattern
   - [ ] Persist last selected mode between sessions
   - [ ] Emit mode change events for parent components
   - [ ] Handle mode-specific configuration updates

3. **Visual Design**
   - [ ] Follow existing UI patterns from CameraScanner
   - [ ] Responsive layout for different screen sizes
   - [ ] Accessibility support (labels, hints)
   - [ ] Dark mode compatibility

4. **Gesture Support**
   - [ ] Horizontal swipe to cycle through modes
   - [ ] Tap to open mode selection menu
   - [ ] Long press for mode descriptions
   - [ ] Haptic feedback on mode changes

## Technical Implementation Notes

### Component Structure
```tsx
// src/components/ModeSelector.tsx
interface ModeSelectorProps {
  currentMode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  disabled?: boolean;
}

enum ScanMode {
  AUTO = 'auto',
  BARCODE = 'barcode',
  OCR = 'ocr'
}
```

### Reference Patterns
- Use existing button styles from CameraScanner
- Follow gesture patterns from camera controls
- Integrate with current theme system

### Mode Descriptions
- **Auto**: Automatically selects best method
- **Barcode**: Fast PDF417 barcode scanning
- **OCR**: Text recognition for front of license

## Subtasks
- [ ] Create base ModeSelector component structure
- [ ] Implement gesture recognizers and animations
- [ ] Add visual styling and theme integration
- [ ] Connect to state management system
- [ ] Add accessibility and haptic feedback
- [ ] Write unit tests for mode switching logic

## Testing Requirements
- Unit tests for mode selection logic
- UI tests for gesture interactions
- Accessibility tests for screen readers
- Performance tests for animation smoothness

## Success Metrics
- Mode switching completes in <100ms
- All gestures recognized with 95%+ accuracy
- Zero accessibility violations
- Smooth 60fps animations

## Related Files
- `src/components/CameraScanner.tsx` - Reference UI patterns
- `ios/DlScanFrameProcessorPlugin.mm` - Mode parameter handling
- `src/hooks/useDLScanner.ts` - State management integration

## Notes
- Consider adding mode tooltips on first use
- Ensure mode selector doesn't obstruct camera view
- Test with both left and right-handed users
- Consider adding keyboard shortcuts for accessibility