package com.dlscan

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.margelo.nitro.core.NullType
import com.margelo.nitro.dlscan.HybridDlScanAndroid
import com.margelo.nitro.dlscan.LicenseDataSpec
import com.margelo.nitro.dlscan.Sex
import com.margelo.nitro.dlscan.Variant_NullType_LicenseDataSpec
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class HybridDlScanAndroidTest {

    private val instance = HybridDlScanAndroid()

    // -------------------------------------------------------------------------
    // Helper: block on a Nitro Promise via CountDownLatch so we don't need
    // a full coroutine runtime in the test runner.
    // -------------------------------------------------------------------------

    private fun <T> awaitPromise(promise: com.margelo.nitro.core.Promise<T>): T {
        val latch = CountDownLatch(1)
        var result: T? = null
        var error: Throwable? = null
        promise.then { r ->
            result = r
            latch.countDown()
        }.catch { e ->
            error = e
            latch.countDown()
        }
        check(latch.await(10, TimeUnit.SECONDS)) { "Promise timed out after 10 s" }
        error?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    // -------------------------------------------------------------------------
    // parseBarcodeData — AAMVA v9 all-fields fixture
    // (mirrors cpp/tests/aamva_test.cpp::AAMVAModern.V9AllFields)
    // -------------------------------------------------------------------------

    @Test
    fun parseBarcodeData_aamvaV9_allFields() {
        val raw = "@\n\nANSI 636000090002DL00410278ZV03190008\n" +
                "DAQ123456789\nDCSSAMPLE\nDACJOHN\nDADMICHAEL\n" +
                "DBB08151990\nDBA12312028\nDBD01152023\n" +
                "DBC1\nDAYGRN\nDAU510\nDAG123 MAIN ST\n" +
                "DAIRICHMOND\nDAJVA\nDAK232200000\n" +
                "DCGUSA\nDCAA\nDCBNONE\nDCDNONE"

        val promise = instance.parseBarcodeData(raw)
        val variant = awaitPromise(promise)

        val spec: LicenseDataSpec = variant.asSecondOrNull()
            ?: error("Expected Second(LicenseDataSpec), got ${variant::class.simpleName}")

        assertEquals("JOHN",        spec.firstName)
        assertEquals("SAMPLE",      spec.lastName)
        assertEquals("MICHAEL",     spec.middleName)
        assertEquals("123456789",   spec.licenseNumber)
        assertEquals("1990-08-15",  spec.dateOfBirth)
        assertEquals("2028-12-31",  spec.expirationDate)
        assertEquals("2023-01-15",  spec.issueDate)
        assertEquals(Sex.M,         spec.sex)
        assertEquals("GRN",         spec.eyeColor)
        assertEquals("510",         spec.height)
        assertEquals("123 MAIN ST", spec.street)
        assertEquals("RICHMOND",    spec.city)
        assertEquals("VA",          spec.state)
        assertEquals("23220",       spec.postalCode)
        assertEquals("USA",         spec.country)
        assertEquals("A",           spec.vehicleClass)
        assertEquals("NONE",        spec.restrictions)
        assertEquals("NONE",        spec.endorsements)
        assertEquals(9.0,           spec.aamvaVersion)
    }

    // -------------------------------------------------------------------------
    // parseBarcodeData — AAMVA v1 fixture (yyyyMMdd dates, DAB/DAC names)
    // (mirrors cpp/tests/aamva_test.cpp::AAMVAV1.BasicFields)
    // -------------------------------------------------------------------------

    @Test
    fun parseBarcodeData_aamvaV1_basicFields() {
        val raw = "@\n\nANSI 636000010002DL\n" +
                "DAQ999888777\nDABJOHNSON\nDACROBERT\nDADMICHAEL\n" +
                "DBB19851220\nDBA20281231\nDBD20200115\n" +
                "DBC1\nDAYBRO\nDAU511\nDAG456 ELM STREET\n" +
                "DAISPRINGFiELD\nDAJIL\nDAK627040000\n" +
                "DCAB\nDCBNONE\nDCDNONE"

        val promise = instance.parseBarcodeData(raw)
        val variant = awaitPromise(promise)

        val spec: LicenseDataSpec = variant.asSecondOrNull()
            ?: error("Expected Second(LicenseDataSpec), got ${variant::class.simpleName}")

        assertEquals("JOHNSON",    spec.lastName)
        assertEquals("ROBERT",     spec.firstName)
        assertEquals("MICHAEL",    spec.middleName)
        assertEquals("999888777",  spec.licenseNumber)
        assertEquals("1985-12-20", spec.dateOfBirth)
        assertEquals("2028-12-31", spec.expirationDate)
        assertEquals("2020-01-15", spec.issueDate)
        assertEquals(Sex.M,        spec.sex)
        assertEquals(1.0,          spec.aamvaVersion)
    }

    // -------------------------------------------------------------------------
    // parseBarcodeData — invalid data returns NullType
    // -------------------------------------------------------------------------

    @Test
    fun parseBarcodeData_invalidData_returnsNull() {
        val raw = "this is not a valid AAMVA barcode"
        val promise = instance.parseBarcodeData(raw)
        val variant = awaitPromise(promise)

        // Should resolve to the NullType arm of the variant
        assertNotNull("Variant must not be null itself", variant)
        assertNull("Expected NullType variant (no license data)", variant.asSecondOrNull())
        assertNotNull("Expected First(NullType)", variant.asFirstOrNull())
    }
}
