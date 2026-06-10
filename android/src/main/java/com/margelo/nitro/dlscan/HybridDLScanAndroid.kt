package com.margelo.nitro.dlscan

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.YuvImage
import android.util.Log
import androidx.annotation.Keep
import androidx.annotation.VisibleForTesting
import androidx.camera.core.ExperimentalGetImage
import com.facebook.proguard.annotations.DoNotStrip
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.NullType
import com.margelo.nitro.core.Promise
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.support.image.ImageProcessor
import org.tensorflow.lite.support.image.TensorImage
import org.tensorflow.lite.support.image.ops.ResizeOp
import org.tensorflow.lite.support.tensorbuffer.TensorBuffer
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.max
import kotlin.math.min

@DoNotStrip
@Keep
class HybridDLScanAndroid : HybridDLScanSpec() {

    // Monotonic scan progress [0.0, 1.0]. Reset on resetLicenseFieldRecognition.
    @Volatile private var _scanProgress: Double = 0.0
    override val scanProgress: Double get() = _scanProgress

    // Pipeline stage indicator for JS-side progress UI. Values:
    // 0 = idle, 1 = extracting, 2 = normalizing, 3 = saving card,
    // 4 = detecting face, 5 = done. Reset on resetLicenseFieldRecognition.
    @Volatile private var _pipelineStage: Double = 0.0
    override val pipelineStage: Double get() = _pipelineStage

    // Detected card corners normalized to [0,1] — 8 doubles:
    // [TL.x, TL.y, TR.x, TR.y, BR.x, BR.y, BL.x, BL.y].
    // Updated each frame when DocAligner succeeds; empty when no card detected.
    @Volatile private var _detectedCardCorners: DoubleArray = doubleArrayOf()
    override val detectedCardCorners: DoubleArray get() = _detectedCardCorners

    // -------------------------------------------------------------------------
    // JNI bridge — implemented in src/main/cpp/dlscan_jni_bridge.cpp,
    // compiled into libDLScan.so (loaded below in companion object).
    // -------------------------------------------------------------------------

    @DoNotStrip
    @Keep
    private external fun nativeParseBarcode(barcodeData: String): LicenseDataSpec?

    @DoNotStrip
    @Keep
    private external fun nativeExtractOcrFields(lines: Array<String>): LicenseDataSpec?

    @DoNotStrip
    @Keep
    private external fun nativeExtractFieldsCandidates(
        fieldIds: IntArray,
        sources: IntArray,
        texts: Array<String>,
    ): LicenseDataSpec?

    @DoNotStrip
    @Keep
    private external fun nativeClassNameToFieldId(className: String): Int

    /** Maps a YOLO class index (0..29) to the canonical class name string. */
    @DoNotStrip
    @Keep
    private external fun nativeClassName(classId: Int): String

    // ---- v2 voter JNI (task #52). FieldVoter Kotlin wrapper routes here.
    @DoNotStrip @Keep private external fun nativeVoterNew(
        maxVotes: Int, minVotes: Int,
    ): Long
    @DoNotStrip @Keep private external fun nativeVoterDelete(handle: Long)
    @DoNotStrip @Keep private external fun nativeVoterReset(handle: Long)
    @DoNotStrip @Keep private external fun nativeVoterAccept(
        handle: Long, fieldIds: IntArray, sources: IntArray, texts: Array<String>,
    )
    // Returns flat Array<String> length 3*N: [fieldIdStr, sourceStr, text, ...].
    // The wrapper parses ints back to FieldId / FieldSource.
    @DoNotStrip @Keep private external fun nativeVoterConsensus(
        handle: Long
    ): Array<String>?

    // Shared C++ marker-anchored demographic parser
    // (dlscan::parse_aamva_demographic_fields). Input: OCR observation texts
    // in reading order. Returns the same flat Array<String> 3*N wire shape as
    // nativeVoterConsensus ([fieldIdStr, sourceStr, text, ...], source always
    // StrictTextPool). Single source of truth shared with iOS.
    @DoNotStrip @Keep private external fun nativeParseAamvaDemographicFields(
        texts: Array<String>
    ): Array<String>?

    // -------------------------------------------------------------------------
    // ML Kit text recognizer — created once, reused across frames.
    // TextRecognition.getClient is thread-safe per ML Kit documentation.
    // -------------------------------------------------------------------------

    private val textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    // -------------------------------------------------------------------------
    // DocAligner doc-segmentation model — lazy-loaded once per hybrid instance.
    // -------------------------------------------------------------------------

    // lcnet100 heatmap regression,
    // FP16 TFLite (2.4 MB asset). Output: 4-channel 128x128 heatmap; per
    // channel = one corner (trained order: TL, TR, BR, BL).
    private val docAlignerLock = ReentrantLock()
    private var docAlignerInterpreter: Interpreter? = null
    private var docAlignerLoadAttempted = false

    /**
     * Per-field multi-frame voter (round-8 design — task #33).
     *
     * Each scanned frame contributes one observation per detected field to
     * a bounded history (deque, capped at [maxVotes]); each call to
     * [consensus] returns the per-field exact-string majority winner.
     * Replaces the previous "first non-null frame wins" lock: ML Kit's
     * frame-to-frame OCR variance ("JOHN QUINCYY" / "JOHN QUINCY",
     * "8 4242 ASHWOOD" / "84242 ASHWOOD") was making first-wins
     * lock-in unreliable.
     *
     * Exact-string match by design — variance on the user's WI license is
     * predominantly 1-char OCR noise that majority handles directly. If
     * future testing shows multi-variant ties (3+ distinct readings of the
     * same field, no clear winner), add Levenshtein bucketing as a
     * separate pass.
     *
     * Hard cap of 20 votes per field prevents unbounded memory growth on
     * a long-held scan session; the FIFO eviction prefers fresh data over
     * stale captures from earlier (different camera angle / lighting).
     */
    /**
     * Thin JNI wrapper around dlscan::FieldVoter. The voting algorithm + the
     * (FieldId, FieldSource) bucket-keying live in C++ (cpp/voter.cpp,
     * 14 unit tests).
     *
     * v2 Sequence G (task #54) — typed `List<FieldCandidate>` surface.
     * Replaces the legacy Map<String,String> wire format and the
     * "_strict" key-suffix provenance encoding. Provenance now lives in
     * FieldCandidate.source. The C++ resolver still buckets candidates by
     * (FieldId, FieldSource) — the StrictAgrees → CrossValidated (1.00)
     * upgrade is preserved by concat'ing source-tagged candidates rather
     * than collapsing to a Map<FieldId, text>.
     *
     * Lifetime: handle allocated eagerly at construction, freed via [close].
     * The host HybridDLScanAndroid object outlives all calls; we don't try
     * to implement AutoCloseable because the JS side controls reset via
     * resetLicenseFieldRecognition() not destruction.
     */
    private inner class FieldVoter(maxVotes: Int = 20, minVotes: Int = 2) {
        private var handle: Long = nativeVoterNew(maxVotes, minVotes)

        fun accept(candidates: List<FieldCandidate>) {
            if (handle == 0L || candidates.isEmpty()) return
            val n = candidates.size
            val fieldIds = IntArray(n)
            val sources = IntArray(n)
            val texts = arrayOfNulls<String>(n)
            for (i in 0 until n) {
                val c = candidates[i]
                fieldIds[i] = c.fieldId
                sources[i] = c.source
                texts[i] = c.text
            }
            @Suppress("UNCHECKED_CAST")
            nativeVoterAccept(handle, fieldIds, sources, texts as Array<String>)
        }

        fun consensus(): List<FieldCandidate> {
            if (handle == 0L) return emptyList()
            val flat = nativeVoterConsensus(handle) ?: return emptyList()
            // Wire format: 3 strings per record [fieldIdStr, sourceStr, text].
            val n = flat.size / 3
            if (n == 0) return emptyList()
            val out = ArrayList<FieldCandidate>(n)
            for (i in 0 until n) {
                val fid = flat[i * 3].toIntOrNull() ?: continue
                val src = flat[i * 3 + 1].toIntOrNull() ?: continue
                val txt = flat[i * 3 + 2]
                out.add(FieldCandidate(fid, src, txt))
            }
            return out
        }

        fun reset() {
            if (handle == 0L) return
            nativeVoterReset(handle)
        }

        @Synchronized
        fun close() {
            if (handle != 0L) {
                nativeVoterDelete(handle)
                handle = 0L  // idempotent: stop the GC FinalizerDaemon from
                             // double-freeing (finalize -> close -> delete).
            }
        }

        protected fun finalize() {
            // Defensive — main lifecycle goes through close(). Finalizer
            // is a backstop, not the primary cleanup path.
            close()
        }
    }

    private val voter = FieldVoter(maxVotes = 20, minVotes = 2)

    // Temporal smoothing of doc-seg corners — INSTANCE state (not companion)
    // so multiple scanner instances don't clobber each other's caches.
    // Reused when the current frame has a partial channel failure (per-corner
    // signal dropout) but a recent neighbouring frame had a clean 4-corner
    // lock. TTL kept short (350 ms) so a moved card invalidates fast; bitmap
    // dimensions are checked because a resolution change makes the cached
    // corner coordinates meaningless. paired plan, 2026-05-10.
    private var lastCorners: FloatArray? = null
    private var lastCornersTimestamp: Long = 0L
    private var lastCornersBitmapW: Int = 0
    private var lastCornersBitmapH: Int = 0

    // -------------------------------------------------------------------------
    // Telemetry counters (round-5 design — task #30).
    //
    // All counters are instance-scoped (per scanner session) and mutated
    // single-threaded from inside `ocrExtractFields`.
    // Flushed to logcat at the same 2-second throttle as the IoU debug log.
    // Counters reset each flush so a single log line covers a discrete window.
    // PII rule: never include raw observation text in telemetry — counts and
    // class names only.
    // -------------------------------------------------------------------------
    private var telemetryCacheHits = 0
    private var telemetryCacheMisses = 0
    private var telemetryLastCacheAgeMs = -1L
    private val telemetryPrefixMismatchByClass = HashMap<String, Int>()
    private var telemetryDemoSeen = 0
    private var telemetryDemoFailGateA = 0   // (a) index not in demographic set
    private var telemetryDemoFailGateB = 0   // (b) label incompatible with index
    private var telemetryDemoFailGateC = 0   // (c) value outside expected domain
    private var telemetryDemoFailGateD = 0   // (d) ambiguous — multiple candidates
    private var telemetryDemoAccepted = 0
    private var lastTelemetryLogMs = 0L

    private fun maybeFlushTelemetry() {
        val now = System.currentTimeMillis()
        if (now - lastTelemetryLogMs < 2000L) return
        lastTelemetryLogMs = now
        val mismatchSummary = telemetryPrefixMismatchByClass.entries
            .sortedByDescending { it.value }
            .take(6)
            .joinToString(",") { "${it.key}:${it.value}" }
        if (VERBOSE_LOGGING) {
            Log.i(
                TAG,
                "TELEMETRY corner_cache=" + telemetryCacheHits + "h/" + telemetryCacheMisses + "m" +
                    " last_cache_age_ms=" + telemetryLastCacheAgeMs +
                    " demo_gates=" + telemetryDemoAccepted + "ok/" +
                    telemetryDemoFailGateA + "idx/" +
                    telemetryDemoFailGateB + "lbl/" +
                    telemetryDemoFailGateC + "dom/" +
                    telemetryDemoFailGateD + "amb" +
                    " demo_seen=" + telemetryDemoSeen +
                    " prefix_mismatch=[" + mismatchSummary + "]"
            )
        }
        telemetryCacheHits = 0
        telemetryCacheMisses = 0
        telemetryLastCacheAgeMs = -1L
        telemetryPrefixMismatchByClass.clear()
        telemetryDemoSeen = 0
        telemetryDemoFailGateA = 0
        telemetryDemoFailGateB = 0
        telemetryDemoFailGateC = 0
        telemetryDemoFailGateD = 0
        telemetryDemoAccepted = 0
    }

    // -------------------------------------------------------------------------
    // Scan-session state
    // -------------------------------------------------------------------------

    @Volatile private var cardCapturedThisSession = false

    // JS-orchestration rectify cache (mirrors iOS). rectifyFrame() exposes the
    // rectified RGB to JS for fast-tflite NanoDet detection; ocrExtractFields()
    // consumes the JS detections against the cached bitmaps by token.
    private val rectifyLock = ReentrantLock()
    private var lastRectifyTime: Long = 0L
    private var nextRectifyToken: Double = 1.0
    private data class RectEntry(val source: Bitmap, val corners: FloatArray, val ocrBitmap: Bitmap)
    private val rectifiedCache = HashMap<Double, RectEntry>()

    // TTA-as-verification retained crop (mirrors iOS). The BEST captured card
    // crop — the consensus rectified RGB8 bytes kept on the frame that saved
    // cardImagePath. runTtaVerification() augments + re-OCRs this to recover
    // small glyphs a single OCR pass misses. Retained as raw RGB8 (row-major,
    // 3 B/px) + dims so dlscan_augment_rgb (via nativeAugmentRgb) can drive the
    // augmented re-OCR. Guarded by rectifyLock; cleared in
    // resetLicenseFieldRecognition.
    private var ttaRetainedRgb: ByteArray? = null
    private var ttaRetainedWidth: Int = 0
    private var ttaRetainedHeight: Int = 0

    // -------------------------------------------------------------------------
    // parseBarcodeData — runs C++ AAMVA parser off the JS thread.
    // -------------------------------------------------------------------------

    override fun parseBarcodeData(barcodeData: String): Promise<Variant_NullType_LicenseDataSpec> {
        return Promise.parallel {
            val spec = nativeParseBarcode(barcodeData)
            if (spec == null) {
                Variant_NullType_LicenseDataSpec.create(NullType.NULL)
            } else {
                Variant_NullType_LicenseDataSpec.create(spec)
            }
        }
    }

    /**
     * Run DocAligner (lcnet100 FP16 TFLite) to locate the 4 corners of the
     * document in [bitmap]. Returns 8 floats — [tlX, tlY, trX, trY, brX, brY,
     * blX, blY] — in the bitmap's pixel space, or null if the model isn't
     * loaded, returns dead heatmaps, or produces degenerate output.
     *
     * Preprocess: resize bitmap → 256x256 NHWC float32 in [0, 1].
     * Inference: ~10 ms on Pixel 6 CPU + XNNPACK (FP16 model).
     * Postprocess: per-channel soft-argmax over pixels above
     *   DOC_HEATMAP_THRESHOLD, then rescale 128 → bitmap pixel space.
     *   Channel order is fixed at training time (TL, TR, BR, BL).
     */
    private fun runDocAligner(bitmap: Bitmap): FloatArray? {
        val interpreter = ensureDocAlignerInterpreter() ?: return null

        // Preprocess: bitmap → 256x256 RGB float32 NHWC in [0, 1].
        val scaled = Bitmap.createScaledBitmap(bitmap, DOC_INPUT_SIZE, DOC_INPUT_SIZE, true)
        val pixels = IntArray(DOC_INPUT_SIZE * DOC_INPUT_SIZE)
        scaled.getPixels(pixels, 0, DOC_INPUT_SIZE, 0, 0, DOC_INPUT_SIZE, DOC_INPUT_SIZE)
        if (scaled !== bitmap) scaled.recycle()

        val inputBuffer = ByteBuffer.allocateDirect(4 * DOC_INPUT_SIZE * DOC_INPUT_SIZE * 3)
            .order(ByteOrder.nativeOrder())
        val fb = inputBuffer.asFloatBuffer()
        for (px in pixels) {
            fb.put(((px shr 16) and 0xFF).toFloat() / 255f)
            fb.put(((px shr 8) and 0xFF).toFloat() / 255f)
            fb.put((px and 0xFF).toFloat() / 255f)
        }
        inputBuffer.rewind()

        // Output: (1, 128, 128, 4) NHWC float32 = 65536 floats.
        val outputBuffer = ByteBuffer.allocateDirect(4 * DOC_HMAP_SIZE * DOC_HMAP_SIZE * 4)
            .order(ByteOrder.nativeOrder())

        try {
            interpreter.run(inputBuffer, outputBuffer.rewind())
        } catch (t: Throwable) {
            Log.e(TAG, "DocAligner Interpreter.run threw", t)
            return null
        }

        val output = FloatArray(DOC_HMAP_SIZE * DOC_HMAP_SIZE * 4)
        outputBuffer.rewind()
        outputBuffer.asFloatBuffer().get(output)

        // Decode each of the 4 channels (TL/TR/BR/BL) via soft-argmax over
        // pixels above DOC_HEATMAP_THRESHOLD. NHWC means channel is the
        // fastest-varying axis: index = (y * W + x) * 4 + ch.
        val corners = FloatArray(8)
        var maxHmap = 0f
        for (ch in 0 until 4) {
            var sumW = 0f; var sumX = 0f; var sumY = 0f
            for (y in 0 until DOC_HMAP_SIZE) {
                val rowBase = y * DOC_HMAP_SIZE * 4
                for (x in 0 until DOC_HMAP_SIZE) {
                    val v = output[rowBase + x * 4 + ch]
                    if (v > maxHmap) maxHmap = v
                    if (v < DOC_HEATMAP_THRESHOLD) continue
                    sumW += v
                    sumX += x * v
                    sumY += y * v
                }
            }
            if (sumW < 1e-4f) {
                // Channel produced no above-threshold pixels — heatmap is dead
                // for this corner. round-5 (task #82): reusing the
                // previous frame's full quadrilateral against this frame's
                // perspective produced garbage rectifications (YOLO maxRaw
                // collapsing to 0.0) ~70% of the time on Pixel 6 in good
                // lighting. Cleaner to skip the frame entirely and let the
                // voter accumulate from frames where docseg succeeded
                // outright. Slower scans, but each output is meaningful.
                if (VERBOSE_LOGGING) {
                    val nowDbg = System.currentTimeMillis()
                    if (nowDbg - lastDocSegLog > 2000L) {
                        lastDocSegLog = nowDbg
                        Log.i(TAG, "DEBUG: DocAligner channel $ch had no signal (maxHmap=" + maxHmap + ") — skipping frame")
                    }
                }
                telemetryCacheMisses += 1
                return null
            }
            // (cx_hmap, cy_hmap) → bitmap pixel space.
            // Heatmap covers the same field of view as the 256x256 input,
            // which itself covers the full bitmap (no letterbox in docseg).
            val cxHmap = sumX / sumW
            val cyHmap = sumY / sumW
            val cxBitmap = cxHmap * (bitmap.width.toFloat() / DOC_HMAP_SIZE.toFloat())
            val cyBitmap = cyHmap * (bitmap.height.toFloat() / DOC_HMAP_SIZE.toFloat())
            corners[ch * 2] = cxBitmap
            corners[ch * 2 + 1] = cyBitmap
        }

        // Reject obviously-degenerate quads: zero area, or any pair of corners
        // within 1% of frame diagonal of each other. Without this guard, a
        // partially-visible card produces a near-collinear quad that
        // Matrix.setPolyToPoly will silently degrade to identity.
        val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
        val minDist = 0.01f * kotlin.math.sqrt(w * w + h * h)
        for (i in 0 until 4) {
            for (j in i + 1 until 4) {
                val dx = corners[i * 2] - corners[j * 2]
                val dy = corners[i * 2 + 1] - corners[j * 2 + 1]
                if (dx * dx + dy * dy < minDist * minDist) {
                    if (VERBOSE_LOGGING) {
                        Log.i(TAG, "DEBUG: DocAligner rejected degenerate quad (corners $i,$j too close)")
                    }
                    return null
                }
            }
        }

        // DEBUG: dump rectified bitmap + log corners once so the first frame's
        // output can be adb-pulled. Throttled by yoloDebugDumped-style flag.
        // PII gate (task #47): debug builds only — this would log raw card
        // corner coordinates and is followed by the rectified-bitmap dump.
        if (BuildConfig.DEBUG && !docSegDebugDumped) {
            docSegDebugDumped = true
            Log.i(TAG, "DEBUG: DocAligner corners (maxHmap=" + maxHmap + "): TL=("
                + corners[0].toInt() + "," + corners[1].toInt() + ") TR=("
                + corners[2].toInt() + "," + corners[3].toInt() + ") BR=("
                + corners[4].toInt() + "," + corners[5].toInt() + ") BL=("
                + corners[6].toInt() + "," + corners[7].toInt() + ")")
        }

        // Cache for temporal smoothing — next frame's per-channel dropout can
        // fall back to these corners as long as the bitmap dimensions match
        // and the cache is fresher than DOC_CORNERS_TTL_MS.
        lastCorners = corners.copyOf()
        lastCornersTimestamp = System.currentTimeMillis()
        lastCornersBitmapW = bitmap.width
        lastCornersBitmapH = bitmap.height

        return corners
    }

    // ─── Card image capture + headshot extraction (#92, #93) ─────────────

    private val cardImageDir: java.io.File by lazy {
        val ctx = com.dlscan.DLScanPackage.appContext
            ?: throw IllegalStateException("DLScanPackage.appContext is null")
        val dir = java.io.File(ctx.filesDir, "dlscan-cards")
        dir.mkdirs()
        dir
    }

    /**
     * Saves the padded perspective-corrected card as JPEG and returns
     * `(file:// path, per-line OCR observations over that EXACT image)`.
     *
     * #82: the in-pipeline whole-card OCR ran on a DIFFERENT rectification
     * (unpadded corners), so its boxes do NOT live in the saved image's
     * pixel space and cannot be reused — a dedicated pass runs here, once
     * per scan. Observations are fail-soft: null on any OCR difficulty,
     * never blocking the card save itself.
     */
    private fun saveRectifiedCard(
        sourceFrame: Bitmap,
        corners: FloatArray,
        // `false` skips the dedicated card-image OCR pass entirely — used by
        // the images-only capture mode, whose contract is "no OCR runs"
        // (observations are documented absent there, and skipping the pass is
        // part of the mode's performance win).
        withObservations: Boolean = true
    ): Pair<String, Array<OcrObservationSpec>?>? {
        return try {
            val padded = expandCorners(corners, sourceFrame.width, sourceFrame.height, 0.06f)
            val cardBitmap = rectifyBitmap(
                sourceFrame, padded, OCR_RECTIFY_WIDTH, OCR_RECTIFY_HEIGHT
            )
            val id = java.util.UUID.randomUUID().toString()
            val file = java.io.File(cardImageDir, "$id-card.jpg")
            java.io.FileOutputStream(file).use { out ->
                cardBitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
            }
            val observations = if (withObservations) cardImageObservations(cardBitmap) else null
            if (cardBitmap !== sourceFrame) cardBitmap.recycle()
            Pair("file://${file.absolutePath}", observations)
        } catch (t: Throwable) {
            Log.w(TAG, "saveRectifiedCard failed", t)
            null
        }
    }

    /**
     * #82: per-line OCR observations over the EXACT saved card bitmap, so
     * the returned boxes share `cardImagePath`'s pixel space. MLKit
     * `Text.Line.boundingBox` is in bitmap PIXELS with a top-left origin
     * already — normalize by the bitmap dimensions to the spec's [0,1]
     * top-left contract. Fail-soft: any error or empty OCR → null.
     */
    private fun cardImageObservations(bitmap: Bitmap): Array<OcrObservationSpec>? {
        return try {
            val w = bitmap.width.toDouble()
            val h = bitmap.height.toDouble()
            if (w <= 0.0 || h <= 0.0) return null
            val visionResult = Tasks.await(
                textRecognizer.process(InputImage.fromBitmap(bitmap, 0)),
                5L,
                java.util.concurrent.TimeUnit.SECONDS
            )
            val out = mutableListOf<OcrObservationSpec>()
            for (block in visionResult.textBlocks) {
                for (line in block.lines) {
                    val box = line.boundingBox ?: continue
                    if (line.text.isEmpty()) continue
                    // MLKit boxes can extend slightly past the bitmap edges;
                    // clamp edges first so the normalized box stays in [0,1]
                    // and width/height stay consistent with the clamped x/y.
                    val left = box.left.coerceIn(0, bitmap.width).toDouble()
                    val top = box.top.coerceIn(0, bitmap.height).toDouble()
                    val right = box.right.coerceIn(0, bitmap.width).toDouble()
                    val bottom = box.bottom.coerceIn(0, bitmap.height).toDouble()
                    if (right <= left || bottom <= top) continue
                    out.add(
                        OcrObservationSpec(
                            text = line.text,
                            x = left / w,
                            y = top / h,
                            width = (right - left) / w,
                            height = (bottom - top) / h
                        )
                    )
                }
            }
            if (out.isEmpty()) null else out.toTypedArray()
        } catch (t: Throwable) {
            Log.w(TAG, "cardImageObservations failed", t)
            null
        }
    }

    private fun expandCorners(
        corners: FloatArray,
        frameW: Int,
        frameH: Int,
        pct: Float
    ): FloatArray {
        val cx = (corners[0] + corners[2] + corners[4] + corners[6]) / 4f
        val cy = (corners[1] + corners[3] + corners[5] + corners[7]) / 4f
        val out = corners.copyOf()
        for (i in out.indices step 2) {
            val dx = out[i] - cx
            val dy = out[i + 1] - cy
            out[i] = (cx + dx * (1f + pct)).coerceIn(0f, frameW.toFloat())
            out[i + 1] = (cy + dy * (1f + pct)).coerceIn(0f, frameH.toFloat())
        }
        return out
    }

    @Suppress("DEPRECATION")
    private fun extractHeadshot(
        cardBitmap: Bitmap,
        yoloDetections: List<Detection>,
        cardImagePath: String?
    ): String? {
        // 1. Try MLKit Face Detection (higher quality, tighter crop).
        var faceBounds: android.graphics.Rect? = null
        try {
            val faceDetector = com.google.mlkit.vision.face.FaceDetection.getClient(
                com.google.mlkit.vision.face.FaceDetectorOptions.Builder()
                    .setPerformanceMode(com.google.mlkit.vision.face.FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                    .build()
            )
            val inputImage = InputImage.fromBitmap(cardBitmap, 0)
            val faces = Tasks.await(faceDetector.process(inputImage), 3L, java.util.concurrent.TimeUnit.SECONDS)
            faceDetector.close()
            if (faces.isNotEmpty()) {
                val bb = faces[0].boundingBox
                val margin = (maxOf(bb.width(), bb.height()) * 0.40f).toInt()
                faceBounds = android.graphics.Rect(
                    maxOf(0, bb.left - margin),
                    maxOf(0, bb.top - margin),
                    minOf(cardBitmap.width, bb.right + margin),
                    minOf(cardBitmap.height, bb.bottom + margin)
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "MLKit FaceDetection failed, trying YOLO fallback", t)
        }

        // 2. Fallback: YOLO "face" class bbox. YOLO bboxes are in 640x640
        //    space; scale to ocrBitmap space.
        if (faceBounds == null) {
            val faceDetection = yoloDetections.firstOrNull { it.name == "face" }
            if (faceDetection != null) {
                val scaleX = cardBitmap.width.toFloat() / YOLO_INPUT_SIZE.toFloat()
                val scaleY = cardBitmap.height.toFloat() / YOLO_INPUT_SIZE.toFloat()
                val bb = faceDetection.bbox
                val l = (bb.left * scaleX).toInt()
                val t = (bb.top * scaleY).toInt()
                val r = (bb.right * scaleX).toInt()
                val b = (bb.bottom * scaleY).toInt()
                val margin = (maxOf(r - l, b - t) * 0.05f).toInt()
                faceBounds = android.graphics.Rect(
                    maxOf(0, l - margin),
                    maxOf(0, t - margin),
                    minOf(cardBitmap.width, r + margin),
                    minOf(cardBitmap.height, b + margin)
                )
            }
        }

        if (faceBounds == null || faceBounds.width() <= 0 || faceBounds.height() <= 0) return null

        return try {
            val cropped = Bitmap.createBitmap(
                cardBitmap,
                faceBounds.left, faceBounds.top,
                faceBounds.width(), faceBounds.height()
            )
            val id = if (cardImagePath != null) {
                java.io.File(java.net.URI(cardImagePath).path)
                    .nameWithoutExtension.replace("-card", "")
            } else {
                java.util.UUID.randomUUID().toString()
            }
            val file = java.io.File(cardImageDir, "$id-headshot.jpg")
            java.io.FileOutputStream(file).use { out ->
                cropped.compress(Bitmap.CompressFormat.JPEG, 85, out)
            }
            cropped.recycle()
            "file://${file.absolutePath}"
        } catch (t: Throwable) {
            Log.w(TAG, "extractHeadshot failed", t)
            null
        }
    }

    /**
     * Perspective-rectify [src] using [corners] (8 floats: TL/TR/BR/BL pairs)
     * to an [outSize] x [outSize] canvas. Backed by Android's built-in
     * Matrix.setPolyToPoly(count=4), which solves the 4-point homography
     * natively — no OpenCV dep required.
     *
     * Returns [src] resized to a square if the homography is degenerate
     * (Matrix.setPolyToPoly returns false on collinear corners).
     */
    private fun rectifyBitmap(src: Bitmap, corners: FloatArray, outW: Int, outH: Int): Bitmap {
        val dstPts = floatArrayOf(
            0f, 0f,
            (outW - 1).toFloat(), 0f,
            (outW - 1).toFloat(), (outH - 1).toFloat(),
            0f, (outH - 1).toFloat()
        )
        val matrix = android.graphics.Matrix()
        val ok = matrix.setPolyToPoly(corners, 0, dstPts, 0, 4)
        if (!ok) {
            Log.w(TAG, "rectifyBitmap: setPolyToPoly returned false (degenerate quad)")
            return Bitmap.createScaledBitmap(src, outW, outH, true)
        }
        val out = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(out)
        val paint = android.graphics.Paint(
            android.graphics.Paint.ANTI_ALIAS_FLAG or android.graphics.Paint.FILTER_BITMAP_FLAG
        )
        canvas.drawBitmap(src, matrix, paint)

        // DEBUG: dump the first rectified bitmap so we can adb-pull and
        // visually verify the doc-seg → rectify chain on-device.
        // PII gate (task #47): debug builds only — rectified bitmap is the
        // full card image.
        if (BuildConfig.DEBUG && !docSegRectifiedDumped) {
            docSegRectifiedDumped = true
            try {
                val ctx = com.dlscan.DLScanPackage.appContext
                val dir = ctx?.getExternalFilesDir(null)
                if (dir != null) {
                    val f = java.io.File(dir, "dlscan-docseg-rectified.png")
                    java.io.FileOutputStream(f).use { os ->
                        out.compress(Bitmap.CompressFormat.PNG, 100, os)
                    }
                    Log.i(TAG, "DEBUG: wrote rectified bitmap to " + f.absolutePath)
                }
            } catch (t: Throwable) {
                Log.w(TAG, "DEBUG rectified dump failed", t)
            }
        }
        return out
    }

    /**
     * Lazy-init the DocAligner TFLite Interpreter. Returns null on missing
     * asset or load failure, and doesn't latch the failure permanently if the
     * package context is just not ready yet.
     */
    private fun ensureDocAlignerInterpreter(): Interpreter? {
        docAlignerLock.withLock {
            docAlignerInterpreter?.let { return it }
            if (docAlignerLoadAttempted) return null
            docAlignerLoadAttempted = true

            val context = com.dlscan.DLScanPackage.appContext ?: run {
                Log.e(TAG, "DLScanPackage.appContext is null; package not yet booted?")
                docAlignerLoadAttempted = false
                return null
            }
            return try {
                val modelBuffer = loadModelFile(context, "docaligner_lcnet100.tflite")
                val interpreter = Interpreter(modelBuffer, Interpreter.Options())
                docAlignerInterpreter = interpreter
                if (VERBOSE_LOGGING) {
                    Log.i(TAG, "DocAligner TFLite loaded (" + modelBuffer.capacity() + " bytes)")
                }
                interpreter
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to load DocAligner TFLite", t)
                null
            }
        }
    }

    private fun loadModelFile(
        context: android.content.Context,
        assetName: String
    ): MappedByteBuffer {
        val afd = context.assets.openFd(assetName)
        val fileChannel = java.io.FileInputStream(afd.fileDescriptor).channel
        return fileChannel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
    }

    // -------------------------------------------------------------------------
    // Bbox-matching algorithm (mirrors HybridDLScanIOS.matchObservationsToFields).
    // -------------------------------------------------------------------------

    /** YOLO classes whose values legitimately span multiple OCR observations. */
    private val multilineFieldClasses = setOf("list_5", "list_8f")

    private data class Detection(val name: String, val bbox: RectF, val conf: Float)

    /**
     * Typed field candidate (v2 Sequence G — task #54). Mirrors
     * `dlscan::FieldCandidate` C++-side. Replaces the legacy
     * `Map<String, String>` wire format with the `_strict` key suffix
     * convention; provenance now lives in [source] as a FieldSource int.
     */
    private data class FieldCandidate(
        /** dlscan::FieldId enum int. List1=1, List15=15, List4d=43, ... */
        val fieldId: Int,
        /** dlscan::FieldSource enum int. See [FieldSource] constants. */
        val source: Int,
        /** Trimmed value text. Empty texts are filtered before reaching this type. */
        val text: String,
    )

    /** dlscan::FieldSource enum mirror — values MUST match the C++ enum exactly. */
    private object FieldSource {
        const val Unknown = 0
        const val Barcode = 1
        const val BboxIoU = 2
        const val StrictTextPool = 3
        const val Manual = 4
    }
    /**
     * One OCR observation. [sourceLineIndex] + [indexWithinSourceLine] let the
     * demographic parser do bounded 1-step lookahead from a label-cluster to
     * the adjacent value-cluster on the same physical card row (round-7).
     * E.g. on the user's WI licence, ML Kit returns "9 CLASS" and "D" as the
     * small-font label + the large-font value of the vehicle-class field;
     * after height-clustering they become two observations with the same
     * sourceLineIndex but sequential indexWithinSourceLine, so the parser
     * can recognise the (index 9, label CLASS) AAMVA token in observation N
     * and adopt observation N+1's text "D" as its value.
     */
    private data class OcrObservation(
        val text: String,
        val bbox: RectF,
        val sourceLineIndex: Int = -1,
        val indexWithinSourceLine: Int = 0,
    )
    private data class Match(val obsIndex: Int, val iou: Float)

    /**
     * Cluster a single ML Kit line's elements by glyph height into one
     * observation per visually-coherent group. ML Kit does not expose font
     * size/weight, but the per-`Text.Element` bounding-box height directly
     * encodes the printed glyph size. This splits "small AAMVA-index +
     * label + large value" rows where MLKit fused everything into one
     * line — the canonical case on the user's WI licence:
     *
     *     "4d D440-1234-5678-99 9 CLASS D"
     *      ─┬─ ──────┬──────── ─┬───── ┬
     *       │        │          │      └─ ~64 px (bold)
     *       │        │          └──────── ~18 px (small label)
     *       │        └─────────────────── ~48 px (value)
     *       └──────────────────────────── ~30 px (small index)
     *
     * Algorithm (round-7 design):
     *   1. Use `cornerPoints` height when available for perspective-aware
     *      glyph height; fall back to axis-aligned `boundingBox.height`.
     *   2. Greedy left-to-right grouping. New element joins the current
     *      cluster iff `min(h, clusterMedian) / max(h, clusterMedian) >= 0.75`
     *      (equivalent to ±25% but ratio-clean). Otherwise opens a new
     *      cluster — this preserves intentional mixed-font groupings.
     *   3. Running cluster median, not a global pre-pass median: global
     *      medians get pulled toward the dominant size and obscure the
     *      split boundary we need.
     *   4. Each output observation carries [sourceLineIndex] +
     *      [indexWithinSourceLine] for the demographic parser's 1-step
     *      lookahead path (empty-value label-cluster adopts next adjacent
     *      cluster's text as value).
     *
     * If only one cluster emerges (typical for monospaced rows like
     * "1 DOEFORD" or "SPRINGFIELD, WI 53703"), returns a single observation
     * with the full line bbox to keep the existing IoU matching geometry.
     */
    private fun clusterLineByElementHeight(
        line: com.google.mlkit.vision.text.Text.Line,
        lineBbox: RectF,
        sourceLineIndex: Int,
    ): List<OcrObservation> {
        val elements = line.elements
        // Empirical finding (live diagnostic logs, 2026-05-10): ML Kit
        // reports per-element AND per-symbol heights normalized to the
        // line bbox, NOT per-glyph height. The "4 D440-1234-5678-99 cus D"
        // row on user's WI licence — visually 4 different font sizes —
        // came back with all elements + all symbols at uniform 34 px.
        // Horizontal gaps also don't separate the visual columns (gap
        // between "07" and the small "9 CLASS" was only 14 px, ~2x the
        // intra-cluster gap of 8 px, not the big visual jump we'd hoped
        // for). Conclusion: MLKit gives NO usable font-size signal.
        // Content-shape constraints are the only remaining defense; see
        // tightenByContentShape() applied in matchObservationsToFields.
        if (elements.size < 2) {
            return listOf(OcrObservation(line.text, lineBbox, sourceLineIndex, 0))
        }
        // Build per-element records, computing perspective-aware height
        // from cornerPoints if available.
        data class Elem(val text: String, val bbox: RectF, val height: Float)
        val elems = elements.mapNotNull { e ->
            val bb = e.boundingBox ?: return@mapNotNull null
            val cp = e.cornerPoints
            val h = if (cp != null && cp.size == 4) {
                val leftEdge = kotlin.math.hypot(
                    (cp[3].x - cp[0].x).toDouble(),
                    (cp[3].y - cp[0].y).toDouble(),
                ).toFloat()
                val rightEdge = kotlin.math.hypot(
                    (cp[2].x - cp[1].x).toDouble(),
                    (cp[2].y - cp[1].y).toDouble(),
                ).toFloat()
                (leftEdge + rightEdge) / 2f
            } else {
                bb.height().toFloat()
            }
            Elem(e.text, RectF(bb), h)
        }
        if (elems.size < 2) {
            return listOf(OcrObservation(line.text, lineBbox, sourceLineIndex, 0))
        }
        // Greedy clustering with ratio comparison.
        val groups = mutableListOf<MutableList<Elem>>()
        for (e in elems) {
            val last = groups.lastOrNull()
            if (last != null) {
                val sortedH = last.map { it.height }.sorted()
                val median = sortedH[sortedH.size / 2]
                val ratio = minOf(e.height, median) / maxOf(e.height, median)
                if (ratio >= 0.75f) {
                    last.add(e)
                    continue
                }
            }
            groups.add(mutableListOf(e))
        }
        if (groups.size == 1) {
            return listOf(OcrObservation(line.text, lineBbox, sourceLineIndex, 0))
        }
        val result = mutableListOf<OcrObservation>()
        for ((seq, group) in groups.withIndex()) {
            val text = group.joinToString(" ") { it.text }
            var left = Float.MAX_VALUE; var top = Float.MAX_VALUE
            var right = Float.MIN_VALUE; var bottom = Float.MIN_VALUE
            for (e in group) {
                if (e.bbox.left < left) left = e.bbox.left
                if (e.bbox.top < top) top = e.bbox.top
                if (e.bbox.right > right) right = e.bbox.right
                if (e.bbox.bottom > bottom) bottom = e.bbox.bottom
            }
            result.add(OcrObservation(text, RectF(left, top, right, bottom), sourceLineIndex, seq))
        }
        return result
    }

    /**
     * Demographic-row text-pool parser. Scans the full OCR observation pool
     * for AAMVA D-20 tokens covering the name/license/date/demographic
     * fields and returns typed candidates that
     * bypass YOLO bbox matching for those classes.
     *
     * Four-gate strict matching (round-4 design, 2026-05-10):
     *   (a) canonical index ∈ {1, 2, 3, 4a, 4b, 4d, 9, 12, 15, 16, 17, 18, 19}
     *   (b) lexer-recognized label compatible with the index
     *       (e.g. "16" requires "HGT"/"HEIGHT"/"HT")
     *   (c) value matches the expected domain regex for the index
     *       (e.g. "16" requires \d{1,2}['\-]\d{1,2}["]? or similar)
     *   (d) unique candidate across the pool — if 2+ tokens for the same
     *       index pass (a)+(b)+(c), DROP the field rather than pick wrong
     *
     * Rationale: this exists because the YOLO field detector is undertrained
     * on per-jurisdiction demographic-row layouts (e.g. on the user's WI
     * licence, list_16 bbox sits where list_18 should be). Falling back to
     * pure text-pool parsing with strict gating recovers these fields
     * without retraining. The "drop on ambiguity" rule compounds with the
     * prefix-mismatch telemetry: a dropped field is itself a labeled
     * signal that the YOLO model needs retraining for this jurisdiction.
     */
    /**
     * Demographic text-pool parser. Thin adapter over the shared C++
     * `dlscan::parse_aamva_demographic_fields` (via nativeParse...). The
     * marker-anchored 4-gate strict scan — including the 1-step look-ahead
     * that links a bare "4d" marker to its value on the NEXT observation, the
     * fused-row sex single-[MFX] extraction, and the name-marker-2 trailing-
     * junk strip — now lives in ONE place (cpp/ocr/ocr_field_extractor.cpp)
     * shared with iOS and pinned by cpp/tests/aamva_demographic_test.cpp.
     *
     * Passes observation texts in reading order; bbox geometry is not needed
     * for the text-only marker parse, so the C++ look-ahead keys on
     * observation sequence rather than the old sourceLineIndex pairing.
     */
    private fun parseAamvaDemographicFields(
        observations: List<OcrObservation>
    ): List<FieldCandidate> {
        val texts = observations.map { it.text }.toTypedArray()
        val flat = nativeParseAamvaDemographicFields(texts) ?: return emptyList()
        val out = ArrayList<FieldCandidate>(flat.size / 3)
        var i = 0
        while (i + 2 < flat.size) {
            val fieldId = flat[i].toIntOrNull() ?: FieldSource.Unknown
            val source = flat[i + 1].toIntOrNull() ?: FieldSource.StrictTextPool
            val text = flat[i + 2]
            if (text.isNotEmpty() && fieldId != 0) {
                out += FieldCandidate(fieldId, source, text)
            }
            i += 3
        }
        return out
    }

    /**
     * Legacy Kotlin-native marker parser — retained ONLY as dead reference
     * during the C++ migration; no longer called (the adapter above is the
     * active path). Kept compiling so the per-index emit + telemetry rationale
     * stays reviewable beside the C++ port. Safe to delete after device
     * verification of the shared C++ parser.
     */
    @Suppress("unused")
    private fun parseAamvaDemographicFieldsLegacy(
        observations: List<OcrObservation>
    ): List<FieldCandidate> {
        // Map AAMVA index → typed FieldId (v2 Sequence G — task #54).
        // Replaces the v1 "<base>_strict" string-suffix wire format; the
        // strict provenance now lives in FieldSource.StrictTextPool. The
        // C++ extractor still applies the StrictAgrees → CrossValidated
        // (1.00) upgrade when both StrictTextPool and BboxIoU candidates
        // converge on the same field (round-2 lock).
        val indexToFieldId = mapOf(
            "1"  to 1,    // FieldId::List1   (last name)
            "2"  to 2,    // FieldId::List2   (first + middle names)
            "3"  to 3,    // FieldId::List3   (DOB)
            "4a" to 41,   // FieldId::List4a  (issue date)
            "4b" to 42,   // FieldId::List4b  (expiration date)
            "4d" to 43,   // FieldId::List4d  (licence number)
            "9"  to 9,    // FieldId::List9   (vehicle class)
            "12" to 12,   // FieldId::List12  (restrictions)
            "15" to 15,   // FieldId::List15  (sex)
            "16" to 16,   // FieldId::List16  (height)
            "17" to 17,   // FieldId::List17  (weight)
            "18" to 18,   // FieldId::List18  (eye color)
            "19" to 19,   // FieldId::List19  (hair color)
        )

        // Index observations by (sourceLineIndex, indexWithinSourceLine) so
        // we can do 1-step lookahead from an empty-value AAMVA token cluster
        // to the next adjacent cluster on the same physical card row. This
        // handles the "9 CLASS" + "D" split case on the user's WI licence,
        // where height-clustering correctly separates the small index/label
        // from the bold value but the lexer alone can't reconnect them.
        // round-7 — bounded to exactly 1 step.
        data class ObsKey(val line: Int, val seq: Int)
        val byKey = HashMap<ObsKey, OcrObservation>()
        for (obs in observations) {
            if (obs.sourceLineIndex >= 0) {
                byKey[ObsKey(obs.sourceLineIndex, obs.indexWithinSourceLine)] = obs
            }
        }
        // Collect candidate tokens grouped by their AAMVA index. Each
        // gate-fall increments a telemetry counter so we can later see WHY
        // a demographic field didn't recover on a given capture.
        val candidatesByIndex = HashMap<String, MutableList<AamvaToken>>()
        for (obs in observations) {
            for (token in AamvaLexer.findAllAamvaTokens(obs.text)) {
                telemetryDemoSeen += 1
                if (token.index !in indexToFieldId) {
                    telemetryDemoFailGateA += 1; continue
                }
                // round-6: label-gate is now a *signal*, not a
                // hard reject. WI prints "HGT" which Vision OCR reads
                // as "HOT" ~30% of the time; same noise on WGT→VWGT,
                // EYES→FYFS. The idx+domain combo is sufficient signal
                // to accept the candidate. Track label-mismatch in
                // telemetry but don't drop the candidate over it.
                val labelOk =
                    AamvaLexer.isCompatibleLabel(token.index, token.label)
                if (!labelOk) {
                    telemetryDemoFailGateB += 1
                }
                var cleaned = token.value.trim().trimEnd('.', ',', ';')
                // round-6 follow-on: per-index value pre-extraction.
                // OCR commonly concatenates adjacent fields into one
                // observation (e.g. WI: "16 HGT 5'-09 17 WGT 185 lb"
                // reads as one line; "3 DOB 03/27/1976 ea ENb NONE"
                // glues DOB onto the endorsements column). The lexer
                // extracts everything after the label as the value,
                // and the anchored dom regex then rejects the trailing
                // junk. Pre-extract just the field-shape portion so
                // valueMatchesDomain sees a clean value.
                cleaned = extractFieldShape(token.index, cleaned)
                // Bounded 1-step lookahead: if this token has empty/missing
                // value but a compatible label, try the next adjacent
                // cluster on the same source line as the value.
                if (cleaned.isEmpty() && obs.sourceLineIndex >= 0) {
                    val nextKey = ObsKey(obs.sourceLineIndex, obs.indexWithinSourceLine + 1)
                    val nextObs = byKey[nextKey]
                    if (nextObs != null) {
                        // Adjacent cluster must not itself contain an AAMVA
                        // token (otherwise it's a real field of its own).
                        val nextTokens = AamvaLexer.findAllAamvaTokens(nextObs.text)
                        if (nextTokens.isEmpty()) {
                            val candidate = nextObs.text.trim().trimEnd('.', ',', ';')
                            if (AamvaLexer.valueMatchesDomain(candidate, token.index)) {
                                cleaned = candidate
                            }
                        }
                    }
                }
                // valueMatchesDomain returns false for unknown indices too,
                // so this single predicate covers both "no domain regex
                // registered" and "value doesn't match the regex" — both
                // were gate-C failures in the prior implementation.
                if (!AamvaLexer.valueMatchesDomain(cleaned, token.index)) {
                    telemetryDemoFailGateC += 1; continue
                }
                // Re-wrap the token with the adopted value so downstream
                // uses the looked-up cleaned text rather than the empty
                // original.
                candidatesByIndex.getOrPut(token.index) { mutableListOf() }.add(
                    AamvaToken(
                        index = token.index,
                        label = token.label,
                        value = cleaned,
                        range = token.range,
                        rawIndex = token.rawIndex,
                    )
                )
            }
        }

        val out = ArrayList<FieldCandidate>()
        for ((index, tokens) in candidatesByIndex) {
            // gate (d): unique candidate.
            if (tokens.size != 1) {
                telemetryDemoFailGateD += 1
                continue
            }
            val fieldId = indexToFieldId[index] ?: continue
            telemetryDemoAccepted += 1
            // Emit JUST the lexer-bounded value (round-6 follow-on).
            // The lexer already split the OCR text on a known label
            // (canonical or OCR-noise alias from sorted_all_labels), so
            // tok.value is the clean field content. Previously we
            // emitted "LABEL value" so C++ normalize_*_field could
            // strip a canonical label, but that path breaks when the
            // label is OCR-noise ("HOT" instead of "HGT") because
            // normalize_height_field doesn't recognize "HOT" as a
            // strip-target. C++ now receives clean values and
            // normalizes them directly.
            val tok = tokens[0]
            val v = when (index) {
                "15" -> tok.value.uppercase().trim()
                else -> tok.value.trim()
            }
            if (v.isNotEmpty()) out += FieldCandidate(fieldId, FieldSource.StrictTextPool, v)
        }

        // round-6: date-specific text-pool fallback for fields 3
        // (DOB), 4a (issue), 4b (expire). On WI DLs the AAMVA-index
        // line for these often OCR's garbled enough that the lexer
        // can't bind index→label→value. But the date values themselves
        // ("MM/DD/YYYY") are usually readable and unique. Strategy:
        //  - Scan all observations for MM/DD/YYYY tokens
        //  - If exactly 3 distinct valid dates appear, assign by
        //    chronology: oldest = DOB, middle = issue, newest = expire
        // The chronological invariant is structural for any valid DL.
        // We only emit candidates for fields not already covered by
        // the demographic parser above to preserve its precision when
        // it does work.
        val emittedIndices = out.map { it.fieldId }.toSet()
        // round-6 / task #82: text-pool fallback for vehicle class.
        // The WI DL prints `4d <DLN> CLASS <X>` on one row. Pixel OCR
        // reads the leading "4d" as "46" so the AAMVA lexer never emits
        // a token for the DLN row, and the bbox-IoU path captures only
        // the DLN. CLASS therefore never enters the candidate pool. Scan
        // every OCR observation for the `CLASS X` pattern as a last
        // resort; emit as StrictTextPool(List9) so the C++ extractor
        // picks it up via read_strict_or_regular.
        if (9 !in emittedIndices) {
            val cls = scanForClass(observations)
            if (cls != null) {
                out += FieldCandidate(9, FieldSource.StrictTextPool, cls)
            }
        }
        val needsDob    = 3  !in emittedIndices
        val needsIssue  = 41 !in emittedIndices
        val needsExpire = 42 !in emittedIndices
        if (needsDob || needsIssue || needsExpire) {
            val dates = scanForDates(observations)
            if (dates.size == 3) {
                if (needsDob)    out += FieldCandidate(3,  FieldSource.StrictTextPool, dates[0])
                if (needsIssue)  out += FieldCandidate(41, FieldSource.StrictTextPool, dates[1])
                if (needsExpire) out += FieldCandidate(42, FieldSource.StrictTextPool, dates[2])
            } else if (dates.size == 2 && needsDob && needsExpire) {
                // 2-date case: DOB + EXP (some DLs print only those).
                out += FieldCandidate(3,  FieldSource.StrictTextPool, dates[0])
                out += FieldCandidate(42, FieldSource.StrictTextPool, dates[1])
            }
        }
        return out
    }

    /**
     * Scan every OCR observation for MM/DD/YYYY (or MM-DD-YYYY) tokens.
     * Returns unique dates sorted chronologically (oldest first). Caller
     * decides field assignment based on count. See companion object's
     * static version for unit-test exposure.
     */
    private fun scanForDates(observations: List<OcrObservation>): List<String> =
        scanForDatesText(observations.map { it.text })

    /**
     * Scan every OCR observation for a `(?:CLASS|CLAS|GLASS) X` pattern
     * and return the matched class code uppercased — or null if nothing
     * realistic is found. WI Pixel OCR fuses CLASS onto the DLN row and
     * misreads the index `4d` as `46`, so neither the lexer nor the
     * bbox-IoU path produces a list_9 candidate. This is the fallback.
     * Task #82 follow-on. See companion-object static for unit tests.
     */
    private fun scanForClass(observations: List<OcrObservation>): String? =
        scanForClassText(observations.map { it.text })

    private fun matchObservationsToFields(
        observations: List<OcrObservation>,
        detections: List<Detection>
    ): List<FieldCandidate> {
        // v2 Sequence G — typed return. The bbox-matching algorithm is
        // class-name-keyed internally (multi-line fields concat by class
        // name); we convert the per-class result to typed FieldCandidates
        // at the bottom via nativeClassNameToFieldId. Unknown YOLO classes
        // (face / donor / etc) silently drop to FieldId::Unknown there.
        if (detections.isEmpty() || observations.isEmpty()) return emptyList()

        // paired refactor (2026-05-10):
        //   • Build a full (det, obs) IoU grid first instead of greedily
        //     assigning each obs to its single best det. This lets us pick
        //     the BEST observation per detection deterministically (fixing
        //     the putIfAbsent ordering bug where first-match-by-index won
        //     even with lower IoU).
        //   • Threshold bumped 0.05 → 0.08 (IOU_MATCH_THRESHOLD) post element
        //     splitting; element-sized observations produce much higher IoU
        //     on correct matches, so the elevated floor cuts poisoning
        //     without dropping real matches.
        //   • Log per-detection bestIoU/secondBestIoU so we can empirically
        //     validate the threshold over a few live captures.

        // Iter 6: detect issuing state once from the observation pool so
        // state-aware tighteners (currently list_4d only) can route on it.
        val detectedState = detectState(observations)

        val matchesByDet = HashMap<Int, MutableList<Match>>()
        for ((oi, obs) in observations.withIndex()) {
            for ((di, det) in detections.withIndex()) {
                val i = iou(obs.bbox, det.bbox)
                if (i >= IOU_MATCH_THRESHOLD) {
                    matchesByDet.getOrPut(di) { mutableListOf() }.add(Match(oi, i))
                }
            }
        }

        val result = LinkedHashMap<String, String>()
        val nowDbg = System.currentTimeMillis()
        val logIoU = VERBOSE_LOGGING && nowDbg - lastBboxLog > 2000L
        val iouTrace = if (logIoU) StringBuilder("DEBUG IoU per-detection: ") else null

        // Iterate detection indices in ASCENDING order — C++ NMS returns
        // detections sorted confidence-DESCENDING, so this preserves the
        // "highest-confidence detection wins" precedence deterministically.
        for (detIndex in detections.indices) {
            val matches = matchesByDet[detIndex] ?: continue
            if (matches.isEmpty()) continue
            val det = detections[detIndex]

            // bestIoU / secondBestIoU per detection — diagnostic only.
            if (iouTrace != null) {
                val sorted = matches.sortedByDescending { it.iou }
                val best = sorted[0].iou
                val second = if (sorted.size > 1) sorted[1].iou else 0f
                iouTrace.append(det.name).append("(").append(String.format("%.2f", best))
                    .append("/").append(String.format("%.2f", second)).append(") ")
            }

            if (det.name in multilineFieldClasses) {
                // Concatenate top-to-bottom by bbox y-center. Already-claimed
                // observation indices are still allowed to participate in
                // multi-line concatenation — a single physical address row
                // can legitimately span list_8f and list_8s simultaneously.
                val sorted = matches.sortedBy { observations[it.obsIndex].bbox.centerY() }
                val pieces = sorted.map {
                    val r = stripAamvaPrefixForClass(observations[it.obsIndex].text, det.name)
                    if (r.mismatchedFromIndex != null) {
                        telemetryPrefixMismatchByClass.merge(det.name, 1, Int::plus)
                    }
                    r.text
                }.filter { it.isNotEmpty() }
                if (pieces.isEmpty()) continue
                val joined = pieces.joinToString("\n")
                result.merge(det.name, joined) { existing, new -> "$existing\n$new" }
            } else {
                // Single-winner: highest IoU; tie-break by smaller y-center.
                // `putIfAbsent` is gone — first detection (in confidence-
                // descending order) to claim this class name keeps its
                // winner, but each detection's winner is picked from the
                // FULL match candidate list, not whichever ran first.
                val winner = matches.maxWithOrNull(compareBy<Match> { it.iou }
                    .thenByDescending { observations[it.obsIndex].bbox.centerY() })!!
                val rawText = observations[winner.obsIndex].text
                val r = stripAamvaPrefixForClass(rawText, det.name)
                if (r.mismatchedFromIndex != null) {
                    telemetryPrefixMismatchByClass.merge(det.name, 1, Int::plus)
                }
                val tightened = tightenByContentShape(r.text, det.name, detectedState)
                if (tightened.isNotEmpty()) {
                    result.putIfAbsent(det.name, tightened)
                }
            }
        }

        if (iouTrace != null) {
            lastBboxLog = nowDbg
            Log.i(TAG, iouTrace.toString())
        }
        // v2 Sequence G — convert class-name-keyed result to typed
        // FieldCandidates. Unknown class names (face/donor/etc) map to
        // FieldId::Unknown via JNI; we drop those here.
        val out = ArrayList<FieldCandidate>(result.size)
        for ((className, value) in result) {
            val fieldId = nativeClassNameToFieldId(className)
            if (fieldId == 0) continue  // FieldId::Unknown
            out += FieldCandidate(fieldId, FieldSource.BboxIoU, value)
        }
        return out
    }

    private fun iou(a: RectF, b: RectF): Float {
        if (a.width() <= 0 || a.height() <= 0 || b.width() <= 0 || b.height() <= 0) return 0f
        val xL = max(a.left, b.left)
        val yT = max(a.top, b.top)
        val xR = min(a.right, b.right)
        val yB = min(a.bottom, b.bottom)
        val interW = max(0f, xR - xL)
        val interH = max(0f, yB - yT)
        val inter = interW * interH
        if (inter <= 0f) return 0f
        val union = a.width() * a.height() + b.width() * b.height() - inter
        return if (union > 0f) inter / union else 0f
    }

    // -------------------------------------------------------------------------
    // YUV → ARGB bitmap conversion + letterbox helpers.
    // -------------------------------------------------------------------------

    /**
     * Convert a YUV_420_888 android.media.Image into an ARGB Bitmap, applying
     * camera rotation. The path goes via NV21 → YuvImage → JPEG → Bitmap;
     * not the fastest possible (RenderScript is deprecated), but at the 2 fps
     * cooldown it's well within budget. Returns null on any failure.
     */
    @ExperimentalGetImage
    private fun mediaImageToBitmap(
        mediaImage: android.media.Image,
        rotationDegrees: Int
    ): Bitmap? {
        return try {
            val nv21 = packNv21(mediaImage) ?: return null
            val yuvImage = YuvImage(
                nv21, ImageFormat.NV21,
                mediaImage.width, mediaImage.height, null
            )
            val out = ByteArrayOutputStream()
            yuvImage.compressToJpeg(
                Rect(0, 0, mediaImage.width, mediaImage.height),
                90,  // quality high enough for OCR; tune later if needed
                out
            )
            val jpegBytes = out.toByteArray()
            val raw = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size) ?: return null

            if (rotationDegrees == 0) raw else rotateBitmap(raw, rotationDegrees.toFloat())
        } catch (t: Throwable) {
            Log.e(TAG, "mediaImageToBitmap failed", t)
            null
        }
    }

    /**
     * Pack a YUV_420_888 android.media.Image into a tightly-packed NV21 byte
     * array, honoring each plane's `rowStride` and `pixelStride`. The naive
     * version (just concatenating `planes[i].buffer.remaining()`) only works
     * when the camera produces unpadded, fully-planar YUV. Real CameraX
     * frames frequently come back as semi-planar with `pixelStride == 2`
     * (UV interleaved in one plane) and/or with row padding (`rowStride >
     * width`). Without stride-aware copying, the resulting bitmap is
     * corrupted on those devices and OCR + YOLO see garbage.
     *
     * Output layout: Y...YVUVU... (NV21).
     */
    @ExperimentalGetImage
    private fun packNv21(image: android.media.Image): ByteArray? {
        val width = image.width
        val height = image.height
        val ySize = width * height
        val uvSize = ySize / 2  // 4:2:0 chroma → quarter spatial resolution per plane × 2 planes
        val nv21 = ByteArray(ySize + uvSize)

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        // -- Y plane: copy row-by-row, honoring rowStride padding. --
        run {
            val buf = yPlane.buffer.duplicate()
            val rowStride = yPlane.rowStride
            val pixelStride = yPlane.pixelStride  // typically 1
            var dst = 0
            if (rowStride == width && pixelStride == 1) {
                // Tightly packed — fast path
                buf.get(nv21, 0, ySize)
                dst = ySize
            } else {
                val rowBuf = ByteArray(rowStride)
                for (row in 0 until height) {
                    buf.position(row * rowStride)
                    val toCopy = minOf(rowStride, buf.remaining())
                    buf.get(rowBuf, 0, toCopy)
                    if (pixelStride == 1) {
                        System.arraycopy(rowBuf, 0, nv21, dst, width)
                    } else {
                        // Extremely uncommon for Y; defensive.
                        for (col in 0 until width) {
                            nv21[dst + col] = rowBuf[col * pixelStride]
                        }
                    }
                    dst += width
                }
            }
        }

        // -- VU interleaved plane: NV21 wants V first, then U, half-resolution. --
        // CameraX typically gives semi-planar UV (pixelStride==2, U and V share
        // one underlying buffer offset by 1). In that case we can fast-path
        // by copying V's buffer slice (which already has U bytes interleaved
        // at the +1 positions).
        run {
            val uBuf = uPlane.buffer.duplicate()
            val vBuf = vPlane.buffer.duplicate()
            val uvRowStride = vPlane.rowStride           // U and V share rowStride
            val uvPixelStride = vPlane.pixelStride
            val uvWidth = width / 2
            val uvHeight = height / 2
            var dst = ySize

            // Fast path: semi-planar (pixelStride==2). The V plane buffer's
            // bytes are V0,_,V1,_,V2,_,... and U's are _,U0,_,U1,..., where
            // they alias the same memory offset by one byte. We read directly
            // from V (starts with V0) and the +1 byte happens to be U0 in
            // the underlying memory — but ByteBuffer position arithmetic is
            // discrete, so we still need to interleave manually for safety.
            for (row in 0 until uvHeight) {
                for (col in 0 until uvWidth) {
                    val srcIdx = row * uvRowStride + col * uvPixelStride
                    if (srcIdx >= vBuf.limit() || srcIdx >= uBuf.limit()) {
                        return null
                    }
                    nv21[dst++] = vBuf.get(srcIdx)
                    nv21[dst++] = uBuf.get(srcIdx)
                }
            }
        }

        return nv21
    }

    private fun rotateBitmap(src: Bitmap, degrees: Float): Bitmap {
        val matrix = android.graphics.Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
    }

    private data class LetterboxResult(
        val canvas: Bitmap,
        val scale: Float,
        val padX: Float,
        val padY: Float
    )

    /**
     * Center-crop the bitmap to a square, then resize to [target]x[target].
     *
     * Replaces the previous letterbox-with-padding approach. The YOLOv8n
     * field detector was trained on tight 640x640 *rectified document crops*
     * (see model-training/idnet/prepare_yolo_fields.py "Rectify the document
     * to a canonical 640x640 crop"). When we letterboxed a 1280x720 camera
     * frame into a 640x640 canvas, the license ended up ~360px tall in a
     * 640px frame with gray padding above and below. That input is far
     * enough out of the model's training distribution that confidence
     * scores quantized to literal zero — verified by running the shipped
     * TFLite model directly on a debug bitmap dumped from device.
     *
     * Center-cropping first makes the license fill more of the 640x640
     * input. Same debug bitmap, center-cropped → max confidence 0.97
     * (vs 0.0 letterboxed). Proper fix is a doc-detector + perspective
     * rectify (matches iOS path); this is the cheap interim.
     *
     * Returns the canvas plus scale + (offX, offY) so the caller can
     * un-do the transform when projecting model bboxes back to the
     * original-bitmap pixel space.
     */
    private fun letterbox(src: Bitmap, target: Int): LetterboxResult {
        val srcW = src.width
        val srcH = src.height
        val cropSize = min(srcW, srcH)
        val cropX = (srcW - cropSize) / 2
        val cropY = (srcH - cropSize) / 2

        // Single combined op: crop the center square out, scale to target.
        // Bitmap.createBitmap(src, x, y, w, h) returns the cropped sub-bitmap;
        // wrap that in createScaledBitmap to hit target x target.
        val cropped = Bitmap.createBitmap(src, cropX, cropY, cropSize, cropSize)
        val canvas = if (cropped.width == target && cropped.height == target) {
            cropped
        } else {
            val scaled = Bitmap.createScaledBitmap(cropped, target, target, true)
            if (scaled != cropped) cropped.recycle()
            scaled
        }

        // Forward transform applied to source pixels (crop-then-scale):
        //   modelX = (srcX - cropX) * (target / cropSize)
        // We store the scale factor that converts source-pixel deltas into
        // model-pixel deltas; padX/padY become the crop offsets in source
        // space (negative-shifted, expressed as positive offsets here).
        // Caller reverses: srcX = modelX / scale + cropX.
        val scale = target.toFloat() / cropSize.toFloat()
        return LetterboxResult(canvas, scale, -cropX.toFloat() * scale, -cropY.toFloat() * scale)
    }

    // -------------------------------------------------------------------------
    // resetLicenseFieldRecognition — reset scan-session state for a new scan.
    // -------------------------------------------------------------------------

    override fun resetLicenseFieldRecognition() {
        // _scanProgress / _pipelineStage / _detectedCardCorners are @Volatile,
        // so they're reset directly without a lock.
        cardCapturedThisSession = false
        _scanProgress = 0.0
        _pipelineStage = 0.0
        _detectedCardCorners = doubleArrayOf()
        // Clear the per-instance multi-frame voter so the next scan
        // starts with a fresh history. Without this, votes from a
        // previous card would influence the new scan's consensus.
        voter.reset()
        // Clear the JS-orchestration rectify cache so stale bitmaps don't survive a
        // scan-session boundary; reset the throttle clock too.
        rectifyLock.withLock {
            rectifiedCache.clear()
            lastRectifyTime = 0L
            // Drop the retained TTA crop so a stale card from the previous
            // session can't be re-OCR'd into the next scan's result.
            ttaRetainedRgb = null
            ttaRetainedWidth = 0
            ttaRetainedHeight = 0
        }
    }

    // -------------------------------------------------------------------------
    // Unified TFLite runtime (react-native-fast-tflite), JS-orchestrated
    // -------------------------------------------------------------------------
    //
    // JS loads the models + calls model.runSync; these bridge the shared,
    // tested C++ pre/post (the detect_c C-ABI). No fast-tflite type is
    // referenced (the c++-only TfliteModel can't cross into a Kotlin
    // HybridObject — see docs/.../2026-05-30-ios-build-findings.md).
    //
    // Bridges to the detect_c C-ABI via JNI (nativePreprocessField etc., in
    // dlscan_jni_bridge.cpp). Marshals the Nitro ArrayBuffer <-> primitive
    // arrays. UNVALIDATED against a JDK-21 gradle build — confirm on first build.
    // (iOS implements the same spec methods via Cxx interop.)
    @DoNotStrip @Keep
    private external fun nativePreprocessField(rgb: ByteArray, w: Int, h: Int): FloatArray
    @DoNotStrip @Keep
    private external fun nativeDecodeField(output: FloatArray, scaleX: Float, scaleY: Float): FloatArray
    // TTA augmentation — synthesize an augmented RGB8 copy via shared C++
    // dlscan_augment_rgb. mode = DLSCAN_AUG_* int. Returns w*h*3 bytes, or an
    // empty array on error. Used by runTtaVerification.
    @DoNotStrip @Keep
    private external fun nativeAugmentRgb(rgb: ByteArray, w: Int, h: Int, mode: Int): ByteArray
    @DoNotStrip @Keep
    private external fun nativePreprocessDocAligner(rgb: ByteArray, w: Int, h: Int): FloatArray
    @DoNotStrip @Keep
    private external fun nativeDecodeCorners(output: FloatArray): FloatArray

    override fun preprocessFieldInput(rgb: ArrayBuffer, width: Double, height: Double): ArrayBuffer =
        floatsToArrayBuffer(nativePreprocessField(arrayBufferToBytes(rgb), width.toInt(), height.toInt()))

    override fun decodeFieldOutput(
        output: ArrayBuffer,
        scaleX: Double,
        scaleY: Double,
    ): Array<FieldDetectionSpec> {
        val flat = nativeDecodeField(arrayBufferToFloats(output), scaleX.toFloat(), scaleY.toFloat())
        val n = flat.size / 6
        return Array(n) { i ->
            FieldDetectionSpec(
                classId = flat[i * 6].toDouble(),
                confidence = flat[i * 6 + 1].toDouble(),
                x1 = flat[i * 6 + 2].toDouble(),
                y1 = flat[i * 6 + 3].toDouble(),
                x2 = flat[i * 6 + 4].toDouble(),
                y2 = flat[i * 6 + 5].toDouble(),
            )
        }
    }

    override fun preprocessDocAlignerInput(rgb: ArrayBuffer, width: Double, height: Double): ArrayBuffer =
        floatsToArrayBuffer(nativePreprocessDocAligner(arrayBufferToBytes(rgb), width.toInt(), height.toInt()))

    override fun decodeCorners(output: ArrayBuffer): DoubleArray {
        val r = nativeDecodeCorners(arrayBufferToFloats(output))
        return DoubleArray(r.size) { r[it].toDouble() }
    }

    // Nitro ArrayBuffer <-> JVM primitive-array marshaling. duplicate() so the
    // source buffer's position isn't disturbed; nativeOrder for the float view.
    private fun arrayBufferToBytes(ab: ArrayBuffer): ByteArray {
        val bb = ab.getBuffer(false).duplicate()
        bb.clear()
        val out = ByteArray(ab.size)
        bb.get(out)
        return out
    }

    private fun arrayBufferToFloats(ab: ArrayBuffer): FloatArray {
        val byteSize = ab.size
        if (byteSize % 4 != 0) return FloatArray(0)
        val bb = ab.getBuffer(false).duplicate().order(ByteOrder.nativeOrder())
        bb.clear()
        val fb = bb.asFloatBuffer()
        val out = FloatArray(byteSize / 4)
        fb.get(out)
        return out
    }

    private fun floatsToArrayBuffer(floats: FloatArray): ArrayBuffer {
        val ab = ArrayBuffer.allocate(floats.size * 4)
        val bb = ab.getBuffer(false).duplicate().order(ByteOrder.nativeOrder())
        bb.clear()
        bb.asFloatBuffer().put(floats)
        bb.rewind()
        return ab
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun variantOfRect(spec: RectifiedFrameSpec?): Variant_NullType_RectifiedFrameSpec =
        if (spec != null) Variant_NullType_RectifiedFrameSpec.create(spec)
        else Variant_NullType_RectifiedFrameSpec.create(NullType.NULL)

    /** ARGB_8888 Bitmap -> row-major RGB8 ArrayBuffer (3 B/px). */
    private fun bitmapToRGB8(bmp: Bitmap): ArrayBuffer {
        val w = bmp.width
        val h = bmp.height
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        val out = ByteArray(w * h * 3)
        var di = 0
        for (p in px) {
            out[di++] = ((p shr 16) and 0xFF).toByte()
            out[di++] = ((p shr 8) and 0xFF).toByte()
            out[di++] = (p and 0xFF).toByte()
        }
        val ab = ArrayBuffer.allocate(out.size)
        val bb = ab.getBuffer(false).duplicate()
        bb.clear()
        bb.put(out)
        bb.rewind()
        return ab
    }

    override fun rectifyFrame(frame: HybridFrameSpec): Variant_NullType_RectifiedFrameSpec {
        val now = System.currentTimeMillis()
        val throttled = rectifyLock.withLock { now - lastRectifyTime < 300L }
        if (throttled) return variantOfRect(null)
        val nativeFrame = frame as? NativeFrame
        val mediaImage = nativeFrame?.image?.image ?: return variantOfRect(null)
        val rotationDegrees = nativeFrame.image.imageInfo.rotationDegrees
        val bitmap = mediaImageToBitmap(mediaImage, rotationDegrees) ?: return variantOfRect(null)
        val corners = runDocAligner(bitmap) ?: run {
            _scanProgress = maxOf(_scanProgress, 0.02)
            return variantOfRect(null)
        }
        run {
            val w = bitmap.width.toFloat()
            val h = bitmap.height.toFloat()
            val landscape = w > h
            _detectedCardCorners = DoubleArray(8) { i ->
                val ci = (i / 2) * 2
                if (landscape) {
                    if (i % 2 == 0) (corners[ci + 1] / h).toDouble() else 1.0 - (corners[ci] / w).toDouble()
                } else {
                    if (i % 2 == 0) (corners[i] / w).toDouble() else (corners[i] / h).toDouble()
                }
            }
        }
        _scanProgress = maxOf(_scanProgress, 0.05)
        val ocrBitmap = rectifyBitmap(bitmap, corners, OCR_RECTIFY_WIDTH, OCR_RECTIFY_HEIGHT)
        val rgb = bitmapToRGB8(ocrBitmap)
        val token = rectifyLock.withLock {
            lastRectifyTime = now
            val t = nextRectifyToken
            nextRectifyToken += 1.0
            rectifiedCache[t] = RectEntry(bitmap, corners, ocrBitmap)
            if (rectifiedCache.size > 4) {
                rectifiedCache.keys.minOrNull()?.let { rectifiedCache.remove(it) }
            }
            t
        }
        return variantOfRect(
            RectifiedFrameSpec(rgb, ocrBitmap.width.toDouble(), ocrBitmap.height.toDouble(), token)
        )
    }

    override fun ocrExtractFields(
        token: Double,
        detections: Array<FieldDetectionSpec>,
    ): Variant_NullType_LicenseDataSpec {
        val entry = rectifyLock.withLock { rectifiedCache.remove(token) } ?: return variantOf(null)
        val ocrBitmap = entry.ocrBitmap
        val dets = mapDetections(detections)
        if (dets.isEmpty()) return variantOf(null)

        val observations = wholeCardObservations(ocrBitmap)
        if (observations.isEmpty()) return variantOf(null)

        val demographicCandidates = parseAamvaDemographicFields(observations)
        val bboxCandidates = matchObservationsToFields(observations, dets)
        val frameCandidates: List<FieldCandidate> = bboxCandidates + demographicCandidates

        if (frameCandidates.isNotEmpty()) {
            voter.accept(frameCandidates)
            val consensus = voter.consensus()
            val totalExpected = 14.0
            val stabilized = consensus.map { it.fieldId }.distinct().size
            _scanProgress = minOf(maxOf(_scanProgress, 0.10 + (stabilized / totalExpected) * 0.85), 1.0)
            if (consensus.isNotEmpty()) {
                val n = consensus.size
                val fieldIds = IntArray(n)
                val sources = IntArray(n)
                val texts = arrayOfNulls<String>(n)
                for (i in 0 until n) {
                    fieldIds[i] = consensus[i].fieldId
                    sources[i] = consensus[i].source
                    texts[i] = consensus[i].text
                }
                _pipelineStage = 1.0
                @Suppress("UNCHECKED_CAST")
                val r = nativeExtractFieldsCandidates(fieldIds, sources, texts as Array<String>)
                _pipelineStage = 2.0
                maybeFlushTelemetry()
                if (r != null && !cardCapturedThisSession) {
                    cardCapturedThisSession = true
                    _pipelineStage = 3.0
                    val saved = saveRectifiedCard(entry.source, entry.corners)
                    val cardPath = saved?.first
                    val cardObservations = saved?.second
                    _pipelineStage = 4.0
                    val headshotPath = extractHeadshot(ocrBitmap, dets, cardPath)
                    _pipelineStage = 5.0
                    // Retain THIS consensus crop (the rectified ocrBitmap as RGB8
                    // bytes) as the best card for the optional TTA verification
                    // pass. Snapshot to raw bytes now so it survives the
                    // ocrBitmap being recycled when its cache entry is evicted.
                    rectifyLock.withLock {
                        ttaRetainedRgb = bitmapToRGB8Bytes(ocrBitmap)
                        ttaRetainedWidth = ocrBitmap.width
                        ttaRetainedHeight = ocrBitmap.height
                    }
                    return variantOf(
                        r.copy(
                            cardImagePath = cardPath,
                            ocrObservations = cardObservations,
                            headshotImagePath = headshotPath
                        )
                    )
                }
                return variantOf(r)
            }
        }
        val lines = observations.map { it.text }.toTypedArray()
        val r = nativeExtractOcrFields(lines)
        maybeFlushTelemetry()
        return variantOf(r)
    }

    /**
     * Images-only capture (no OCR): the dedicated entry behind the JS
     * `completion.capture: 'imagesOnly'` mode. Rides the exact same
     * rectify -> NanoDet-detect entry as [ocrExtractFields] — same token
     * lookup, same non-empty-detections quality gate (detections prove a
     * recognizable card front is in frame AND feed the YOLO-face headshot
     * fallback) — then short-circuits straight to the once-per-session
     * card-image save + headshot extraction. No OCR text recognition, no C++
     * parse, no voting, and no TTA-crop retention run.
     *
     * Latch discipline differs deliberately from the full path: the full path
     * latches [cardCapturedThisSession] BEFORE attempting the save (a failed
     * save there still returns field data, the image is just absent), but here
     * the saved card IS the scan result, so the latch is only set AFTER
     * [saveRectifiedCard] succeeds — a failed save returns null and the next
     * frame retries the capture.
     */
    override fun captureFrontImages(
        token: Double,
        detections: Array<FieldDetectionSpec>,
    ): Variant_NullType_LicenseDataSpec {
        val entry = rectifyLock.withLock { rectifiedCache.remove(token) } ?: return variantOf(null)
        val dets = mapDetections(detections)
        if (dets.isEmpty()) return variantOf(null)
        if (cardCapturedThisSession) return variantOf(null)

        _pipelineStage = 3.0
        val saved = saveRectifiedCard(entry.source, entry.corners, withObservations = false)
        if (saved == null) {
            _pipelineStage = 0.0
            return variantOf(null)
        }
        cardCapturedThisSession = true
        _pipelineStage = 4.0
        val headshotPath = extractHeadshot(entry.ocrBitmap, dets, saved.first)
        _pipelineStage = 5.0
        _scanProgress = 1.0
        return variantOf(imagesOnlyLicenseDataSpec(saved.first, headshotPath))
    }

    /**
     * Map JS NanoDet detections (classId + bbox already in ocrBitmap pixel
     * space — decodeFieldOutput mapped them back via inputSize/width; no 640
     * rescale) to internal [Detection]s. Shared by [ocrExtractFields] and
     * [captureFrontImages].
     */
    private fun mapDetections(detections: Array<FieldDetectionSpec>): List<Detection> =
        detections.mapNotNull { d ->
            val name = nativeClassName(d.classId.toInt())
            if (name.isEmpty()) null
            else Detection(
                name,
                RectF(d.x1.toFloat(), d.y1.toFloat(), d.x2.toFloat(), d.y2.toFloat()),
                d.confidence.toFloat()
            )
        }

    /**
     * All-fields-absent [LicenseDataSpec] carrying only the captured image
     * paths — the images-only capture result shape (field values null by
     * contract).
     */
    private fun imagesOnlyLicenseDataSpec(
        cardImagePath: String?,
        headshotImagePath: String?
    ): LicenseDataSpec = LicenseDataSpec(
        firstName = null, lastName = null, middleName = null, dateOfBirth = null,
        expirationDate = null, issueDate = null, licenseNumber = null, street = null,
        city = null, state = null, postalCode = null, country = null, sex = null,
        eyeColor = null, hairColor = null, height = null, weight = null,
        vehicleClass = null, restrictions = null, endorsements = null,
        aamvaVersion = null, documentType = null, mrz = null, dataConfidenceJson = null,
        cardImagePath = cardImagePath, ocrObservations = null,
        headshotImagePath = headshotImagePath
    )

    private fun variantOf(spec: LicenseDataSpec?): Variant_NullType_LicenseDataSpec =
        if (spec != null) {
            Variant_NullType_LicenseDataSpec.create(spec)
        } else {
            Variant_NullType_LicenseDataSpec.create(NullType.NULL)
        }

    /**
     * Whole-card MLKit OCR over [bitmap] → element-clustered, AAMVA-index-split
     * [OcrObservation]s. Factored out of [ocrExtractFields] so the TTA
     * verification pass reuses the exact same OCR→cluster→split sequence on the
     * augmented crop. Returns an empty list when OCR finds no text.
     */
    private fun wholeCardObservations(bitmap: Bitmap): List<OcrObservation> {
        val visionResult = Tasks.await(
            textRecognizer.process(InputImage.fromBitmap(bitmap, 0)),
            5L,
            java.util.concurrent.TimeUnit.SECONDS
        )
        val observations = mutableListOf<OcrObservation>()
        var nextLineId = 0
        for (block in visionResult.textBlocks) {
            for (line in block.lines) {
                val box = line.boundingBox ?: continue
                val lineBbox = RectF(box)
                val lineId = nextLineId++
                val clusters = clusterLineByElementHeight(line, lineBbox, lineId)
                for (clusterObs in clusters) {
                    for ((subText, subBbox) in splitObservationByAamvaIndices(clusterObs.text, clusterObs.bbox)) {
                        observations.add(
                            OcrObservation(
                                text = subText,
                                bbox = subBbox,
                                sourceLineIndex = clusterObs.sourceLineIndex,
                                indexWithinSourceLine = clusterObs.indexWithinSourceLine,
                            )
                        )
                    }
                }
            }
        }
        return observations
    }

    /** ARGB_8888 Bitmap -> row-major RGB8 ByteArray (3 B/px). The raw-array
     *  sibling of [bitmapToRGB8] (which packs into a Nitro ArrayBuffer). */
    private fun bitmapToRGB8Bytes(bmp: Bitmap): ByteArray {
        val w = bmp.width
        val h = bmp.height
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        val out = ByteArray(w * h * 3)
        var di = 0
        for (p in px) {
            out[di++] = ((p shr 16) and 0xFF).toByte()
            out[di++] = ((p shr 8) and 0xFF).toByte()
            out[di++] = (p and 0xFF).toByte()
        }
        return out
    }

    /** Row-major RGB8 ByteArray (3 B/px) -> opaque ARGB_8888 Bitmap. Inverse of
     *  [bitmapToRGB8Bytes]; used by the TTA pass to OCR an augmented crop. */
    private fun rgb8ToBitmap(rgb: ByteArray, w: Int, h: Int): Bitmap {
        val px = IntArray(w * h)
        var si = 0
        for (i in 0 until w * h) {
            val r = rgb[si].toInt() and 0xFF
            val g = rgb[si + 1].toInt() and 0xFF
            val b = rgb[si + 2].toInt() and 0xFF
            px[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            si += 3
        }
        return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    }

    /**
     * TTA-as-verification pass. ADDITIVE + opt-in (JS calls this only when the
     * consumer enables `completion.tta`, after the normal scan completes).
     * Re-OCRs the retained best card crop under each requested augmentation
     * (nativeAugmentRgb → dlscan_augment_rgb), votes the augmented frames with a
     * FRESH voter, and returns the voted LicenseDataSpec. Returns null when no
     * crop is retained or the augmented frames produce no consensus. Does NOT
     * touch the live scan voter or re-save card/headshot images.
     */
    override fun runTtaVerification(modes: DoubleArray): Variant_NullType_LicenseDataSpec {
        val snapshot = rectifyLock.withLock {
            val r = ttaRetainedRgb
            if (r == null) null else Triple(r, ttaRetainedWidth, ttaRetainedHeight)
        } ?: return variantOf(null)
        val (retained, w, h) = snapshot
        if (w <= 0 || h <= 0 || retained.size < w * h * 3) return variantOf(null)

        val ttaVoter = FieldVoter(maxVotes = 20, minVotes = 1)
        try {
            var anyFrame = false
            for (modeD in modes) {
                val augmented = nativeAugmentRgb(retained, w, h, modeD.toInt())
                if (augmented.size != w * h * 3) continue  // unknown mode / bad dims
                val augBitmap = rgb8ToBitmap(augmented, w, h)
                try {
                    val observations = wholeCardObservations(augBitmap)
                    if (observations.isEmpty()) continue
                    val candidates = parseAamvaDemographicFields(observations)
                    if (candidates.isEmpty()) continue
                    ttaVoter.accept(candidates)
                    anyFrame = true
                } finally {
                    augBitmap.recycle()
                }
            }
            if (!anyFrame) return variantOf(null)
            val consensus = ttaVoter.consensus()
            if (consensus.isEmpty()) return variantOf(null)
            val n = consensus.size
            val fieldIds = IntArray(n)
            val sources = IntArray(n)
            val texts = arrayOfNulls<String>(n)
            for (i in 0 until n) {
                fieldIds[i] = consensus[i].fieldId
                sources[i] = consensus[i].source
                texts[i] = consensus[i].text
            }
            @Suppress("UNCHECKED_CAST")
            val r = nativeExtractFieldsCandidates(fieldIds, sources, texts as Array<String>)
            // No card/headshot re-capture — verification reuses the saved crop.
            return variantOf(r)
        } finally {
            ttaVoter.close()
        }
    }

    // -------------------------------------------------------------------------
    // Library loading + companion constants.
    // -------------------------------------------------------------------------

    companion object {
        private const val TAG = "DLScanAndroid"

        /**
         * Verbose diagnostic logging gate. These DEBUG/telemetry/IoU-trace
         * logs are useful for maintainer debug builds but are pure logcat
         * noise for consumers, so they are silenced in RELEASE builds.
         * BuildConfig.DEBUG is the library module's build type, which the
         * Nitro/RN consumer build resolves at compile time.
         */
        private val VERBOSE_LOGGING = BuildConfig.DEBUG

        /**
         * Per-AAMVA-index value pre-extractor. OCR commonly concatenates
         * adjacent fields onto one observation (WI: "16 HGT 5'-09 17 WGT
         * 185 lb" or "3 DOB 03/27/1976 EnB NONE"); the lexer's value
         * span includes the trailing junk; the anchored dom regex
         * rejects it. This helper extracts JUST the field-shape portion
         * so the dom gate sees a clean value. round-6 design.
         */
        internal fun extractFieldShape(index: String, value: String): String {
            return when (index) {
                "3", "4a", "4b" -> {
                    // Dates — find first MM/DD/YYYY or MM-DD-YYYY.
                    val m = Regex("""(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})""")
                        .find(value)
                    m?.value ?: value
                }
                "16" -> {
                    // Height — find first 5'-09" / 5'09" / 5-09 / \d{3}
                    val m = Regex(
                        """(\d{1,2}'-?\s*\d{1,2}["]?|\d{1,2}-\d{1,2}|\d{3})"""
                    ).find(value)
                    m?.value ?: value
                }
                "17" -> {
                    // Weight — first \d{2,3} with optional unit, preferring
                    // higher-confidence matches that include "lb"/"lbs"/"kg".
                    val withUnit = Regex(
                        """(\d{2,3})\s*(?:lbs?|kg)""",
                        RegexOption.IGNORE_CASE
                    ).find(value)
                    if (withUnit != null) return withUnit.value
                    val bare = Regex("""\b(\d{2,3})\b""").find(value)
                    bare?.value ?: value
                }
                "12" -> {
                    // Restrictions — first NONE / single letter code.
                    val none = Regex("""\b(NONE|N\/A)\b""", RegexOption.IGNORE_CASE)
                        .find(value)
                    if (none != null) return none.value.uppercase()
                    val code = Regex("""\b([A-Z]{1,3})\b""").find(value)
                    code?.value ?: value
                }
                "4d" -> {
                    val m = Regex("""[A-Za-z0-9][A-Za-z0-9-]{3,}""")
                        .find(value)
                    m?.value ?: value
                }
                else -> value
            }
        }

        /**
         * Scan a list of OCR observation texts for `MM/DD/YYYY` or
         * `MM-DD-YYYY` date tokens. Returns the unique parseable dates
         * sorted chronologically (oldest first), formatted as
         * `MM/DD/YYYY` for downstream C++ normalize_date_field.
         *
         * Exposed in the companion object so the JVM unit test suite
         * (TightenersTest) can validate the parsing logic without an
         * instrumentation test or real OcrObservation construction.
         * Caller is responsible for downstream assignment (DOB =
         * oldest, EXP = newest, etc.) per round-6 design.
         */
        /**
         * Find a `(?:CLASS|CLAS|GLASS) X` pattern in any OCR observation
         * and return the matched class code uppercased. The class itself
         * must pass a "looks like an AAMVA class code" gate (1-3 alnum
         * chars, starting with a letter, not in the address-token
         * denylist). Returns null if nothing realistic is found. Static
         * + internal so the JVM-runnable test suite can drive it
         * without instantiating the full Hybrid module.
         */
        internal fun scanForClassText(texts: List<String>): String? {
            val pattern = Regex(
                """\b(?:CLASS|CLAS|GLASS)[\s:]+([A-Z][A-Z0-9]{0,2})\b""",
                RegexOption.IGNORE_CASE
            )
            val denylist = setOf(
                "ST", "RD", "DR", "AVE", "BLVD", "LN", "CT", "CIR",
                "HWY", "PKWY", "NONE", "N/A"
            )
            for (text in texts) {
                val m = pattern.find(text) ?: continue
                val code = m.groupValues[1].uppercase()
                if (code in denylist) continue
                return code
            }
            return null
        }

        internal fun scanForDatesText(texts: List<String>): List<String> {
            val datePattern = Regex("""(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})""")
            val seen = mutableSetOf<Triple<Int, Int, Int>>()
            for (text in texts) {
                for (m in datePattern.findAll(text)) {
                    val mo = m.groupValues[1].toIntOrNull() ?: continue
                    val d  = m.groupValues[2].toIntOrNull() ?: continue
                    val y  = m.groupValues[3].toIntOrNull() ?: continue
                    if (mo !in 1..12 || d !in 1..31) continue
                    if (y < 1900 || y > 2100) continue
                    seen.add(Triple(y, mo, d))
                }
            }
            return seen
                .sortedWith(compareBy({ it.first }, { it.second }, { it.third }))
                .map { (y, mo, d) -> "%02d/%02d/%04d".format(mo, d, y) }
        }

        @Volatile private var lastBboxLog: Long = 0L
        @Volatile private var docSegDebugDumped = false
        @Volatile private var docSegRectifiedDumped = false
        @Volatile private var lastDocSegLog: Long = 0L

        /** DocAligner input is fixed at 256x256 (FP16 lcnet100 model contract). */
        private const val DOC_INPUT_SIZE = 256

        /** DocAligner outputs a 128x128x4 heatmap (input downscaled 2x). */
        private const val DOC_HMAP_SIZE = 128

        /**
         * Per-channel heatmap threshold for soft-argmax. FP16 model peaks at
         * ~0.75 in our static-bitmap validation; 0.3 cleanly separates signal
         * from quantization noise without trimming the corner's spatial
         * support. DocAligner's Python reference uses the same value.
         */
        // Lowered from 0.3 → 0.2 per round-5 — task #82. With the
        // cached-corners fallback removed, a single corner channel
        // dipping below 0.3 (while overall maxHmap is 0.7+) was
        // skipping every frame on the user's Pixel 6 WI DL setup. 0.2
        // lets more pixels participate in the centroid calc; risk of
        // chasing heatmap noise is mitigated by the global
        // `sumW < 1e-4f` floor.
        private const val DOC_HEATMAP_THRESHOLD = 0.2f

        /**
         * Temporal-smoothing TTL for doc-seg corners. A frame with per-channel
         * signal dropout reuses corners from a more recent successful frame.
         * 350 ms is short enough that a moved card invalidates fast (1-2
         * frames of stale data max at 6 fps) but long enough to bridge the
         * camera-shake gaps identified in review. Per-class paired plan.
         */
        private const val DOC_CORNERS_TTL_MS = 350L

        /**
         * IoU floor for OCR-observation ↔ YOLO-bbox matching, post element-
         * level splitting. Raised from the legacy 0.05 (which let mostly-
         * non-overlapping observations poison the wrong field) to 0.08 on
         * the recommendation. Empirical bestIoU/secondBestIoU logging
         * below confirms the elevated floor.
         */
        private const val IOU_MATCH_THRESHOLD = 0.08f

        /**
         * AAMVA D-20 / DL-AID-005-3 field-index tokens per YOLO class. The
         * platform-layer prefix stripper consults this map: if an observation
         * matched to an indexed class starts with its own canonical index, the
         * prefix is stripped before the value lands in the candidate pool.
         * Class-aware so ordinary non-indexed text is never stripped unless
         * that class is explicitly in dropOnIndexMismatch below.
         */
        private val expectedAamvaIndex: Map<String, String> = mapOf(
            "surname" to "1",      // international class over AAMVA family-name row
            "given_name" to "2",   // international class over AAMVA given-name row
            "personal_num" to "4d", // international class over AAMVA DLN row
            "list_1"  to "1",   // family name
            "list_2"  to "2",   // given names
            "list_3"  to "3",   // DOB
            "list_4a" to "4a",  // issue date
            "list_4b" to "4b",  // expiration date
            "list_4d" to "4d",  // licence number
            "list_5"  to "5",   // alternative address / state inventory id
            "list_8f" to "8",   // address line 1 (street)
            "list_8s" to "8",   // address line 2 (city/state/zip) — same printed index
            "list_9"  to "9",   // vehicle class
            "list_9a" to "9a",  // endorsements
            "list_12" to "12",  // restrictions
            "list_15" to "15",  // sex
            "list_16" to "16",  // height
            "list_17" to "17",  // weight
            "list_18" to "18",  // eye color
            "list_19" to "19",  // hair colour
        )

        // canonicalizeAamvaIndex was moved into AamvaLexer.canonicalize when
        // the lexer was extracted in round 4 of the review pairing. All
        // call sites now go through AamvaLexer.findAamvaToken which calls
        // canonicalize internally.

        /**
         * Strip the AAMVA index prefix from an observation's text when the
         * leading lexer-recognized token canonicalizes to the matched class's
         * expected index. If the token is a different known AAMVA index and
         * the class is guarded by [dropOnIndexMismatch], drop the observation
         * before it can enter the voter under the wrong field id.
         * Now defers to [AamvaLexer.findAamvaToken] for
         * recognition — handles whitespace-separated AND fused forms
         * (round 4, 2026-05-10).
         */
        /**
         * YOLO classes whose values should be DROPPED (returned as empty)
         * when the leading AAMVA-token index disagrees with the class's
         * expectedAamvaIndex. These are indexed AAMVA rows plus international
         * aliases that commonly receive AAMVA OCR by bbox IoU. Dropping the
         * whole observation prevents an index-prefixed value from reaching
         * the voter under the wrong field id.
         */
        private val dropOnIndexMismatch: Set<String> = setOf(
            "surname", "given_name", "personal_num", "country",
            "list_1", "list_2", "list_3", "list_4a", "list_4b", "list_4d",
            "list_8f", "list_8s", "list_9", "list_9a", "list_12",
            "list_15", "list_16", "list_17", "list_18", "list_19",
        )

        /**
         * Result of strip + telemetry signal. [mismatchedFromIndex] is the
         * AAMVA index that the lexer recognized at the start of the text
         * BUT didn't match [yoloClass]'s expectedAamvaIndex — i.e. a strong
         * "this bbox→observation pairing is suspect" signal that the
         * telemetry layer surfaces as supervised retrain data.
         */
        data class StripResult(
            val text: String,
            val mismatchedFromIndex: String?
        )

        /**
         * OCR-confusion alias: when the bare digit `X` appears at the start
         * of an observation matched to a YOLO class whose expectedAamvaIndex
         * is `Xy` (`X` + letter), treat the digit as the multi-char index.
         * Handles the common case where ML Kit drops the trailing letter
         * of "4d" → "4" or "9a" → "9". The lexer's word-boundary precondition
         * + trailing-digit guard make this safe — a bare "4" with a digit
         * following it is already rejected, so this alias only kicks in
         * when the next char is a separator (real AAMVA-token pattern).
         *
         * round-8 sanity note: `"9a" → "9"` is safe even though `9`
         * is itself a known AAMVA index (vehicle class). This map is
         * consulted per-class with the class's *own* expected index — the
         * alias only fires when `expected == "9a"` (i.e. list_9a). The
         * list_9 path uses `expected == "9"` which has no entry here, so
         * a bare "9 ..." landing in list_9 never triggers the alias.
         */
        private val bareDigitAlias: Map<String, String> = mapOf(
            "4a" to "4", "4b" to "4", "4d" to "4", "9a" to "9",
        )

        fun stripAamvaPrefixForClass(text: String, yoloClass: String): StripResult {
            val token = AamvaLexer.findAamvaToken(text)
            val expected = expectedAamvaIndex[yoloClass]
            if (expected == null) {
                if (token != null && token.range.first <= 2 && yoloClass in dropOnIndexMismatch) {
                    return StripResult("", token.index)
                }
                return StripResult(text, null)
            }
            if (token != null && token.range.first <= 2) {
                if (token.index == expected) {
                    val labelPart = if (token.label != null) "${token.label} " else ""
                    return StripResult((labelPart + token.value).trim(), null)
                }
                // Real index mismatch — drop for demographic classes.
                val out = if (yoloClass in dropOnIndexMismatch) "" else text
                return StripResult(out, token.index)
            }
            // No lexer-recognised token at the start. Try the pure-Kotlin
            // platform fallback paths (extracted to stripPlatformPrefixes
            // for JVM-unit-test coverage — task #69).
            return stripPlatformPrefixes(text, yoloClass, expected)
                ?: StripResult(text, null)
        }

        /**
         * Pure-Kotlin prefix-strip fallbacks (no JNI / no AamvaLexer).
         *
         * Two paths in priority order:
         *
         *  1. **Bare-digit alias** — if the class's expectedAamvaIndex is
         *     a multi-char index like `"4d"` / `"4a"` / `"4b"` / `"9a"`,
         *     and the text begins with just the leading digit + whitespace
         *     + a license-shaped continuation, strip the bare digit.
         *     Handles the common OCR pattern where MLKit drops the
         *     trailing letter of `"4d"` and reads it as `"4 D440-..."`.
         *
         *  2. **Trust-the-class** for address rows (list_8f / list_8s) —
         *     with the post-iter-34 aspect-ratio fix MLKit now usually
         *     separates the AAMVA index from the value with a real space,
         *     but consistently MISREADS the small `"8"` digit as `"1"` or
         *     `"6"` depending on the frame. The right character is
         *     unknowable at the symbol level, but the YOLO class match
         *     tells us this observation IS the address row, which by AAMVA
         *     D-20 always starts with index `"8"`. Strip ANY single leading
         *     digit if followed by the canonical `house# street` shape
         *     `\d{2,5}\s+\D`. Bounded to list_8f / list_8s only — never
         *     applied to license # / name classes where a leading digit
         *     IS the value.
         *
         * Returns `null` when neither path matches; caller falls back to
         * the original text. `internal` (not `private`) so the JVM unit
         * tests in `android/src/test/.../TightenersTest.kt` can exercise
         * the regex paths directly without needing the JNI-backed
         * AamvaLexer entry point. Task #69.
         */
        internal fun stripPlatformPrefixes(
            text: String,
            yoloClass: String,
            expected: String,
        ): StripResult? {
            val bareDigit = bareDigitAlias[expected]
            if (bareDigit != null) {
                val m = Regex("^\\s*${Regex.escape(bareDigit)}\\s+(\\S.*)$").find(text)
                if (m != null) {
                    return StripResult(m.groupValues[1].trim(), null)
                }
            }
            if (yoloClass == "list_8f" || yoloClass == "list_8s") {
                val m = Regex("^\\s*\\d\\s+(\\d{2,5}\\s+\\D.*)$").find(text)
                if (m != null) {
                    return StripResult(m.groupValues[1].trim(), null)
                }
            }
            return null
        }

        /**
         * Per-class content-shape tightener. Applied AFTER prefix stripping.
         * Trims trailing OCR noise on classes with strongly-typed value
         * shapes (license number is the canonical example). Returns the
         * input unchanged for classes without a known shape.
         *
         * For list_4d (US AAMVA D-20 driver-licence number): values are
         * runs of [A-Z0-9] possibly joined by `-`. Anything past the first
         * whitespace or off-pattern character is OCR'd content bleed from
         * adjacent visual elements that ML Kit lumped into the same line
         * because its bbox-height + gap signals don't separate fields
         * by font size.
         */
        /** State-name -> 2-letter code for IDNet US DL corpus. Multi-word
         *  entries listed first to match before any single-word prefix. */
        private val kStateNameToCode = listOf(
            "DISTRICT OF COLUMBIA" to "DC",
            "NORTH CAROLINA"       to "NC",
            "SOUTH DAKOTA"         to "SD",
            "WEST VIRGINIA"        to "WV",
            "PENNSYLVANIA"         to "PA",
            "CALIFORNIA"           to "CA",
            "WISCONSIN"            to "WI",
            "ARIZONA"              to "AZ",
            "NEVADA"               to "NV",
            "UTAH"                 to "UT",
        )

        private val kStateLicensePatterns = mapOf(
            "AZ" to "D[0-9OIl]{8}",
            "CA" to "[A-Z][0-9OIl]{7}",
            "DC" to "[0-9OIl]{7}",
            "NV" to "[0-9OIl]{10}",
            "NC" to "[0-9OIl]{12}",
            "PA" to "[0-9OIl]{2}\\s?[0-9OIl]{3}\\s?[0-9OIl]{3}",
            "SD" to "[0-9OIl]{8}",
            "UT" to "[0-9OIl]{9}",
            "WV" to "W[0-9OIl]{6}",
            "WI" to "[A-Z][0-9OIl]{3}-[0-9OIl]{4}-[0-9OIl]{4}-[0-9OIl]{2}",
        )

        private fun detectState(observations: List<OcrObservation>): String? {
            val pool = observations.joinToString(" ") { it.text.uppercase() }
            for ((name, code) in kStateNameToCode) {
                if (name in pool) return code
            }
            return null
        }

        private val kEyeColorCodes = setOf(
            "BLK", "BLU", "BRO", "GRY", "GRN", "HAZ", "MAR", "PNK", "DIC", "UNK"
        )
        private val kHairColorCodes = setOf(
            "BAL", "BLK", "BLN", "BRO", "GRY", "RED", "SDY", "WHI", "UNK"
        )

        /** First 3-letter-exact token in [text] (case-insensitive) whose
         *  upper form is in [allowlist]; null if none. Used by
         *  tightenByContentShape for list_18/list_19 to extract just the
         *  color code from values like "EYES BRO RACE W" or "HAIR BRO". */
        private fun firstColorCodeMatch(text: String, allowlist: Set<String>): String? {
            val matches = Regex("[A-Z]{3,}").findAll(text.uppercase())
            for (m in matches) {
                if (m.value.length == 3 && m.value in allowlist) return m.value
            }
            return null
        }

        fun tightenByContentShape(text: String, yoloClass: String,
                                  detectedState: String? = null): String {
            if (text.isEmpty()) return text
            return when (yoloClass) {
                "list_4d" -> {
                    // State-aware first (iter 6): if a state was detected,
                    // strip "DLN"/"DL" labels and apply per-state shape regex.
                    val stateResult = if (detectedState != null) {
                        kStateLicensePatterns[detectedState]?.let { pattern ->
                            var stripped = text.uppercase()
                            for (p in listOf("DLN:", "DLN", "DL:", "DL")) {
                                if (stripped.startsWith(p)) {
                                    stripped = stripped.removePrefix(p).trim()
                                    break
                                }
                            }
                            val m = Regex(pattern).find(stripped)
                            m?.let {
                                val raw = it.value
                                val prefixLen = if (detectedState in setOf("AZ","CA","WV","WI")) 1 else 0
                                val sb = StringBuilder()
                                raw.forEachIndexed { i, c ->
                                    sb.append(when {
                                        i < prefixLen -> c
                                        c == 'O' -> '0'
                                        c == 'I' -> '1'
                                        c == 'L' -> '1'
                                        else -> c
                                    })
                                }
                                sb.toString()
                            }
                        }
                    } else null
                    stateResult ?: run {
                        val normalized = text.uppercase()
                        val m = Regex("^[A-Z0-9]+(?:-[A-Z0-9]+)*").find(normalized)
                        if (m != null && m.value.length >= 4) m.value else text
                    }
                }
                "list_18" -> firstColorCodeMatch(text, kEyeColorCodes) ?: text
                "list_19" -> firstColorCodeMatch(text, kHairColorCodes) ?: text
                "list_15" -> {
                    Regex("(?<![A-Z])[MFX](?![A-Z])")
                        .find(text.uppercase())?.value ?: text
                }
                "list_17" -> {
                    val upper = text.uppercase().replace("IB", "LB").replace("|B", "LB")
                    val m = Regex("(\\d{2,4})\\s*(LBS?|KGS?)").find(upper)
                    if (m != null) "${m.groupValues[1]} ${m.groupValues[2]}" else text
                }
                "list_3"  -> extractDate(text, preferLast = false) ?: text
                "list_4a" -> extractDate(text, preferLast = false) ?: text
                "list_4b" -> extractDate(text, preferLast = true)  ?: text
                "list_9"  -> extractSingleLetterValue(text, dropTokens = listOf("NONE")) ?: text
                "list_9a" -> {
                    if (text.uppercase().contains("NONE")) "NONE"
                    else extractSingleLetterValue(text) ?: text
                }
                "list_12" -> {
                    if (text.uppercase().contains("NONE")) "NONE"
                    else extractSingleLetterValue(text, dropTokens = listOf("NONE")) ?: text
                }
                "list_16" -> {
                    val m = Regex("(\\d+)'-(\\d+)(?:\"|'')").find(text)
                    if (m != null) "${m.groupValues[1]}'-${m.groupValues[2]}''" else text
                }
                else -> text
            }
        }

        /** Single uppercase letter extractor with label/diacritic stripping. */
        private fun extractSingleLetterValue(text: String, dropTokens: List<String> = emptyList()): String? {
            var s = text.uppercase()
            val labels = listOf(
                "CLASS:", "CLASS", "CLAS:", "CLAS",
                "REST:", "REST", "RESTR:", "RESTR", "RSTR",
                "END:", "END", "ENDORSEMENTS"
            )
            for (l in labels) s = s.replace(l, " ")
            for (dt in dropTokens) s = s.replace(dt, " ")
            for (m in Regex("[A-Z]+").findAll(s)) {
                if (m.value.length == 1) return m.value
            }
            return null
        }

        /** Extract canonical MM/DD/YYYY from `text`, tolerating OCR
         *  substitutions (`O`->`0`, `I`/`l`->`1`) and `I` as separator
         *  misread of `/`. Returns null if no valid date found. */
        private fun extractDate(text: String, preferLast: Boolean): String? {
            val stripped = text.replace(" ", "")
            val matches = Regex("([0-9OIl]{2})[/Il]([0-9OIl]{2})[/Il]([0-9OIl]{4})")
                .findAll(stripped).toList()
            if (matches.isEmpty()) return null
            fun canon(s: String) = s.replace("O", "0")
                                     .replace("I", "1")
                                     .replace("l", "1")
            val candidates = if (preferLast) matches.reversed() else matches
            for (m in candidates) {
                val mm = canon(m.groupValues[1]).toIntOrNull() ?: continue
                val dd = canon(m.groupValues[2]).toIntOrNull() ?: continue
                val yy = canon(m.groupValues[3]).toIntOrNull() ?: continue
                if (mm in 1..12 && dd in 1..31 && yy in 1900..2100) {
                    return "%02d/%02d/%04d".format(mm, dd, yy)
                }
            }
            return null
        }

        /**
         * Split [text] (with associated [bbox]) into per-AAMVA-index sub-
         * observations using proportional horizontal slicing. Single-index
         * and zero-index inputs return a single-element list unchanged.
         * Two-or-more-index inputs get N slices where slice i covers the
         * character range between token i's start and (token i+1's start | EOL).
         *
         * Defers to [AamvaLexer.findAllAamvaTokens] so the same recognition
         * grammar applies as in [stripAamvaPrefixForClass] — fused tokens
         * ("16HGT5'-10\"") split correctly, fake indices inside values
         * ("180" in a phone number) do not produce false splits because of
         * the word-boundary precondition.
         */
        private fun splitObservationByAamvaIndices(
            text: String,
            bbox: RectF
        ): List<Pair<String, RectF>> {
            val tokens = AamvaLexer.findAllAamvaTokens(text)
            if (tokens.size < 2) return listOf(text to bbox)
            val totalLen = text.length.toFloat().coerceAtLeast(1f)
            val out = mutableListOf<Pair<String, RectF>>()
            for (i in tokens.indices) {
                val startChar = tokens[i].range.first
                val endChar = if (i + 1 < tokens.size) tokens[i + 1].range.first else text.length
                val subText = text.substring(startChar, endChar).trim()
                if (subText.isEmpty()) continue
                val leftFrac = startChar / totalLen
                val rightFrac = endChar / totalLen
                val subBbox = RectF(
                    bbox.left + leftFrac * bbox.width(),
                    bbox.top,
                    bbox.left + rightFrac * bbox.width(),
                    bbox.bottom
                )
                out.add(subText to subBbox)
            }
            return out
        }

        /** Model input is fixed at 640x640 — see docs/MODEL_CONTRACT.md. */
        private const val YOLO_INPUT_SIZE = 640

        /**
         * ML Kit OCR rectified-bitmap dimensions — ID-1 driver licence
         * aspect ratio 1.586:1 (ISO/IEC 7810). round-9 finding: the
         * earlier 640×640 square rectify horizontally squished characters
         * by ~37%, which combined with already-small AAMVA index digits
         * (rendered ~12 px tall) caused MLKit to misread "8" as "1" on the
         * address row AND drop the inter-token space, producing "14827"
         * instead of "8 4827". Rectifying to a wider canvas at the true
         * card ratio gives MLKit roughly 2× the pixel density per
         * character without distortion.
         *
         * The YOLO field-detector was trained on 640×640 square crops
         * (per model-training/idnet/prepare_yolo_fields.py — "Rectify the
         * document to a canonical 640×640 crop"), so it still needs a
         * square input. We get that with a SECOND anisotropic resize from
         * the 1280×806 ML Kit canvas to 640×640 — same horizontal squish
         * the model was trained on, no second perspective warp needed.
         */
        // v2 #46: derived from ID1 aspect (85.60 / 53.98 = 1.5858) in
        // cpp/constants.hpp. 1280 / 1.5858 = 807.07 → 807. Single source of
        // truth is the C++ constants header; the Kotlin numbers must track.
        private const val OCR_RECTIFY_WIDTH = 1280
        private const val OCR_RECTIFY_HEIGHT = 807

        /** YOLOv8n field detector outputs 30 classes (kFieldClassNames). */
        private const val YOLO_NUM_CLASSES = 30

        /** 80² + 40² + 20² = 8400 anchors at 640x640 input. */
        private const val YOLO_NUM_ANCHORS = 8400

        /** NMS knobs — match Ultralytics defaults / iOS implementation. */
        private const val CONF_THRESHOLD = 0.01f
        private const val IOU_THRESHOLD = 0.45f
        private const val MAX_DETECTIONS = 100

        init {
            // Task #41 — JVM unit tests (android/src/test/) exercise the
            // platform-layer regex tighteners on the host JVM where no
            // libDLScan.so is loadable. Swallow UnsatisfiedLinkError so
            // companion-object static-init completes; instance methods
            // that need JNI (parseBarcodeData, ocrExtractFields,
            // etc.) will hit the JNI bridge at first call and crash
            // there if the library actually failed to load on a real
            // device. The platform-layer regex helpers don't need JNI.
            try {
                System.loadLibrary("DLScan")
            } catch (e: UnsatisfiedLinkError) {
                Log.w(TAG, "libDLScan.so not loadable (expected on JVM unit-test runner): " + e.message)
            }
        }
    }
}
