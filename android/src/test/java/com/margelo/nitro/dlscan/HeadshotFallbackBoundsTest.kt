package com.margelo.nitro.dlscan

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Pins the coordinate-space contract of the YOLO-face fallback headshot
 * crop (#126): detection bboxes arrive ALREADY in card-bitmap pixel
 * space, so `faceFallbackBounds` must apply margin + clamp ONLY — never
 * a model-space (640) rescale. The regression this guards against: the
 * old 640→bitmap rescale shifted the crop ~60% right/down of the face
 * and shipped card art (a DONOR emblem, observed live) as the headshot.
 */
class HeadshotFallbackBoundsTest {

    @Test
    fun bboxIsConsumedInBitmapSpace_noModelRescale() {
        // Face at (100,80)-(300,360) on a 1000x630 card bitmap.
        // Height (280) dominates → margin = 280 * 0.05 = 14.
        val out = HybridDLScanAndroid.faceFallbackBounds(
            100f, 80f, 300f, 360f, 1000, 630
        )
        assertArrayEquals(intArrayOf(86, 66, 314, 374), out)
        // The buggy transform multiplied by bitmap/640 (1.5625 here),
        // which would have put the left edge at ~142 even before margin.
        assertNotEquals(142, out[0])
    }

    @Test
    fun marginClampsAtTopLeft() {
        // Margin (12) would push past the origin — clamp to 0.
        val out = HybridDLScanAndroid.faceFallbackBounds(
            5f, 5f, 200f, 250f, 600, 400
        )
        assertArrayEquals(intArrayOf(0, 0, 212, 262), out)
    }

    @Test
    fun marginClampsAtBottomRight() {
        // Margin (7) would overrun the bitmap — clamp to its extent.
        val out = HybridDLScanAndroid.faceFallbackBounds(
            450f, 250f, 598f, 398f, 600, 400
        )
        assertArrayEquals(intArrayOf(443, 243, 600, 400), out)
    }
}
