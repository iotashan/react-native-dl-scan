// ViewfinderWithPipeline — wraps the Viewfinder + the choreographed
// PipelineOverlay so the overlay is positioned within the viewfinder
// bounds rather than the entire face column (Phase H Wave 1).
//
// Behavior change for phone portrait (intentional, review-flagged):
//
//   - Previously the PipelineOverlay was placed as a child of the
//     `faceColumn` View — a vertical stack of [Viewfinder, ActionBar].
//     The overlay used StyleSheet.absoluteFill, which meant it covered
//     BOTH the viewfinder and the action bar.
//   - Now the overlay is rendered as an absoluteFill INSIDE the
//     viewfinder container. The action bar is no longer covered.
//
// This matches the existing `pointerEvents="none"` semantic — the
// overlay never intercepted touches, so functionally nothing
// changes. Visually the bottom of the choreographed list now
// terminates at the viewfinder's bottom edge instead of the
// face-column bottom edge. Verify on first portrait launch.
//
// The Viewfinder is unchanged — props pass straight through.

import { View, StyleSheet } from 'react-native';
import { Viewfinder, type ViewfinderProps } from './Viewfinder';
import { PipelineOverlay, type PipelineOverlayProps } from '../PipelineOverlay';

export interface ViewfinderWithPipelineProps extends ViewfinderProps {
  /** When true, the PipelineOverlay is mounted (typically `phase ===
   *  'pipeline'`). */
  showPipeline: boolean;
  /** Native pipeline-stage signal forwarded to the overlay. */
  pipelineStage?: PipelineOverlayProps['pipelineStage'];
  /** Called by the overlay when its choreographed sequence completes. */
  onPipelineDone: PipelineOverlayProps['onDone'];
}

export function ViewfinderWithPipeline({
  showPipeline,
  pipelineStage,
  onPipelineDone,
  ...viewfinderProps
}: ViewfinderWithPipelineProps) {
  return (
    <View style={styles.host}>
      <Viewfinder {...viewfinderProps} />
      {showPipeline && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <PipelineOverlay
            mode={viewfinderProps.mode}
            t={viewfinderProps.t}
            direction={viewfinderProps.direction}
            pipelineStage={pipelineStage}
            onDone={onPipelineDone}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    position: 'relative',
  },
});
