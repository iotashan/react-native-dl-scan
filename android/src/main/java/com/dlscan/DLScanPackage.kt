package com.dlscan

import android.content.Context
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.dlscan.DLScanOnLoad

class DLScanPackage : BaseReactPackage() {

  init {
    // Constructor-level init: PackageList.getPackages() does `new DLScanPackage()`,
    // which runs this block synchronously at autolinking time. The Kotlin
    // companion-object `init { }` we used previously is only triggered when
    // the companion class is first referenced — which never happened in a
    // bridgeless React Native app, so the Nitro hybrid never got registered.
    // Mirrors NitroImagePackage.java's `static { }` block (Java) using the
    // closest Kotlin equivalent.
    ensureNativeLoaded()
  }

  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? {
    appContext = reactContext.applicationContext
    return null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<in Nothing, in Nothing>> {
    appContext = reactContext.applicationContext
    return emptyList()
  }

  companion object {
    /**
     * Captured at package boot. Read by HybridDLScanAndroid to locate the
     * bundled DLScanFieldDetector.tflite under `assets/`. Volatile because
     * one thread (RN bootstrapping) writes it and another (the OCR worker
     * thread) reads it. Null until the package's getModule or
     * createViewManagers has fired at least once.
     */
    @Volatile
    var appContext: Context? = null
      private set

    @Volatile
    private var nativeLoaded = false

    @JvmStatic
    @Synchronized
    fun ensureNativeLoaded() {
      if (nativeLoaded) return
      DLScanOnLoad.initializeNative()
      nativeLoaded = true
    }

    /**
     * Test-only setter for the captured appContext. Production code paths
     * always populate this via [getModule] / [createViewManagers] during
     * RN bridge bootstrapping. Instrumented tests that exercise the
     * library outside an RN context (e.g. the IDNet batch eval) must
     * call this manually before invoking the OCR pipeline so asset
     * loaders (TFLite models, doc-aligner) can resolve via the host
     * app's Context.
     */
    @androidx.annotation.VisibleForTesting
    @JvmStatic
    fun setAppContextForTesting(ctx: Context) {
      appContext = ctx
    }
  }
}
