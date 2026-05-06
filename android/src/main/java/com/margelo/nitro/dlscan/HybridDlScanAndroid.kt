package com.margelo.nitro.dlscan

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.core.Promise

@DoNotStrip
@Keep
class HybridDlScanAndroid : HybridDlScanSpec() {

  override fun parseBarcodeData(barcodeData: String): Promise<Variant_NullType_LicenseDataSpec> {
    throw NotImplementedError(
      "parseBarcodeData not yet implemented. Lands in Task 8 of the migration."
    )
  }

  override fun recognizeLicenseFields(
    frame: HybridFrameSpec
  ): Variant_NullType_LicenseDataSpec {
    throw NotImplementedError(
      "recognizeLicenseFields not yet implemented. Lands in Task 8 of the migration."
    )
  }
}
