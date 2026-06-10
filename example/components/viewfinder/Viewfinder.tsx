// Viewfinder — the live-camera overlay composition (Phase C of task #71).
//
// Responsibilities:
//   - Measure its container (onLayout → state) so geometry / scrim /
//     reticle agree on the cutout rect.
//   - Render a `cameraSlot` (the live <Camera/> in production, or a
//     placeholder gradient during Phase C development).
//   - Layer the cutout scrim + corner brackets + scanning sweep over
//     the camera.
//   - Show status chrome (top-left pill, top-right "01/02" step
//     indicator, bottom hint).
//   - In `pipeline` phase, hide all chrome and dim the camera with a
//     thin 10% black wash (the choreographed pipeline list will be
//     drawn on top by the orchestrator).
//   - Conditionally render the FallbackCountdown when `fallbackRemaining`
//     is provided.
//
// The component is intentionally pure-presentational. No timers, no
// camera permissions, no Reanimated values owned at this level — the
// scanning sweep is encapsulated inside Reticle, the countdown ring is
// encapsulated inside FallbackCountdown, and the `phase` machine that
// orchestrates which state we're in lives in App.tsx (Phase G).

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import type { ThemeTokens, Direction } from '../../theme/tokens';
import {
  computeViewfinderGeometry,
  computeCutoutRect,
  type ViewfinderGeometry,
  type CutoutRect,
} from './geometry';
import { CutoutScrim } from './CutoutScrim';
import { Reticle, type ScanPhase, type OcrStage } from './Reticle';
import { FallbackCountdown } from './FallbackCountdown';
import { FieldOverlay } from './FieldOverlay';
import type { LicenseData } from 'react-native-dl-scan';

/**
 * Map a [0,1] OCR progress value to a human-readable stage descriptor.
 * Used to drive the FieldLockTally segments, status pill label, and
 * bottom hint text during OCR scanning.
 */
function ocrProgressStage(p: number): OcrStage | null {
  if (p < 0.02)
    return { tag: 'idle', label: 'Standby', sub: 'No frames yet', fields: 0 };
  if (p < 0.05)
    return {
      tag: 'searching',
      label: 'Searching',
      sub: 'Looking for card edges',
      fields: 0,
    };
  if (p < 0.1)
    return {
      tag: 'detected',
      label: 'Card detected',
      sub: 'Reading fields…',
      fields: 0,
    };
  if (p >= 0.95)
    return {
      tag: 'locked',
      label: 'Fields locked',
      sub: 'Finalizing parse',
      fields: 14,
    };
  const fields = Math.round(((p - 0.1) / 0.85) * 14);
  return {
    tag: 'reading',
    label: 'Reading fields',
    sub: `${fields} / 14 stabilized`,
    fields,
  };
}

export type ViewfinderMode = 'barcode' | 'ocr';

export interface ViewfinderProps {
  mode: ViewfinderMode;
  phase: ScanPhase;
  t: ThemeTokens;
  direction: Direction;
  /** Camera preview slot. In production this is the live
   *  `<Camera/>`; during Phase C it can be a colored View placeholder. */
  cameraSlot?: React.ReactNode;
  /** Fraction of container width the license-card cutout should fill.
   *  Phone portrait 0.9 / phone landscape 0.8 / tablet portrait 0.8 /
   *  tablet landscape 0.5 (per chat with the designer). Caller-driven
   *  because the right fraction depends on layout context the
   *  Viewfinder doesn't see (device class, orientation). */
  fillPct?: number;
  /** Auto-fallback countdown display. `null` = hidden. Always
   *  additionally gated by `mode === 'barcode'` internally — the
   *  countdown only makes sense while waiting for a barcode lock. */
  fallbackRemaining?: number | null;
  fallbackTotal?: number;
  scanProgress?: number;
  detectedCorners?: number[];
  licenseData?: LicenseData | null;
  /**
   * Phase D needs to align the choreographed pipeline overlay to the
   * cutout's spatial position (e.g. center the pipeline list over the
   * card, anchor the flip transform-origin to the card centre).
   * Viewfinder owns the measure → state cycle internally; this
   * callback lets the parent learn the resulting geometry. Fires
   * after every layout-driven recompute. Phase C review review.
   */
  onGeometryChange?: (info: {
    size: { w: number; h: number };
    geometry: ViewfinderGeometry;
    cutout: CutoutRect;
  }) => void;
}

const DEFAULT_FILL = 0.9;

export function Viewfinder({
  mode,
  phase,
  t,
  direction,
  cameraSlot,
  fillPct = DEFAULT_FILL,
  fallbackRemaining = null,
  fallbackTotal = 30,
  scanProgress = 0,
  detectedCorners,
  licenseData,
  onGeometryChange,
}: ViewfinderProps) {
  // Measure-then-compute pattern. The container's intrinsic size comes
  // from its `flex:1` parent; we don't know dimensions until first
  // layout. Render nothing-but-camera before measure to avoid a flash
  // of misaligned scrim on cold start.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Device orientation drives the camera frame's display aspect (the
  // corner-overlay mapping below needs it). The VIEW's own aspect can't
  // stand in for this — e.g. the tablet split-column is a portrait-ish
  // view on a device that may be in either orientation.
  const { width: winW, height: winH } = useWindowDimensions();
  const windowLandscape = winW > winH;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) {
      setSize({ w: width, h: height });
    }
  };

  // Geometry is computed every render once we have a size. Cheap math;
  // memoization would be premature optimization.
  const geometry = size
    ? computeViewfinderGeometry(size.w, size.h, fillPct)
    : null;
  const cutout =
    size && geometry ? computeCutoutRect(size.w, size.h, geometry, mode) : null;

  // Notify the parent whenever geometry recomputes — Phase C review
  // review note: Phase D's pipeline overlay + flip-card animation may
  // need the cutout rect to align its transform-origin and centre
  // its choreographed list. Effect (not inline) so the callback
  // doesn't re-fire mid-render and cause parent loops.
  useEffect(() => {
    if (size && geometry && cutout && onGeometryChange) {
      onGeometryChange({ size, geometry, cutout });
    }
    // Cutout/geometry are derived from size + mode + fillPct, so
    // those are the only deps that actually trigger recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, mode, fillPct, onGeometryChange]);

  // Compute tracked cutout from detected card corners. Corners are
  // normalized [0,1] in DISPLAY orientation (native rotates the sensor
  // frame to match). Map to view pixel space accounting for aspect-fill
  // crop (resizeMode='cover').
  //
  // The 4:3 sensor frame follows the DEVICE orientation after rotation:
  // portrait display → 3:4 (0.75), landscape display → 4:3 (1.333). The
  // cover-crop math below is general (handles the frame being wider OR
  // taller than the view), so orientation-correct frame aspect is the only
  // device-specific input — this is what previously broke the overlay on
  // tablets/landscape, where the old hardcoded 0.75 assumed phone-portrait.
  const trackedCutout = (() => {
    if (!size || !cutout || !detectedCorners || detectedCorners.length !== 8) {
      return null;
    }
    const FRAME_ASPECT = windowLandscape ? 4 / 3 : 3 / 4;
    const viewAspect = size.w / size.h;

    let mapX: (nx: number) => number;
    let mapY: (ny: number) => number;

    if (FRAME_ASPECT > viewAspect) {
      // Frame is wider than view → horizontal crop
      const visFrac = viewAspect / FRAME_ASPECT;
      const cropOff = (1 - visFrac) / 2;
      mapX = (nx) => ((nx - cropOff) / visFrac) * size.w;
      mapY = (ny) => ny * size.h;
    } else {
      // Frame is taller than view → vertical crop
      const visFrac = FRAME_ASPECT / viewAspect;
      const cropOff = (1 - visFrac) / 2;
      mapX = (nx) => nx * size.w;
      mapY = (ny) => ((ny - cropOff) / visFrac) * size.h;
    }

    const xs = [0, 2, 4, 6].map((i) => mapX(detectedCorners[i]));
    const ys = [1, 3, 5, 7].map((i) => mapY(detectedCorners[i]));
    const pad = 12;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    return {
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      w: Math.min(size.w, maxX) - Math.max(0, minX),
      h: Math.min(size.h, maxY) - Math.max(0, minY),
      viewCorners: [
        xs[0],
        ys[0],
        xs[1],
        ys[1],
        xs[2],
        ys[2],
        xs[3],
        ys[3],
      ] as number[],
    };
  })();

  // Use tracked cutout when OCR scanning with a detected card. Persist
  // the last tracked position so the success flash + captured phase
  // don't snap back to the fixed cutout.
  const shouldTrack =
    mode === 'ocr' && phase === 'scanning' && scanProgress >= 0.05;
  const lastTrackedRef = useRef(trackedCutout);
  if (shouldTrack && trackedCutout) {
    lastTrackedRef.current = trackedCutout;
  }
  const reticleCutout =
    shouldTrack && trackedCutout
      ? trackedCutout
      : mode === 'ocr' &&
          (phase === 'captured' || phase === 'pipeline') &&
          lastTrackedRef.current
        ? lastTrackedRef.current
        : cutout;

  // Compute OCR stage from progress — only meaningful during OCR scanning.
  const ocrStage =
    mode === 'ocr' && phase === 'scanning'
      ? ocrProgressStage(scanProgress)
      : null;
  // Show FieldLockTally when we have an active OCR stage (replaces the
  // sweep line and old inline progress bar).
  const showFieldLock = ocrStage != null;

  // The hint pill backdrop and the top status pill share the same
  // tinted-black color. Vellum uses a slightly warmer tint so the
  // chrome doesn't read as a cold rectangle on warm paper-toned
  // surfaces.
  const pillBg =
    direction === 'vellum' ? 'rgba(20,16,10,0.7)' : 'rgba(10,10,14,0.55)';

  return (
    <View
      onLayout={onLayout}
      style={{
        flex: 1,
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: '#000',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.hairline,
      }}
    >
      {/* Camera preview slot. The default is a dim gradient placeholder
       *  so this component is renderable in dev/storyboard contexts
       *  without a real Camera+permission flow. */}
      <View style={StyleSheet.absoluteFill}>
        {cameraSlot ?? <CameraPlaceholder />}
      </View>

      {/* Visual chrome is only drawn when phase ≠ 'pipeline'. The pipeline
       *  phase intentionally hides everything except the camera preview
       *  itself + a 10% black wash so the choreographed pipeline list
       *  reads cleanly without the brackets competing for attention. */}
      {phase !== 'pipeline' && size && cutout && (
        <>
          <CutoutScrim
            containerW={size.w}
            containerH={size.h}
            cutout={reticleCutout ?? cutout}
          />
          <Reticle
            cutout={reticleCutout ?? cutout}
            color={t.reticle}
            successColor={t.tierCV}
            phase={phase}
            showFieldLock={showFieldLock}
            ocrProgress={scanProgress}
            ocrStage={ocrStage}
          />
          {shouldTrack && trackedCutout?.viewCorners && (
            <FieldOverlay
              data={licenseData ?? null}
              viewCorners={trackedCutout.viewCorners}
            />
          )}
          <ViewfinderChrome
            mode={mode}
            phase={phase}
            t={t}
            pillBg={pillBg}
            ocrStage={ocrStage}
          />
          {/* Gate the countdown to barcode mode in addition to the
           *  `fallbackRemaining != null` check — auto-fallback only
           *  applies when waiting for a PDF417 lock. Phase C review
           *  review note. */}
          {fallbackRemaining != null &&
            phase === 'scanning' &&
            mode === 'barcode' && (
              <FallbackCountdown
                remaining={fallbackRemaining}
                total={fallbackTotal}
                t={t}
              />
            )}
        </>
      )}

      {/* Pipeline-phase dim wash. The pipeline overlay (Phase D) is
       *  rendered by the parent and sits on top of this view; here we
       *  only contribute the dim. */}
      {phase === 'pipeline' && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.10)' },
          ]}
        />
      )}
    </View>
  );
}

/**
 * Status chrome — top-left source-state pill, top-right step indicator,
 * bottom hint. All translucent dark pills with blur backdrop. Matches
 * the design's `ViewfinderChrome` component.
 */
function ViewfinderChrome({
  mode,
  phase,
  t,
  pillBg,
  ocrStage,
}: {
  mode: ViewfinderMode;
  phase: ScanPhase;
  t: ThemeTokens;
  pillBg: string;
  ocrStage?: OcrStage | null;
}) {
  // Status dot: pulsing accent during scanning, solid green when locked
  // or captured. When OCR stage is active, use green for 'locked'.
  const statusDot =
    phase === 'captured' || ocrStage?.tag === 'locked' ? t.tierCV : t.reticle;

  // Status label: OCR stage overrides the defaults during OCR scanning.
  const statusLabel = ocrStage
    ? ocrStage.label
    : phase === 'scanning'
      ? mode === 'barcode'
        ? 'Hunting PDF417'
        : 'Reading front'
      : phase === 'captured'
        ? 'Locked'
        : 'Standby';

  // Step counter: OCR mode shows field count when ocrStage is active.
  const stepLabel = ocrStage
    ? `${ocrStage.fields.toString().padStart(2, '0')} / 14`
    : mode === 'barcode'
      ? '01 / 02'
      : '02 / 02';

  // Bottom hint: OCR stage sub-label overrides the static hint.
  const hint = ocrStage
    ? ocrStage.sub
    : mode === 'barcode'
      ? 'Align the PDF417 strip on the back of the license inside the brackets.'
      : 'Flatten the front of the license inside the brackets. Avoid glare.';
  return (
    <>
      {/* Top row */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          right: 14,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Pill bg={pillBg}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: statusDot,
              marginRight: 7,
              // Subtle glow approximating the design's box-shadow.
              shadowColor: statusDot,
              shadowOpacity: 0.8,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 0 },
              elevation: 4,
            }}
          />
          <Text
            style={{
              color: '#fff',
              fontFamily: t.mono,
              fontSize: 10.5,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            {statusLabel}
          </Text>
        </Pill>
        <Pill bg={pillBg}>
          <Text
            style={{
              color: 'rgba(255,255,255,0.78)',
              fontFamily: t.mono,
              fontSize: 10.5,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            {stepLabel}
          </Text>
        </Pill>
      </View>

      {/* Bottom hint */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 18,
          alignItems: 'center',
        }}
      >
        <Pill bg={pillBg} radius={14} maxWidth={280}>
          <Text
            style={{
              color: '#fff',
              fontSize: 12.5,
              fontWeight: '500',
              textAlign: 'center',
            }}
          >
            {hint}
          </Text>
        </Pill>
      </View>
    </>
  );
}

/**
 * Translucent backdrop-blurred pill used for all three chrome
 * affordances. expo-blur's `BlurView` is the iOS+Android primitive.
 */
function Pill({
  bg,
  radius = 999,
  maxWidth,
  children,
}: {
  bg: string;
  radius?: number;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <BlurView
      intensity={36}
      tint="dark"
      // Phase C review review: default expo-blur on Android renders a
      // solid tinted view (no actual blur). 'dimezisBlurView' enables
      // a real blur via the Dimezis library. Perf trade-off: it shaders
      // each frame, so on low-end Android it may dent the camera-
      // preview frame rate. We're OK with that — the pills are small
      // and only visible during scanning, not pipeline.
      experimentalBlurMethod="dimezisBlurView"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: bg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.14)',
        maxWidth,
      }}
    >
      {children}
    </BlurView>
  );
}

/**
 * Placeholder camera feed for dev / storyboard. Replaced by the real
 * <Camera/> in App.tsx during Phase G. Renders a faint radial-style
 * gradient + subtle scanline texture matching the design's "fake
 * camera feed" treatment.
 */
function CameraPlaceholder() {
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: '#14130f',
        },
      ]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#2a2823',
            opacity: 0.4,
            // A simulated gradient via overlapping translucent views
            // would more faithfully match the design's CSS radial-
            // gradient, but the placeholder doesn't need to be
            // pixel-perfect — it's swapped out in Phase G.
          },
        ]}
      />
    </View>
  );
}

export { type ScanPhase, type OcrStage };
