// Viewfinder geometry helpers (Phase C of task #71).
//
// Pure functions, no React, no styles — easy to unit-test and easy to
// share between phone, landscape, and tablet usages with different
// fillPct values. The design's Viewfinder did this inline; pulling it
// out also lets the cutout-scrim, reticle, and pipeline overlay all
// agree on the cutout rect without re-deriving it each render.

/**
 * ID-1 (CR80) aspect ratio. Used for the cutout in OCR mode, the ghost
 * license card behind the camera, and the license-hero card on the
 * result face. Defined in the lib's `cpp/constants.hpp` as ID1_ASPECT
 * = 1.5858; we use the rounded design value 1.586 here for visual
 * geometry — the difference is sub-pixel.
 */
export const ID1_ASPECT = 1.586;

/**
 * Per-mode fill height of the cutout relative to the full license
 * card. OCR uses the whole card; barcode mode collapses to just the
 * PDF417 strip at the bottom (about 28% of card height per the design).
 */
export const BARCODE_STRIP_FRAC = 0.28;

export interface ViewfinderGeometry {
  /** Width of the visible license card (OCR mode cutout, ghost card
   *  outline). Pixels in the container's coordinate space. */
  cardW: number;
  /** Height of the visible license card. cardW / ID1_ASPECT clamped
   *  against the container's vertical budget. */
  cardH: number;
  /** Height of the PDF417 strip used as the cutout in barcode mode. */
  barcodeStripH: number;
}

/**
 * Compute viewfinder geometry for a given container size and fill
 * percentage.
 *
 *   fillPct — fraction of container WIDTH the license card should
 *             fill. Design defaults: phone portrait 0.9, phone landscape
 *             0.8, tablet portrait 0.8, tablet landscape 0.5.
 *
 *   verticalBudget — fraction of container HEIGHT the card is allowed
 *             to consume before being clamped (keeps room for chrome
 *             pills above/below). Design default: 0.78.
 *
 * Both dimensions are rounded to integer pixels so RN's layout doesn't
 * produce sub-pixel gaps between the scrim rects and the cutout edges.
 */
export function computeViewfinderGeometry(
  containerW: number,
  containerH: number,
  fillPct: number,
  verticalBudget = 0.78
): ViewfinderGeometry {
  const targetW = containerW * fillPct;
  const targetH = Math.min(targetW / ID1_ASPECT, containerH * verticalBudget);
  const cardW = Math.round(Math.min(targetW, targetH * ID1_ASPECT));
  const cardH = Math.round(cardW / ID1_ASPECT);
  return {
    cardW,
    cardH,
    barcodeStripH: Math.round(cardH * BARCODE_STRIP_FRAC),
  };
}

/**
 * Active cutout rect in the container's local coordinate space.
 * Centered horizontally + vertically (per chat: "the scan target area
 * should be centered H&V"). The OCR cutout is the full card; the
 * barcode cutout is the strip plus a small extra height margin so the
 * brackets don't clip the rendered PDF417 hatch.
 */
export interface CutoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function computeCutoutRect(
  containerW: number,
  containerH: number,
  geometry: ViewfinderGeometry,
  mode: 'ocr' | 'barcode'
): CutoutRect {
  const w = mode === 'ocr' ? geometry.cardW : geometry.cardW - 20;
  const h = mode === 'ocr' ? geometry.cardH : geometry.barcodeStripH + 10;
  return {
    x: Math.round((containerW - w) / 2),
    y: Math.round((containerH - h) / 2),
    w,
    h,
  };
}
