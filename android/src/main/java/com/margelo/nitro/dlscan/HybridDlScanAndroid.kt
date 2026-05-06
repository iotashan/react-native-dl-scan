package com.margelo.nitro.dlscan

import androidx.annotation.Keep
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
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

@DoNotStrip
@Keep
class HybridDlScanAndroid : HybridDlScanSpec() {

    // -------------------------------------------------------------------------
    // JNI bridge: implemented in src/main/cpp/dlscan_jni_bridge.cpp,
    // compiled into libDlScan.so (loaded below in companion object).
    // -------------------------------------------------------------------------

    @DoNotStrip
    @Keep
    private external fun nativeParseBarcode(barcodeData: String): LicenseDataSpec?

    @DoNotStrip
    @Keep
    private external fun nativeExtractOcrFields(lines: Array<String>): LicenseDataSpec?

    // -------------------------------------------------------------------------
    // ML Kit text recognizer — created once, reused across frames.
    // TextRecognition.getClient is thread-safe per ML Kit documentation.
    // -------------------------------------------------------------------------

    private val textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    // -------------------------------------------------------------------------
    // OCR state — all reads/writes guarded by ocrLock.
    // -------------------------------------------------------------------------

    private val ocrLock = ReentrantLock()
    private var cachedOcrResult: LicenseDataSpec? = null
    private var ocrInFlight = false
    private var lastOcrTime: Long = 0L

    // -------------------------------------------------------------------------
    // parseBarcodeData — runs C++ AAMVA parser off the JS thread.
    // Uses Promise.parallel so Nitro handles thread management.
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
    // recognizeLicenseFields — called synchronously on a Camera worklet thread.
    //
    // Design:
    //   • Rate-limited to ~2 fps (500 ms minimum gap).
    //   • Dispatches an async ML Kit task on a background thread; returns the
    //     most recent cached result immediately so the worklet never blocks.
    //   • Uses Tasks.await on the background thread so the ML Kit callback
    //     arrives before we release ocrInFlight.
    // -------------------------------------------------------------------------

    @ExperimentalGetImage
    override fun recognizeLicenseFields(frame: HybridFrameSpec): Variant_NullType_LicenseDataSpec {
        val now = System.currentTimeMillis()

        // Snapshot + decide under lock — minimal critical section.
        val cached: LicenseDataSpec?
        val shouldStart: Boolean
        ocrLock.withLock {
            cached = cachedOcrResult
            val elapsed = now - lastOcrTime
            shouldStart = !ocrInFlight && elapsed >= 500L
        }

        if (!shouldStart) {
            return variantOf(cached)
        }

        // Extract the underlying android.media.Image from the VC Frame.
        // HybridFrame (the concrete VC v5 implementation) implements NativeFrame;
        // NativeFrame exposes `val image: ImageProxy`, and ImageProxy.image
        // is the underlying android.media.Image (requires @ExperimentalGetImage).
        val nativeFrame = frame as? NativeFrame
        val mediaImage = nativeFrame?.image?.image
        if (mediaImage == null) {
            // Could not unwrap — skip this frame without burning the rate limit.
            return variantOf(cached)
        }

        val rotationDegrees = nativeFrame.image.imageInfo.rotationDegrees
        val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

        // Commit: reserve the in-flight slot and record the start time.
        ocrLock.withLock {
            ocrInFlight = true
            lastOcrTime = now
        }

        // Run ML Kit + C++ OCR extraction on a separate thread so we never
        // block the Camera worklet.
        Promise.parallel {
            try {
                val visionResult = Tasks.await(
                    textRecognizer.process(inputImage),
                    5L,
                    java.util.concurrent.TimeUnit.SECONDS
                )
                val lines = visionResult.text
                    .split("\n")
                    .filter { it.isNotBlank() }
                    .toTypedArray()

                val spec = nativeExtractOcrFields(lines)
                ocrLock.withLock {
                    cachedOcrResult = spec
                }
            } catch (_: Throwable) {
                // Vision errors are swallowed; the cache retains its last good value
                // and the next frame will retry once the rate limit expires.
            } finally {
                ocrLock.withLock {
                    ocrInFlight = false
                }
            }
        }

        // Return the cached result (may be null on the very first frame).
        return variantOf(cached)
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
    // Library loading — must happen before any external fun is called.
    // -------------------------------------------------------------------------

    companion object {
        init {
            System.loadLibrary("DlScan")
        }
    }
}
