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
class HybridDlScanAndroid : HybridDlScanSpec() {

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
    // compiled into libDlScan.so (loaded below in companion object).
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

    /**
     * Decode the YOLOv8n raw output tensor and run per-class NMS in C++.
     * Returns a flat float array of length 6 * num_detections, with each
     * 6-tuple laid out as [class_id, confidence, x1, y1, x2, y2] in 640x640
     * model-input pixel space. Empty array if no anchor passes the
     * confidence threshold. Empty if the model output is malformed.
     *
     * `layout`: 0 = ChannelMajor (Ultralytics export default), 1 = AnchorMajor.
     */
    @DoNotStrip
    @Keep
    private external fun nativeDecodeAndNms(
        tensor: FloatArray,
        numClasses: Int,
        numAnchors: Int,
        layout: Int,
        confThreshold: Float,
        iouThreshold: Float,
        maxDetections: Int
    ): FloatArray

    /** Maps a YOLO class index (0..29) to the canonical class name string. */
    @DoNotStrip
    @Keep
    private external fun nativeClassName(classId: Int): String

    // ---- v2 voter JNI (task #52). FieldVoter Kotlin wrapper routes here.
    @DoNotStrip @Keep private external fun nativeVoterNew(maxVotes: Int): Long
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

    // -------------------------------------------------------------------------
    // ML Kit text recognizer — created once, reused across frames.
    // TextRecognition.getClient is thread-safe per ML Kit documentation.
    // -------------------------------------------------------------------------

    private val textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    // -------------------------------------------------------------------------
    // TFLite field detector — lazy-loaded once per hybrid instance.
    // -------------------------------------------------------------------------

    private val tfliteLock = ReentrantLock()
    private var tfliteInterpreter: Interpreter? = null
    private var tfliteLoadAttempted = false

    // DocAligner doc-segmentation model — separate Interpreter, same load
    // pattern as the YOLO field detector. lcnet100 heatmap regression,
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
     * 12 unit tests).
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
     * The host HybridDlScanAndroid object outlives all calls; we don't try
     * to implement AutoCloseable because the JS side controls reset via
     * resetLicenseFieldRecognition() not destruction.
     */
    private inner class FieldVoter(maxVotes: Int = 20) {
        private val handle: Long = nativeVoterNew(maxVotes)

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

        fun close() {
            if (handle != 0L) nativeVoterDelete(handle)
        }

        protected fun finalize() {
            // Defensive — main lifecycle goes through close(). Finalizer
            // is a backstop, not the primary cleanup path.
            close()
        }
    }

    private val voter = FieldVoter(maxVotes = 20)

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
    // single-threaded from inside `runDetectionPipeline`'s worker thread.
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

    // No ImageProcessor field — runYolo builds the quantized input ByteBuffer
    // directly from bitmap pixels, applying the model's actual input
    // quantizationParams (scale, zeroPoint) read at inference time. This
    // avoids the trap that TensorImage(INT8).load(bitmap) just casts uint8
    // bytes (255 -> -1) without applying the zero_point = -128 that the
    // YOLOv8 export uses (caught in final review).

    // -------------------------------------------------------------------------
    // OCR state — all reads/writes guarded by ocrLock.
    // -------------------------------------------------------------------------

    private val ocrLock = ReentrantLock()
    private var cachedOcrResult: LicenseDataSpec? = null
    private var ocrInFlight = false
    private var lastOcrTime: Long = 0L
    /// Generation counter — bumped by resetLicenseFieldRecognition() so any
    /// in-flight detection job whose result lands AFTER a reset() will be
    /// discarded instead of overwriting the cleared cache with stale data.
    private var ocrGeneration: Long = 0L
    @Volatile private var cardCapturedThisSession = false

    /**
     * Pipeline-result generation — bumped each time runDetectionPipeline
     * actually completes and writes cachedOcrResult. Distinct from
     * ocrGeneration (which is reset-driven). JS-side voting uses this to
     * count UNIQUE frame results: the worklet calls recognizeLicenseFields
     * many times per second but the worker thread only fires ~2 FPS, so
     * most calls return the same cached spec. Returning the spec to JS
     * only when this generation has changed since the last JS read gives
     * JS one result-per-unique-pipeline-run.
     */
    private var ocrResultGeneration: Long = 0L
    private var lastReadOcrResultGeneration: Long = -1L

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

    // -------------------------------------------------------------------------
    // recognizeLicenseFields — synchronously called on a Camera worklet thread.
    //
    // Pipeline (per Phase 4 design — reviewed):
    //   1. Convert YUV mediaImage → ARGB Bitmap (one-time per frame).
    //   2. Letterbox-resize to 640x640 (preserves aspect ratio for YOLO).
    //   3. TFLite inference → raw output tensor (1, 34, 8400) float32.
    //   4. dlscan::yolo::decode_and_nms → per-field bboxes (in 640x640 space).
    //   5. Reverse-letterbox bboxes back to original-frame pixel space.
    //   6. ML Kit Text recognition on the same Bitmap (one call) → text + bboxes.
    //   7. IoU-match observations to YOLO bboxes.
    //   8. dlscan::extract_fields_from_candidates (via JNI) → LicenseDataSpec.
    //
    // Doc segmentation is intentionally skipped on Android v1 (ML Kit
    // Document Scanner is a full-screen Activity, not a per-frame API).
    // YOLO runs on the raw camera frame; accuracy is lower than iOS until
    // a v2 takes a different segmentation approach.
    // -------------------------------------------------------------------------

    @ExperimentalGetImage
    override fun recognizeLicenseFields(frame: HybridFrameSpec): Variant_NullType_LicenseDataSpec {
        val now = System.currentTimeMillis()

        // Snapshot the cached result + generation under lock. Return the
        // spec to JS only if its generation has advanced since the last
        // call — otherwise JS sees the SAME pipeline run as many times as
        // the camera fires frames (camera ~30 fps, worker ~2 fps → ~15x
        // duplicate returns per real result). The voting loop on JS
        // depends on each non-null return being a fresh frame.
        val snapshotCached: LicenseDataSpec?
        val snapshotGen: Long
        ocrLock.withLock {
            snapshotCached = cachedOcrResult
            snapshotGen = ocrResultGeneration
        }
        val freshSpec: LicenseDataSpec? =
            if (snapshotCached != null && snapshotGen != lastReadOcrResultGeneration) {
                lastReadOcrResultGeneration = snapshotGen
                snapshotCached
            } else null

        // Snapshot + decide under lock — minimal critical section.
        //
        // THREADING ASSUMPTION (round-6 finding): Vision Camera's
        // Android frame-processor invokes recognizeLicenseFields from a
        // single serial worklet thread, so two concurrent callers cannot
        // exist. That guarantee is what makes the check-then-set pattern
        // safe — we release the lock between reading `ocrInFlight=false`
        // and setting `ocrInFlight=true`, which would otherwise race with
        // a parallel caller. If a future refactor adds a second entry
        // point (e.g. a one-shot capture API or a manual scan() bridge),
        // this dual-lock pattern must be replaced with a compare-and-set
        // or single-acquisition begin-job() helper.
        val cached: LicenseDataSpec?
        val shouldStart: Boolean
        ocrLock.withLock {
            cached = cachedOcrResult
            val elapsed = now - lastOcrTime
            shouldStart = !ocrInFlight && elapsed >= 300L  // ~3.3 fps rate limit (experiment B)
        }

        if (!shouldStart) {
            return variantOf(freshSpec)
        }

        // Extract the underlying android.media.Image from the VC Frame.
        // HybridFrame implements NativeFrame; NativeFrame.image is an
        // ImageProxy whose .image is the underlying android.media.Image
        // (requires @ExperimentalGetImage).
        val nativeFrame = frame as? NativeFrame
        val mediaImage = nativeFrame?.image?.image
        if (mediaImage == null) {
            return variantOf(freshSpec)
        }

        val rotationDegrees = nativeFrame.image.imageInfo.rotationDegrees
        if (!rotationDebugLogged) {
            rotationDebugLogged = true
            Log.i(TAG, "DEBUG: rotationDegrees=" + rotationDegrees
                + " mediaImage=" + mediaImage.width + "x" + mediaImage.height)
        }

        // CRITICAL: convert YUV → Bitmap SYNCHRONOUSLY on the worklet thread
        // before dispatching to the background worker. Vision Camera disposes
        // the frame immediately after this method returns, so the underlying
        // android.media.Image will be closed/recycled by CameraX before the
        // worker thread runs — copying the pixels into a Bitmap now severs
        // that lifetime dependency. (iOS retains via Swift's CF bridging on
        // CVPixelBuffer; Android needs an explicit copy here.)
        val bitmap = mediaImageToBitmap(mediaImage, rotationDegrees)
        if (bitmap == null) {
            // YUV conversion failed — skip without burning the rate limit.
            return variantOf(freshSpec)
        }

        // Commit: reserve the in-flight slot, record the start time, snapshot
        // the generation. Job result is only written back if generation
        // hasn't been bumped by resetLicenseFieldRecognition() in the
        // meantime — see ocrGeneration field doc.
        val jobGeneration: Long
        ocrLock.withLock {
            ocrInFlight = true
            lastOcrTime = now
            jobGeneration = ocrGeneration
        }

        // Run the full pipeline on a separate thread so the worklet never blocks.
        // The Bitmap was copied above; the underlying mediaImage is no longer
        // referenced past this point and is safe for VC to dispose.
        Promise.parallel {
            try {
                val spec = runDetectionPipeline(bitmap)
                ocrLock.withLock {
                    if (ocrGeneration == jobGeneration) {
                        cachedOcrResult = spec
                        // Bump the per-pipeline-run generation so the next
                        // recognizeLicenseFields call to JS returns a FRESH
                        // result rather than the same cached spec again.
                        // Only bumped on non-null specs: null pipelines
                        // shouldn't tick the voter forward.
                        if (spec != null) ocrResultGeneration += 1L
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "detection pipeline failed", t)
                // Don't clobber the cache on transient failure; next frame retries.
            } finally {
                ocrLock.withLock {
                    ocrInFlight = false
                }
            }
        }

        return variantOf(cached)
    }

    /**
     * Full detection pipeline: YOLO → IoU-match → C++ structured extract.
     * The bitmap is the camera frame already YUV-converted + rotated; this
     * function runs entirely on the worker thread. Returns null on any
     * stage failure (logged for diagnostics).
     */
    /**
     * Test-only eval entry point: run the production single-frame pipeline
     * on a pre-decoded bitmap and return the per-yolo-class extracted text
     * BEFORE the multi-frame voter and BEFORE the C++ extract_fields step.
     *
     * Used by the IDNet batch-eval instrumented test
     * (androidTest/.../IdnetBatchEvalTest.kt) to measure per-state per-field
     * accuracy against ground truth JSON. Strict-text-pool candidates
     * override bbox-IoU candidates for the same yolo class — mirrors the
     * StrictAgrees → CrossValidated tier upgrade applied by the C++
     * resolver in production. Keep in sync with runDetectionPipeline; if
     * either drifts, the eval ceases to reflect production behaviour.
     *
     * Returns the FieldId → text map (FieldId int from FieldCandidate),
     * empty on any stage failure. Caller maps FieldId → yolo class via the
     * static FieldId.classNameOrNull() table inlined for tests below.
     */
    @VisibleForTesting
    fun ocrPipelineForEval(bitmap: Bitmap): Map<String, String> {
        val corners = runDocAligner(bitmap)
        val ocrBitmap = if (corners != null) {
            rectifyBitmap(bitmap, corners, OCR_RECTIFY_WIDTH, OCR_RECTIFY_HEIGHT)
        } else bitmap
        val yoloBitmap = if (corners != null) {
            Bitmap.createScaledBitmap(ocrBitmap, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE, true)
        } else bitmap
        val ocrToYoloScaleX = YOLO_INPUT_SIZE.toFloat() / ocrBitmap.width.toFloat()
        val ocrToYoloScaleY = YOLO_INPUT_SIZE.toFloat() / ocrBitmap.height.toFloat()

        val detections = runYolo(yoloBitmap) ?: return emptyMap()
        if (detections.isEmpty()) return emptyMap()

        val visionResult = try {
            Tasks.await(
                textRecognizer.process(InputImage.fromBitmap(ocrBitmap, 0)),
                10L,
                java.util.concurrent.TimeUnit.SECONDS
            )
        } catch (t: Throwable) {
            Log.w(TAG, "eval: ML Kit failed: $t")
            return emptyMap()
        }

        val observations = mutableListOf<OcrObservation>()
        var nextLineId = 0
        fun toYoloSpace(r: RectF): RectF = if (corners != null) {
            RectF(r.left * ocrToYoloScaleX, r.top * ocrToYoloScaleY,
                  r.right * ocrToYoloScaleX, r.bottom * ocrToYoloScaleY)
        } else r
        for (block in visionResult.textBlocks) {
            for (line in block.lines) {
                val box = line.boundingBox ?: continue
                val lineBbox = RectF(box)
                val lineId = nextLineId++
                val clusters = clusterLineByElementHeight(line, lineBbox, lineId)
                for (clusterObs in clusters) {
                    for ((subText, subBbox) in splitObservationByAamvaIndices(
                            clusterObs.text, clusterObs.bbox)) {
                        observations.add(
                            OcrObservation(
                                text = subText,
                                bbox = toYoloSpace(subBbox),
                                sourceLineIndex = clusterObs.sourceLineIndex,
                                indexWithinSourceLine = clusterObs.indexWithinSourceLine,
                            )
                        )
                    }
                }
            }
        }
        if (observations.isEmpty()) return emptyMap()

        val demographicCandidates = parseAamvaDemographicFields(observations)
        val bboxCandidates = matchObservationsToFields(observations, detections)

        // FieldId int → yolo class name. MUST match cpp/yolo/field_classes.cpp's
        // kFieldClassNames + kFieldClassToFieldId parallel arrays. Manually
        // built here because the JNI nativeClassNameToFieldId only does the
        // reverse direction; eval reporting is most useful keyed by yolo
        // class string. flagged: if FieldId enum gains a new value,
        // this map needs a row.
        val fieldIdToClassName = mapOf(
            1   to "list_1",
            2   to "list_2",
            3   to "list_3",
            5   to "list_5",
            9   to "list_9",
            12  to "list_12",
            15  to "list_15",
            16  to "list_16",
            17  to "list_17",
            18  to "list_18",
            19  to "list_19",
            41  to "list_4a",
            42  to "list_4b",
            43  to "list_4d",
            81  to "list_8f",
            82  to "list_8s",
            91  to "list_9a",
            100 to "surname",
            101 to "given_name",
            102 to "birthday",
            103 to "expire_date",
            104 to "personal_num",
            105 to "gender",
            106 to "country",
        )

        // Bbox first; strict-text-pool wins by overwrite (mirrors the
        // StrictAgrees → CrossValidated upgrade behaviour in the C++ resolver).
        val out = HashMap<String, String>()
        for (c in bboxCandidates) {
            val name = fieldIdToClassName[c.fieldId] ?: continue
            out[name] = c.text
        }
        for (c in demographicCandidates) {
            val name = fieldIdToClassName[c.fieldId] ?: continue
            out[name] = c.text
        }
        return out
    }

    /**
     * Iter 7 D-lite probe (Android port of `runVisionKitPerRegion` in the
     * iOS CLI). Runs YOLO first, then runs MLKit Text Recognition once per
     * YOLO detection on a bitmap cropped to that detection's bbox. Avoids
     * whole-card OCR and the downstream bbox-IoU matching entirely; tests
     * whether field-localised OCR beats the whole-card + heuristics pipeline.
     *
     * Returns the yolo-class → text map. Each text is the first MLKit line's
     * value run through the same strip+tighten chain the production pipeline
     * uses (so per-class shape constraints still apply). A second pass
     * re-tightens list_4d once a state is detected from the region pool.
     *
     * Test-only — paired with `ocrPipelineRegionForEval` in
     * tools/dlscan-debug-cli/android-test/IdnetBatchEvalTest.kt.
     */
    @VisibleForTesting
    fun ocrPipelineRegionForEval(bitmap: Bitmap): Map<String, String> {
        val corners = runDocAligner(bitmap)
        val ocrBitmap = if (corners != null) {
            rectifyBitmap(bitmap, corners, OCR_RECTIFY_WIDTH, OCR_RECTIFY_HEIGHT)
        } else bitmap
        val yoloBitmap = if (corners != null) {
            Bitmap.createScaledBitmap(ocrBitmap, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE, true)
        } else bitmap
        val detections = runYolo(yoloBitmap) ?: return emptyMap()
        if (detections.isEmpty()) return emptyMap()

        // YOLO bbox → ocrBitmap pixel space inverse mapping. When doc-seg
        // succeeded ocrBitmap is OCR_RECTIFY_WIDTH × OCR_RECTIFY_HEIGHT, and
        // YOLO sees a 640×640 anisotropic squish of that. When doc-seg
        // failed, runYolo letterboxed the raw bitmap → we'd need the
        // letterbox params to invert exactly. For this probe (eval-only,
        // doc-seg almost always succeeds on the IDNet corpus) we skip the
        // failure case and fall back to the un-cropped path.
        // Iter-9 fix: scale depends on whether doc-seg succeeded.
        //   corners != null: YOLO ran on 640x640 scaled ocrBitmap → scale up.
        //   corners == null: YOLO ran on raw bitmap and reversed letterbox
        //     internally, so detections are already in ocrBitmap (=raw) space.
        val yoloToOcrScaleX = if (corners != null) ocrBitmap.width.toFloat() / YOLO_INPUT_SIZE.toFloat() else 1.0f
        val yoloToOcrScaleY = if (corners != null) ocrBitmap.height.toFloat() / YOLO_INPUT_SIZE.toFloat() else 1.0f

        // Iter-13 findings: tried 5% blanket pad (hurt long fields), 3% on
        // tiny classes only (mixed), 1.5% on tiny classes (worse). MLKit's
        // recogniser needs FULL-IMAGE context, not just more cropped
        // pixels. The cropping itself (vs Vision's regionOfInterest which
        // operates on the full image with a hint) is what kills accuracy.
        // Reverted to iter-9 baseline + per-class right-pad for the date
        // and zip suffix recovery (those are bbox-edge issues, not
        // context issues — they work fine).
        val padX = 0.005f * ocrBitmap.width
        val padY = 0.005f * ocrBitmap.height
        val expandedRightClasses = setOf("list_3", "list_4a", "list_4b",
                                          "list_17", "list_8s")

        // First pass: per-region OCR + strip + (state-less) tighten.
        data class RegionResult(val yoloClass: String, val rawText: String,
                                val stripped: String, val latencyMs: Long)
        val perRegion = mutableListOf<RegionResult>()
        for (det in detections) {
            val b = det.bbox
            val rightPad = if (det.name in expandedRightClasses)
                0.06f * ocrBitmap.width else padX
            val left = (b.left * yoloToOcrScaleX - padX).coerceAtLeast(0f)
            val top = (b.top * yoloToOcrScaleY - padY).coerceAtLeast(0f)
            val right = (b.right * yoloToOcrScaleX + rightPad)
                .coerceAtMost(ocrBitmap.width.toFloat())
            val bottom = (b.bottom * yoloToOcrScaleY + padY)
                .coerceAtMost(ocrBitmap.height.toFloat())
            val w = (right - left).toInt()
            val h = (bottom - top).toInt()
            if (w < 4 || h < 4) {
                perRegion.add(RegionResult(det.name, "", "", 0L))
                continue
            }
            // Iter-14: white-mask region emulation instead of bitmap crop.
            // MLKit needs the recogniser's input to look like a full-card
            // image (its CNN was trained on full cards / pages). Cropping
            // (iters 7-13) starved the recogniser of context and made it
            // emit empty on most regions. Instead: clone the full
            // ocrBitmap and paint white over everything OUTSIDE the YOLO
            // bbox. The recogniser still sees a card-sized image, but
            // there's only text in the bbox region — so its output is
            // effectively bound to that field. Mirrors Vision's
            // regionOfInterest semantics without an MLKit API change.
            val crop = ocrBitmap.copy(Bitmap.Config.ARGB_8888, true)
            val canvas = Canvas(crop)
            val whitePaint = Paint().apply { color = Color.WHITE; style = Paint.Style.FILL }
            // Iter-14b: mask top/bottom only, preserve full image width.
            // Masking left/right strips cuts off horizontal context that
            // MLKit's recogniser uses for character disambiguation
            // (especially on dates and single-letter fields). Top/bottom
            // masking still constrains MLKit to the bbox's row band, so
            // the per-field result doesn't bleed adjacent rows; the
            // full-width context gives the recogniser the language
            // model anchoring it needs.
            canvas.drawRect(0f, 0f, crop.width.toFloat(), top, whitePaint)
            canvas.drawRect(0f, bottom, crop.width.toFloat(), crop.height.toFloat(), whitePaint)
            val t0 = System.currentTimeMillis()
            val visionResult = try {
                Tasks.await(
                    textRecognizer.process(InputImage.fromBitmap(crop, 0)),
                    10L,
                    java.util.concurrent.TimeUnit.SECONDS
                )
            } catch (t: Throwable) {
                Log.w(TAG, "regionEval: ML Kit failed for ${det.name}: $t")
                crop.recycle()
                perRegion.add(RegionResult(det.name, "", "", 0L))
                continue
            }
            val dt = System.currentTimeMillis() - t0
            // iOS takes the joined text of all observations in the region.
            // MLKit returns text grouped as blocks→lines→elements; flatten
            // line-by-line to mirror that behaviour, preserving order.
            val texts = mutableListOf<String>()
            for (block in visionResult.textBlocks) {
                for (line in block.lines) {
                    texts.add(line.text)
                }
            }
            crop.recycle()
            val rawText = texts.joinToString(" ")
            val stripped = stripAamvaPrefixForClass(rawText, det.name).text
            val tightened = tightenByContentShape(stripped, det.name, null)
            perRegion.add(RegionResult(det.name, rawText, tightened, dt))
        }

        // State detection on the joined raw region pool (iOS analog: scan
        // the joined uppercase of all per-region texts for known state names).
        val pool = perRegion.joinToString(" ") { it.rawText.uppercase() }
        val detectedState = kStateNameToCode.firstOrNull { (name, _) ->
            name in pool
        }?.second

        val out = HashMap<String, String>()
        for (r in perRegion) {
            // First-wins per yolo class; runYolo's detections are sorted by
            // descending confidence already (see runYolo's NMS path), so the
            // first detection of any class is the highest-conf one.
            if (r.stripped.isNotEmpty() && r.yoloClass !in out) {
                out[r.yoloClass] = r.stripped
            }
        }

        // Second pass for list_4d: now that we know the state, re-tighten
        // with the per-state license-shape regex. Mirrors the iOS second
        // pass in the eval block.
        if (detectedState != null) {
            val r4 = perRegion.firstOrNull { it.yoloClass == "list_4d" }
            if (r4 != null && r4.rawText.isNotEmpty()) {
                val stripped = stripAamvaPrefixForClass(r4.rawText, "list_4d").text
                val tightened = tightenByContentShape(stripped, "list_4d", detectedState)
                if (tightened.isNotEmpty()) out["list_4d"] = tightened
            }
        }

        return out
    }

    @ExperimentalGetImage
    private fun runDetectionPipeline(bitmap: Bitmap): LicenseDataSpec? {
        // 0a. Document segmentation → corners in source-bitmap pixel space.
        val corners = runDocAligner(bitmap)
        // round-5 (task #82): when DocAligner returns null, do NOT
        // fall through to running YOLO on the raw camera frame. YOLO was
        // trained on rectified DL crops; raw frames produce garbage
        // detections that poison the voter. Cleaner to skip the frame.
        if (corners == null) {
            _scanProgress = maxOf(_scanProgress, 0.02)
            return null
        }
        // Normalize corners to [0,1] in DISPLAY orientation (portrait).
        // Camera sensor is landscape (w > h). Rotate 90° CW so that
        // displayX = sensorY/h and displayY = 1 - sensorX/w. The JS
        // side then only needs the aspect-fill crop transform.
        run {
            val w = bitmap.width.toFloat()
            val h = bitmap.height.toFloat()
            val landscape = w > h
            _detectedCardCorners = DoubleArray(8) { i ->
                val ci = (i / 2) * 2
                if (landscape) {
                    if (i % 2 == 0) (corners[ci + 1] / h).toDouble()
                    else 1.0 - (corners[ci] / w).toDouble()
                } else {
                    if (i % 2 == 0) (corners[i] / w).toDouble()
                    else (corners[i] / h).toDouble()
                }
            }
            Log.d(TAG, "CORNERS ${w.toInt()}x${h.toInt()} disp=[${
                _detectedCardCorners.joinToString(",") { "%.3f".format(it) }
            }]")
        }
        _scanProgress = maxOf(_scanProgress, 0.05)
        // 0b. Rectify to true ID-1 aspect ratio (1280×806) for ML Kit OCR.
        //     round-9: square 640×640 rectify horizontally squished
        //     small AAMVA index digits beyond MLKit's recognition floor,
        //     producing the "8"→"1" misread on the address row.
        val ocrBitmap = rectifyBitmap(
            bitmap, corners, OCR_RECTIFY_WIDTH, OCR_RECTIFY_HEIGHT
        )
        // 0c. Produce the YOLO input by anisotropic squish (NOT center-crop,
        //     NOT letterbox) of the OCR bitmap to 640×640. This reproduces
        //     YOLO's square-trained distribution without a second perspective
        //     warp.
        val yoloBitmap = Bitmap.createScaledBitmap(
            ocrBitmap, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE, true
        )
        // Ratios used to map OCR observation bboxes (in ocrBitmap space) to
        // YOLO output bboxes (in 640×640 space) for IoU matching.
        val ocrToYoloScaleX = YOLO_INPUT_SIZE.toFloat() / ocrBitmap.width.toFloat()
        val ocrToYoloScaleY = YOLO_INPUT_SIZE.toFloat() / ocrBitmap.height.toFloat()

        // 1. YOLO field detector → bboxes in 640×640 input space.
        val detections = runYolo(yoloBitmap) ?: run {
            Log.w(TAG, "YOLO inference returned null")
            return null
        }
        if (detections.isEmpty()) {
            Log.i(TAG, "YOLO produced 0 detections")
            return null
        }

        // 2. ML Kit text recognition on the FULL-RESOLUTION rectified bitmap
        //    so character glyphs render at undistorted scale. OCR observation
        //    bboxes come back in ocrBitmap (1280×806) space and we scale them
        //    DOWN to YOLO (640×640) space for IoU matching.
        val visionResult = Tasks.await(
            textRecognizer.process(InputImage.fromBitmap(ocrBitmap, 0)),
            5L,
            java.util.concurrent.TimeUnit.SECONDS
        )
        val observations = mutableListOf<OcrObservation>()
        var nextLineId = 0
        // Scale OCR bboxes from ocrBitmap (1280×806) space INTO YOLO
        // (640×640) space so IoU matching against runYolo's detections
        // works without further bookkeeping downstream. Identity scale
        // when corners==null (no doc-seg → ocrBitmap is the raw frame and
        // runYolo's own letterbox handles the geometry).
        //
        // Important: all OcrObservation bboxes need to be in the same space.
        // Cluster + AAMVA-split helpers operate on raw ML Kit element bboxes
        // (1280×806 space), so we scale at the FINAL observation construction
        // step — after clusterLineByElementHeight and splitObservationByAamvaIndices
        // have both produced their bboxes in raw space.
        fun toYoloSpace(r: RectF): RectF = if (corners != null) {
            RectF(r.left * ocrToYoloScaleX, r.top * ocrToYoloScaleY,
                  r.right * ocrToYoloScaleX, r.bottom * ocrToYoloScaleY)
        } else r
        for (block in visionResult.textBlocks) {
            for (line in block.lines) {
                val box = line.boundingBox ?: continue
                val lineBbox = RectF(box)  // raw ML Kit space
                val lineId = nextLineId++
                // Cluster line.elements by glyph height before AAMVA-index
                // splitting. ML Kit returns "D440-1234-5678-99 9 CLASS D"
                // (license # row on user's WI license) as ONE line, but
                // the value characters are 2-3× taller than the small
                // AAMVA-index "9" and label "CLASS". MLKit doesn't expose
                // font metadata, but the per-element bbox heights encode
                // it directly. Splitting by height-cluster prevents the
                // tail-end "9 CLASS D" (which OCRs noisily as e.g. "scussD"
                // when fused with the value) from leaking into the
                // license # value. Each emergent cluster becomes its own
                // OcrObservation tagged with sourceLineIndex so the
                // demographic parser can do a bounded lookahead across
                // adjacent clusters from the same source line (review
                // round-7 — handles "9 CLASS" + "D" → vehicle class "D").
                val clusters = clusterLineByElementHeight(line, lineBbox, lineId)
                for (clusterObs in clusters) {
                    for ((subText, subBbox) in splitObservationByAamvaIndices(clusterObs.text, clusterObs.bbox)) {
                        // Scale the bbox into YOLO space here — clusterObs and
                        // subBbox are both in raw ML Kit (ocrBitmap) space.
                        observations.add(
                            OcrObservation(
                                text = subText,
                                bbox = toYoloSpace(subBbox),
                                sourceLineIndex = clusterObs.sourceLineIndex,
                                indexWithinSourceLine = clusterObs.indexWithinSourceLine,
                            )
                        )
                    }
                }
            }
        }
        if (observations.isEmpty()) {
            Log.i(TAG, "ML Kit produced 0 observations")
            return null
        }

        // 3a. Demographic text-pool parse — scan observations for AAMVA-D-20
        //     tokens with strict four-gate matching (round-4 design):
        //     (a) canonical index in {9,15,16,17,18,19}
        //     (b) label compatible with that index
        //     (c) value in expected domain
        //     (d) unique candidate across the pool (>=2 = drop)
        //     This BYPASSES YOLO bbox matching for the sex/hgt/wgt/eye/hair/
        //     class fields, which works around the under-trained-jurisdiction
        //     bbox geometric mismatch (e.g. list_16 hitting the eye/hair row
        //     on WI). Fields the parser locks in here override anything the
        //     bbox matcher returns for the same yolo class.
        val demographicCandidates = parseAamvaDemographicFields(observations)

        // 3b. IoU-match observations → typed FieldCandidates (BboxIoU source).
        val bboxCandidates = matchObservationsToFields(observations, detections)

        // v2 Sequence G (task #54) — concat instead of map-overlay. The C++
        // resolver buckets by (FieldId, FieldSource), so multi-source
        // candidates for the same field are PRESERVED — that's the input
        // to the StrictAgrees → CrossValidated tier upgrade. Do NOT
        // deduplicate here.
        val frameCandidates: List<FieldCandidate> = bboxCandidates + demographicCandidates

        // 4a. Structured path — accumulate this frame's candidates into the
        //     per-instance multi-frame voter, then run C++ extract on the
        //     current cross-frame CONSENSUS rather than this single frame.
        //     ML Kit's frame-to-frame OCR variance ("JOHN QUINCY" vs
        //     "JOHN QUINCYY", "1 DOEFORD" vs "DOEFORD" vs "1DOEFORD") was
        //     defeating the previous first-wins lock; majority across a
        //     bounded history converges on the most-recurrent reading per
        //     field. round-8 design (task #33).
        if (frameCandidates.isNotEmpty()) {
            voter.accept(frameCandidates)
            val consensus = voter.consensus()
            // Progress by stabilized field count (review consensus)
            val totalExpected = 14.0 // core AAMVA fields
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
                _pipelineStage = 1.0 // extracting fields
                @Suppress("UNCHECKED_CAST")
                val r = nativeExtractFieldsCandidates(
                    fieldIds, sources, texts as Array<String>)
                _pipelineStage = 2.0 // normalizing (C++ already normalized)
                maybeFlushTelemetry()

                // Capture card image + headshot ONCE per scan session.
                if (r != null && !cardCapturedThisSession) {
                    cardCapturedThisSession = true
                    _pipelineStage = 3.0 // saving card
                    val cardPath = saveRectifiedCard(bitmap, corners)
                    _pipelineStage = 4.0 // detecting face
                    val headshotPath = extractHeadshot(ocrBitmap, detections, cardPath)
                    _pipelineStage = 5.0 // done
                    return r.copy(
                        cardImagePath = cardPath,
                        headshotImagePath = headshotPath
                    )
                }
                return r
            }
        }

        // 4b. AAMVA fallback — YOLO under-detected (common on jurisdictions
        //     under-represented in training data). The OCR observations on
        //     a rectified card always carry AAMVA D-20 field indices
        //     ("1 DOEFORD", "2 JOHN QUINC", "4d D440-1234-...", "8 2119
        //     ASHWOOD", ...). nativeExtractOcrFields() parses those
        //     index tokens directly without needing YOLO bboxes. Better to
        //     return SOME fields than fail the whole frame.
        val nowDbg = System.currentTimeMillis()
        if (nowDbg - lastBboxLog > 2000L) {
            lastBboxLog = nowDbg
            val sb = StringBuilder()
            sb.append("DEBUG YOLO ").append(detections.size).append(": ")
            for (d in detections.take(8)) {
                sb.append(d.name).append("@(")
                    .append(d.bbox.left.toInt()).append(",")
                    .append(d.bbox.top.toInt()).append("..")
                    .append(d.bbox.right.toInt()).append(",")
                    .append(d.bbox.bottom.toInt()).append(") ")
            }
            Log.i(TAG, sb.toString())
            // OCR-text-emitting debug log removed before public release
            // (would emit fragments of license fields to logcat).
        }
        Log.i(TAG, "no YOLO bbox matches — falling back to AAMVA index parser")
        // The C++ legacy extract_ocr_fields path expects LABEL-style lines
        // ("LN DOEFORD", "DL D1234567"), not the AAMVA-index form MLKit pulls
        // off a real US licence ("1 DOEFORD", "4d D440-..."). Until the C++
        // path learns the AAMVA-index grammar (task #26), pass the lines
        // through verbatim — extract_ocr_fields will partial-match what it
        // can (city/state/zip regex is layout-agnostic) and return nullopt
        // for fields it can't see. That's still better than the v1 path
        // which returned null on any YOLO underdetection.
        val lines = observations.map { it.text }.toTypedArray()
        val r = nativeExtractOcrFields(lines)
        maybeFlushTelemetry()
        return r
    }

    /**
     * Run TFLite YOLOv8n inference + C++ NMS, returning detections in the
     * ORIGINAL bitmap's pixel space (post-letterbox-reversal).
     *
     * The bundled model is **full-integer quantized** (int8 input AND int8
     * output). Buffer types must match the model's tensor dtypes, otherwise
     * Interpreter.run() throws on byte-size mismatch. Output int8 values are
     * dequantized manually via the output tensor's QuantizationParams
     * (TensorBuffer.floatArray would return raw byte values cast to float,
     * NOT the dequantized values — that path was caught in review).
     */
    private fun runYolo(bitmap: Bitmap): List<Detection>? {
        val interpreter = ensureTfliteInterpreter() ?: return null

        // DEBUG: dump the FIRST bitmap to the app's external files dir so
        // we can adb-pull the actual JPEG and inspect what YOLO is being fed.
        // External files dir doesn't require runtime permission.
        // PII gate (task #47): only on debug builds — release builds must
        // never persist DL imagery to disk.
        if (BuildConfig.DEBUG && !yoloDebugDumped) {
            yoloDebugDumped = true
            try {
                val ctx = com.dlscan.DlScanPackage.appContext
                val dir = ctx?.getExternalFilesDir(null)
                if (dir != null) {
                    val f = java.io.File(dir, "dlscan-yolo-input.jpg")
                    java.io.FileOutputStream(f).use { os ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, os)
                    }
                    Log.i(TAG, "DEBUG: wrote YOLO input " + bitmap.width + "x" + bitmap.height
                        + " to " + f.absolutePath + " (" + f.length() + " bytes)")
                } else {
                    Log.w(TAG, "DEBUG bitmap dump skipped: no external files dir")
                }
            } catch (t: Throwable) {
                Log.w(TAG, "DEBUG bitmap dump failed", t)
            }
        }

        // Letterbox-resize first; matches the iOS .scaleFit path.
        val (canvas, scale, padX, padY) = letterbox(bitmap, YOLO_INPUT_SIZE)

        // DEBUG: dump the letterboxed canvas (literally what goes through
        // the model) once. Lets us see if scaling/aspect-ratio is wrong.
        // PII gate (task #47): debug builds only.
        if (BuildConfig.DEBUG && !yoloCanvasDumped) {
            yoloCanvasDumped = true
            try {
                val ctx = com.dlscan.DlScanPackage.appContext
                val dir = ctx?.getExternalFilesDir(null)
                if (dir != null) {
                    val f = java.io.File(dir, "dlscan-yolo-canvas.png")
                    java.io.FileOutputStream(f).use { os ->
                        canvas.compress(Bitmap.CompressFormat.PNG, 100, os)
                    }
                    Log.i(TAG, "DEBUG: wrote YOLO canvas to " + f.absolutePath
                        + " (" + canvas.width + "x" + canvas.height + ")")
                }
            } catch (t: Throwable) {
                Log.w(TAG, "DEBUG canvas dump failed", t)
            }
        }

        // Read tensor types from the bound model so we don't hardcode.
        val inputTensor = interpreter.getInputTensor(0)
        val outputTensor = interpreter.getOutputTensor(0)
        val inputType = inputTensor.dataType()
        val outputType = outputTensor.dataType()

        // Build input ByteBuffer manually with explicit quantization.
        // Read bitmap pixels (uint8 ARGB) and apply the model's input
        // quantization formula:  q = round(value / scale + zeroPoint).
        // For a typical YOLOv8 int8 export (scale=1/255, zeroPoint=-128),
        // this reduces to (uint - 128). Generic form below also handles
        // UINT8 inputs (scale=1/255, zeroPoint=0).
        val inputBuffer = ByteBuffer.allocateDirect(inputTensor.numBytes())
            .order(ByteOrder.nativeOrder())
        run {
            val n = YOLO_INPUT_SIZE
            val pixels = IntArray(n * n)
            canvas.getPixels(pixels, 0, n, 0, 0, n, n)
            when (inputType) {
                DataType.INT8, DataType.UINT8 -> {
                    val qp = inputTensor.quantizationParams()
                    val zero = qp.zeroPoint
                    val scale = qp.scale
                    // float = pixel / 255 (channel value in [0, 1])
                    // q     = round(float / scale + zero)
                    // For scale=1/255: q = round(pixel - 0) + zero = pixel + zero
                    for (px in pixels) {
                        val r = (px shr 16) and 0xFF
                        val g = (px shr 8) and 0xFF
                        val b = px and 0xFF
                        val qr = ((r.toFloat() / 255f) / scale + zero).toInt()
                            .coerceIn(-128, 127)
                        val qg = ((g.toFloat() / 255f) / scale + zero).toInt()
                            .coerceIn(-128, 127)
                        val qb = ((b.toFloat() / 255f) / scale + zero).toInt()
                            .coerceIn(-128, 127)
                        inputBuffer.put(qr.toByte())
                        inputBuffer.put(qg.toByte())
                        inputBuffer.put(qb.toByte())
                    }
                }
                DataType.FLOAT32 -> {
                    // FP32 input: just normalize to [0, 1].
                    val fb = inputBuffer.asFloatBuffer()
                    for (px in pixels) {
                        val r = ((px shr 16) and 0xFF).toFloat() / 255f
                        val g = ((px shr 8) and 0xFF).toFloat() / 255f
                        val b = (px and 0xFF).toFloat() / 255f
                        fb.put(r); fb.put(g); fb.put(b)
                    }
                }
                else -> {
                    Log.e(TAG, "unsupported input dtype: $inputType")
                    return null
                }
            }
            inputBuffer.rewind()
        }

        // Output: allocate exactly numBytes() for the model's output tensor.
        val outputBuffer = ByteBuffer.allocateDirect(outputTensor.numBytes())
            .order(ByteOrder.nativeOrder())

        try {
            interpreter.run(inputBuffer, outputBuffer.rewind())
        } catch (t: Throwable) {
            Log.e(TAG, "TFLite Interpreter.run threw", t)
            return null
        }

        // Dequantize int8 output → float32 using the tensor's quantization
        // params. ByteBuffer is signed; for INT8 we keep the sign, for UINT8
        // we mask to 0..255.
        val numFloats = outputTensor.shape().fold(1) { acc, dim -> acc * dim }
        val rawOutput = FloatArray(numFloats)
        outputBuffer.rewind()
        when (outputType) {
            DataType.FLOAT32 -> {
                outputBuffer.asFloatBuffer().get(rawOutput)
            }
            DataType.INT8, DataType.UINT8 -> {
                val qp = outputTensor.quantizationParams()
                val out = ByteArray(numFloats)
                outputBuffer.get(out)
                val zero = qp.zeroPoint
                val s = qp.scale
                if (outputType == DataType.UINT8) {
                    for (i in 0 until numFloats) {
                        rawOutput[i] = ((out[i].toInt() and 0xFF) - zero) * s
                    }
                } else {
                    for (i in 0 until numFloats) {
                        rawOutput[i] = (out[i].toInt() - zero) * s
                    }
                }
            }
            else -> {
                Log.e(TAG, "unsupported output dtype: $outputType")
                return null
            }
        }
        // The int8 TFLite export quantized bbox outputs into [0, 1] (the
        // training fraction=0.05 calibration capped scale=0.00419, zero=-111
        // → max ≈ 0.997). C++ NMS expects bbox values in pixel space
        // [0, YOLO_INPUT_SIZE]. Scale the bbox channels (rows 0..3 in the
        // ChannelMajor [34, 8400] layout) up to pixel space here. Class
        // channels (rows 4..33) are already in [0, 1] confidence space and
        // need no rescaling. iOS doesn't need this because its CoreML FP32
        // path doesn't go through the same quantization range.
        if (outputType == DataType.INT8 || outputType == DataType.UINT8) {
            val pixelScale = YOLO_INPUT_SIZE.toFloat()
            val bboxEnd = 4 * YOLO_NUM_ANCHORS
            for (i in 0 until bboxEnd) {
                rawOutput[i] *= pixelScale
            }
        }

        // DEBUG: log the raw output's max score so we can confirm whether
        // the model is actually firing on this input or quantizing to zero.
        val nowDbg = System.currentTimeMillis()
        if (nowDbg - lastMaxScoreLog > 1000L) {
            lastMaxScoreLog = nowDbg
            var maxRaw = Float.NEGATIVE_INFINITY
            val classRowStart = 4 * YOLO_NUM_ANCHORS
            val classRowEnd = (4 + YOLO_NUM_CLASSES) * YOLO_NUM_ANCHORS
            for (i in classRowStart until classRowEnd) {
                if (rawOutput[i] > maxRaw) maxRaw = rawOutput[i]
            }
            Log.i(TAG, "DEBUG: maxRaw class score = " + maxRaw)
        }

        val flat = nativeDecodeAndNms(
            rawOutput,
            YOLO_NUM_CLASSES,
            YOLO_NUM_ANCHORS,
            /*layout=*/ 0,           // 0 = ChannelMajor
            CONF_THRESHOLD,
            IOU_THRESHOLD,
            MAX_DETECTIONS
        )
        if (flat.isEmpty()) return emptyList()

        // Reverse-letterbox: model coords → original-bitmap coords.
        val out = mutableListOf<Detection>()
        var i = 0
        while (i + 5 < flat.size) {
            val classId = flat[i].toInt()
            val conf = flat[i + 1]
            val mx1 = flat[i + 2]
            val my1 = flat[i + 3]
            val mx2 = flat[i + 4]
            val my2 = flat[i + 5]
            val x1 = (mx1 - padX) / scale
            val y1 = (my1 - padY) / scale
            val x2 = (mx2 - padX) / scale
            val y2 = (my2 - padY) / scale
            val name = nativeClassName(classId)
            if (name.isNotEmpty()) {
                out.add(Detection(name, RectF(x1, y1, x2, y2), conf))
            }
            i += 6
        }
        return out
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
                val nowDbg = System.currentTimeMillis()
                if (nowDbg - lastDocSegLog > 2000L) {
                    lastDocSegLog = nowDbg
                    Log.i(TAG, "DEBUG: DocAligner channel $ch had no signal (maxHmap=" + maxHmap + ") — skipping frame")
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
                    Log.i(TAG, "DEBUG: DocAligner rejected degenerate quad (corners $i,$j too close)")
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
        val ctx = com.dlscan.DlScanPackage.appContext
            ?: throw IllegalStateException("DlScanPackage.appContext is null")
        val dir = java.io.File(ctx.filesDir, "dlscan-cards")
        dir.mkdirs()
        dir
    }

    private fun saveRectifiedCard(
        sourceFrame: Bitmap,
        corners: FloatArray
    ): String? {
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
            if (cardBitmap !== sourceFrame) cardBitmap.recycle()
            "file://${file.absolutePath}"
        } catch (t: Throwable) {
            Log.w(TAG, "saveRectifiedCard failed", t)
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
                val ctx = com.dlscan.DlScanPackage.appContext
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
     * Lazy-init the DocAligner TFLite Interpreter. Same pattern as
     * ensureTfliteInterpreter — returns null on missing asset or load
     * failure, doesn't latch the failure permanently if the package
     * context is just not ready yet.
     */
    private fun ensureDocAlignerInterpreter(): Interpreter? {
        docAlignerLock.withLock {
            docAlignerInterpreter?.let { return it }
            if (docAlignerLoadAttempted) return null
            docAlignerLoadAttempted = true

            val context = com.dlscan.DlScanPackage.appContext ?: run {
                Log.e(TAG, "DlScanPackage.appContext is null; package not yet booted?")
                docAlignerLoadAttempted = false
                return null
            }
            return try {
                val modelBuffer = loadModelFile(context, "docaligner_lcnet100.tflite")
                val interpreter = Interpreter(modelBuffer, Interpreter.Options())
                docAlignerInterpreter = interpreter
                Log.i(TAG, "DocAligner TFLite loaded (" + modelBuffer.capacity() + " bytes)")
                interpreter
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to load DocAligner TFLite", t)
                null
            }
        }
    }

    /**
     * Lazy-init the TFLite Interpreter. Returns null if the asset isn't
     * present or the load fails — pipeline degrades to "no result" rather
     * than throwing.
     */
    private fun ensureTfliteInterpreter(): Interpreter? {
        tfliteLock.withLock {
            tfliteInterpreter?.let { return it }
            if (tfliteLoadAttempted) return null
            tfliteLoadAttempted = true

            val context = com.dlscan.DlScanPackage.appContext ?: run {
                Log.e(TAG, "DlScanPackage.appContext is null; package not yet booted?")
                // Don't latch tfliteLoadAttempted permanently — context may
                // arrive on a later frame if the package's hooks fire late.
                tfliteLoadAttempted = false
                return null
            }
            return try {
                val modelBuffer = loadModelFile(context, "dl_scan_field_detector.tflite")
                val interpreter = Interpreter(modelBuffer, Interpreter.Options())
                tfliteInterpreter = interpreter
                interpreter
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to load DlScanFieldDetector TFLite", t)
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
    // Bbox-matching algorithm (mirrors HybridDlScanIOS.matchObservationsToFields).
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
     * for AAMVA D-20 tokens covering the sex/height/weight/eye/hair/class
     * fields and returns a map of (yolo-class → value) assignments that
     * bypass YOLO bbox matching for those classes.
     *
     * Four-gate strict matching (round-4 design, 2026-05-10):
     *   (a) canonical index ∈ {9, 15, 16, 17, 18, 19}
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
    private fun parseAamvaDemographicFields(
        observations: List<OcrObservation>
    ): List<FieldCandidate> {
        // Map AAMVA index → typed FieldId (v2 Sequence G — task #54).
        // Replaces the v1 "<base>_strict" string-suffix wire format; the
        // strict provenance now lives in FieldSource.StrictTextPool. The
        // C++ extractor still applies the StrictAgrees → CrossValidated
        // (1.00) upgrade when both StrictTextPool and BboxIoU candidates
        // converge on the same field (round-2 lock).
        val indexToFieldId = mapOf(
            "3"  to 3,    // FieldId::List3   (DOB)
            "4a" to 41,   // FieldId::List4a  (issue date)
            "4b" to 42,   // FieldId::List4b  (expiration date)
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
                // observation (e.g. WI: "16 HGT 5'-04 17 WGT 160 lb"
                // reads as one line; "3 DOB 08/12/1980 ea ENb NONE"
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
        val logIoU = nowDbg - lastBboxLog > 2000L
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
    // resetLicenseFieldRecognition — invalidate cache + in-flight job.
    // -------------------------------------------------------------------------

    override fun resetLicenseFieldRecognition() {
        ocrLock.withLock {
            ocrGeneration += 1L
            cachedOcrResult = null
            lastOcrTime = 0L
            cardCapturedThisSession = false
            _scanProgress = 0.0
            _pipelineStage = 0.0
            _detectedCardCorners = doubleArrayOf()
            // Reset the dedupe marker so the next scan's first fresh
            // result is returned to JS (otherwise the previous read marker
            // would compare to a generation that hasn't happened yet —
            // and the lazy-equality would miss).
            lastReadOcrResultGeneration = -1L
        }
        // Clear the per-instance multi-frame voter so the next scan
        // starts with a fresh history. Without this, votes from a
        // previous card would influence the new scan's consensus.
        voter.reset()
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun variantOf(spec: LicenseDataSpec?): Variant_NullType_LicenseDataSpec =
        if (spec != null) {
            Variant_NullType_LicenseDataSpec.create(spec)
        } else {
            Variant_NullType_LicenseDataSpec.create(NullType.NULL)
        }

    // -------------------------------------------------------------------------
    // Library loading + companion constants.
    // -------------------------------------------------------------------------

    companion object {
        private const val TAG = "DlScanAndroid"

        /**
         * Per-AAMVA-index value pre-extractor. OCR commonly concatenates
         * adjacent fields onto one observation (WI: "16 HGT 5'-04 17 WGT
         * 160 lb" or "3 DOB 08/12/1980 EnB NONE"); the lexer's value
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
                    // Height — find first 5'-04" / 5'04" / 5-04 / \d{3}
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

        @Volatile private var yoloDebugDumped = false
        @Volatile private var rotationDebugLogged = false
        @Volatile private var yoloCanvasDumped = false
        @Volatile private var lastMaxScoreLog: Long = 0L
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
         * matched to `list_X` starts with a token whose canonicalized form
         * equals `expectedAamvaIndex[list_X]`, the prefix is stripped before
         * the value lands in the field map. Class-aware so a "12 MAIN ST"
         * address line matched to a non-AAMVA class can NEVER lose its "12".
         * 19 entries — stable across AAMVA spec v1-11; derived directly from
         * the YOLO class name (strip "list_" prefix). No per-state data.
         */
        private val expectedAamvaIndex: Map<String, String> = mapOf(
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
         * Strip the AAMVA index prefix from an observation's text iff the
         * matched YOLO class is in the AAMVA-indexed set AND the leading
         * lexer-recognized token canonicalizes to that class's expected
         * index. Otherwise returns the original text unchanged (protects
         * address lines like "12 MAIN ST" matched to non-AAMVA classes from
         * being stripped). Now defers to [AamvaLexer.findAamvaToken] for
         * recognition — handles whitespace-separated AND fused forms
         * (round 4, 2026-05-10).
         */
        /**
         * YOLO classes whose values should be DROPPED (returned as empty)
         * when the leading AAMVA-token index disagrees with the class's
         * expectedAamvaIndex. These are the demographic/appearance fields
         * where wrong-row bbox matches produce confusing wrong values
         * (e.g. Height = "18 EYES BRO"). Non-demographic classes like
         * list_1 (last name) keep the legacy "return unchanged" behavior
         * so legitimate cases like "12 MAIN ST" accidentally matched to
         * list_8s aren't erased. round-5 review fix (2026-05-10).
         */
        private val dropOnIndexMismatch: Set<String> = setOf(
            "list_9", "list_15", "list_16", "list_17", "list_18", "list_19"
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
            val expected = expectedAamvaIndex[yoloClass]
                ?: return StripResult(text, null)
            val token = AamvaLexer.findAamvaToken(text)
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
         * address row AND drop the inter-token space, producing "12119"
         * instead of "8 2119". Rectifying to a wider canvas at the true
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
            // libDlScan.so is loadable. Swallow UnsatisfiedLinkError so
            // companion-object static-init completes; instance methods
            // that need JNI (parseBarcodeData, recognizeLicenseFields,
            // etc.) will hit the JNI bridge at first call and crash
            // there if the library actually failed to load on a real
            // device. The platform-layer regex helpers don't need JNI.
            try {
                System.loadLibrary("DlScan")
            } catch (e: UnsatisfiedLinkError) {
                Log.w(TAG, "libDlScan.so not loadable (expected on JVM unit-test runner): " + e.message)
            }
        }
    }
}
