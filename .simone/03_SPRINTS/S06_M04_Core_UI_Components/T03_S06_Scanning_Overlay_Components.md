# T03_S06_Scanning_Overlay_Components.md

## Task Metadata
- **Task ID**: T03_S06
- **Sprint**: S06_M04_Core_UI_Components
- **Priority**: High
- **Estimated LOE**: 3 hours
- **Actual LOE**: 
- **Complexity Score**: Low (3/10)
- **Dependencies**: 
  - T01_S06_Camera_View_Component_Setup (completed)
  - T02_S06_Mode_Selector_Implementation
  - Existing scan frame from CameraScanner
- **Status**: To Do

## Description
Create scanning overlay components with visual guides that adapt to different scanning modes. The overlays should provide clear visual feedback to users about scanning zones, alignment requirements, and real-time scanning status.

## Acceptance Criteria
1. **Base Overlay Component**
   - [ ] Create reusable ScanningOverlay component
   - [ ] Support different overlay shapes (rectangle, card outline)
   - [ ] Animated scanning indicators (pulse, sweep line)
   - [ ] Customizable colors and opacity

2. **Mode-Specific Overlays**
   - [ ] Barcode mode: PDF417 barcode alignment guide
   - [ ] OCR mode: License card outline with corner guides
   - [ ] Auto mode: Adaptive overlay that switches based on detection
   - [ ] Clear visual differentiation between modes

3. **Visual Feedback**
   - [ ] Real-time edge detection highlighting
   - [ ] Success/failure animation states
   - [ ] Progress indicators during processing
   - [ ] Alignment hints and guidance text

4. **Responsive Design**
   - [ ] Adapt to different device sizes and orientations
   - [ ] Maintain aspect ratios for license dimensions
   - [ ] Safe area considerations
   - [ ] Smooth transitions during orientation changes

## Technical Implementation Notes

### Component Structure
```tsx
// src/components/ScanningOverlay.tsx
interface ScanningOverlayProps {
  mode: ScanMode;
  isScanning: boolean;
  detectionState: 'idle' | 'detecting' | 'success' | 'error';
  orientation: 'portrait' | 'landscape';
  onOverlayPress?: () => void;
}
```

### Reference Implementation
- Adapt existing scan frame from `CameraScanner.tsx`
- Use React Native Reanimated for smooth animations
- SVG or Canvas for drawing overlay shapes

### Overlay Specifications
- **License Card Ratio**: 3.375" × 2.125" (1.588:1)
- **Barcode Zone**: Bottom 30% of card area
- **Safe Margins**: 10% padding from screen edges

## Subtasks
- [ ] Create base overlay component with shape rendering
- [ ] Implement mode-specific overlay variations
- [ ] Add scanning animations and transitions
- [ ] Create alignment guide system
- [ ] Implement success/error state animations
- [ ] Add instructional text overlays
- [ ] Optimize performance for 60fps rendering

## Testing Requirements
- Visual regression tests for overlay shapes
- Animation performance tests
- Device compatibility testing
- Orientation change handling tests

## Success Metrics
- Overlay renders at consistent 60fps
- Clear visual distinction between modes
- Users achieve proper alignment in <3 seconds
- Zero layout shifts during scanning

## Related Files
- `src/components/CameraScanner.tsx` - Existing scan frame reference
- `src/components/CameraView.tsx` - Parent component integration
- `src/styles/theme.ts` - Color and styling constants

## Notes
- Consider colorblind-friendly color schemes
- Test overlays in various lighting conditions
- Ensure overlays don't interfere with camera autofocus
- Add subtle haptic feedback on successful alignment
- Consider adding optional grid lines for better alignment