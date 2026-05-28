package com.dlscan

import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.margelo.nitro.dlscan.HybridDlScanAndroid
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.PrintWriter

/**
 * IDNet batch-eval test. Runs the production single-frame Android pipeline
 * (`HybridDlScanAndroid.ocrPipelineForEval`) against every .jpg / .png in
 * the test app's external files dir under `idnet/`, dumps per-image
 * per-yolo-class results to `results.tsv` in the same dir.
 *
 * Caller workflow (driven by tools/dlscan-debug-cli/android-eval.sh):
 *
 *   1. (cd example/android && ./gradlew :app:installDebugAndroidTest)
 *   2. adb push <state-samples>/...jpg \
 *        /sdcard/Android/data/com.iotashan.dlscanexample/files/idnet/
 *   3. adb shell am instrument -w -e class com.dlscan.IdnetBatchEvalTest \
 *        com.iotashan.dlscanexample.test/androidx.test.runner.AndroidJUnitRunner
 *   4. adb pull /sdcard/Android/data/com.iotashan.dlscanexample/files/results.tsv
 *
 * Results TSV format: one row per (image, yolo-class):
 *   <image-name>\t<yolo-class>\t<extracted-text>
 *
 * Eval comparison against ground-truth JSON is done host-side by the
 * Python harness `tools/dlscan-debug-cli/eval.py --android <results.tsv>`.
 */
@RunWith(AndroidJUnit4::class)
class IdnetBatchEvalTest {

    private val instance = HybridDlScanAndroid()

    @Test
    fun batchEval_runsPipelineOnEveryImage_writesTsv() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        // The library reads DlScanPackage.appContext to resolve assets;
        // RN bootstrapping normally sets this via createViewManagers/getModule.
        // The instrumented test doesn't boot RN, so set it manually now.
        com.dlscan.DlScanPackage.setAppContextForTesting(ctx.applicationContext)
        val filesDir = ctx.getExternalFilesDir(null)
            ?: error("No external files dir for test app")
        val inputDir = File(filesDir, "idnet")
        if (!inputDir.isDirectory) {
            // No samples pushed — produce an empty results file so the
            // host-side pipeline still has something to consume rather
            // than failing with "no such file".
            File(filesDir, "results.tsv").writeText("")
            println("BATCHEVAL: no input dir at $inputDir — wrote empty results.tsv")
            return
        }
        val samples = inputDir.listFiles { f ->
            f.isFile && (f.name.endsWith(".jpg", ignoreCase = true)
                || f.name.endsWith(".jpeg", ignoreCase = true)
                || f.name.endsWith(".png", ignoreCase = true))
        }?.sortedBy { it.name } ?: emptyList()
        println("BATCHEVAL: $inputDir has ${samples.size} sample(s)")

        val outFile = File(filesDir, "results.tsv")
        outFile.printWriter().use { pw ->
            for ((i, img) in samples.withIndex()) {
                val name = img.name
                val bitmap = BitmapFactory.decodeFile(img.absolutePath)
                if (bitmap == null) {
                    println("BATCHEVAL: [$i/${samples.size}] $name — decode FAILED")
                    pw.println("$name\tERROR\tdecode-failed")
                    continue
                }
                val t0 = System.currentTimeMillis()
                val fields = try {
                    instance.ocrPipelineForEval(bitmap)
                } catch (t: Throwable) {
                    println("BATCHEVAL: [$i/${samples.size}] $name — pipeline THREW: $t")
                    pw.println("$name\tERROR\tpipeline-threw:${t.javaClass.simpleName}")
                    bitmap.recycle()
                    continue
                }
                val ms = System.currentTimeMillis() - t0
                if (fields.isEmpty()) {
                    pw.println("$name\tEMPTY\t")
                } else {
                    for ((yoloClass, text) in fields) {
                        // Newline / tab escape so the TSV stays parseable.
                        val esc = text
                            .replace("\\", "\\\\")
                            .replace("\t", "\\t")
                            .replace("\n", "\\n")
                        pw.println("$name\t$yoloClass\t$esc")
                    }
                }
                if (i % 20 == 0) {
                    println("BATCHEVAL: [$i/${samples.size}] $name — ${fields.size} fields in ${ms}ms")
                }
                bitmap.recycle()
            }
        }
        println("BATCHEVAL: wrote ${outFile.length()} bytes → $outFile")
    }

    /**
     * Iter 7 D-lite probe (Android port of iOS `runVisionKitPerRegion`).
     * Runs the per-YOLO-bbox MLKit pipeline via
     * [HybridDlScanAndroid.ocrPipelineRegionForEval] on the same image set
     * the production test above used. Writes a parallel `results-region.tsv`
     * so the host-side report can render PROD vs REGION side-by-side.
     *
     * Identical I/O scaffold to [batchEval_runsPipelineOnEveryImage_writesTsv]
     * — both tests are invoked one after the other by android-eval.sh, with
     * the test app's external files dir already containing the pushed
     * images from the production run.
     */
    @Test
    fun batchEval_region_runsPipelineOnEveryImage_writesTsv() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        com.dlscan.DlScanPackage.setAppContextForTesting(ctx.applicationContext)
        val filesDir = ctx.getExternalFilesDir(null)
            ?: error("No external files dir for test app")
        val inputDir = File(filesDir, "idnet")
        if (!inputDir.isDirectory) {
            File(filesDir, "results-region.tsv").writeText("")
            println("BATCHEVAL_REGION: no input dir at $inputDir — wrote empty results-region.tsv")
            return
        }
        val samples = inputDir.listFiles { f ->
            f.isFile && (f.name.endsWith(".jpg", ignoreCase = true)
                || f.name.endsWith(".jpeg", ignoreCase = true)
                || f.name.endsWith(".png", ignoreCase = true))
        }?.sortedBy { it.name } ?: emptyList()
        println("BATCHEVAL_REGION: $inputDir has ${samples.size} sample(s)")

        val outFile = File(filesDir, "results-region.tsv")
        var totalRegionMs = 0L
        outFile.printWriter().use { pw ->
            for ((i, img) in samples.withIndex()) {
                val name = img.name
                val bitmap = BitmapFactory.decodeFile(img.absolutePath)
                if (bitmap == null) {
                    println("BATCHEVAL_REGION: [$i/${samples.size}] $name — decode FAILED")
                    pw.println("$name\tERROR\tdecode-failed")
                    continue
                }
                val t0 = System.currentTimeMillis()
                val fields = try {
                    instance.ocrPipelineRegionForEval(bitmap)
                } catch (t: Throwable) {
                    println("BATCHEVAL_REGION: [$i/${samples.size}] $name — pipeline THREW: $t")
                    pw.println("$name\tERROR\tpipeline-threw:${t.javaClass.simpleName}")
                    bitmap.recycle()
                    continue
                }
                val ms = System.currentTimeMillis() - t0
                totalRegionMs += ms
                if (fields.isEmpty()) {
                    pw.println("$name\tEMPTY\t")
                } else {
                    for ((yoloClass, text) in fields) {
                        val esc = text
                            .replace("\\", "\\\\")
                            .replace("\t", "\\t")
                            .replace("\n", "\\n")
                        pw.println("$name\t$yoloClass\t$esc")
                    }
                }
                if (i % 20 == 0) {
                    println("BATCHEVAL_REGION: [$i/${samples.size}] $name — ${fields.size} fields in ${ms}ms")
                }
                bitmap.recycle()
            }
        }
        println("BATCHEVAL_REGION: wrote ${outFile.length()} bytes → $outFile " +
                "(total region pipeline wall-clock: ${totalRegionMs}ms across ${samples.size} images)")
    }
}
