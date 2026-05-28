// React Native autolinking metadata for consumers.
// Without this, the autolinking JSON entry for `react-native-dl-scan` is
// empty, and the consumer's generated `PackageList.java` does not include
// `DlScanPackage` — so Nitro never registers the `DlScan` HybridObject and
// `createHybridObject('DlScan')` throws on first call.
module.exports = {
  dependency: {
    platforms: {
      android: {
        // Hand-written package — both registers the Nitro hybrid (via its
        // companion-object DlScanOnLoad.initializeNative()) and captures
        // appContext for the OCR field detector to load .tflite from assets.
        packageImportPath: 'import com.dlscan.DlScanPackage;',
        packageInstance: 'new DlScanPackage()',
      },
      // iOS: omitting the key entirely lets RN autolinking auto-detect the
      // lib's DlScan.podspec at the package root. Setting `ios: null` here
      // would EXCLUDE iOS from autolinking, which means the DlScan pod
      // never installs and the +load symbol that registers the Nitro
      // hybrid never makes it into the consumer app's binary.
    },
  },
};
