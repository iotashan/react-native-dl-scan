const path = require('path');

// Pin the local library's root for React Native / Expo autolinking.
//
// The example consumes react-native-dl-scan via `portal:..`, which under yarn 3
// + nodeLinker:node-modules leaves NO example/node_modules/react-native-dl-scan
// entry. Autolinking's recursive node_modules scan therefore never finds the
// library and SILENTLY drops the native DLScan module — no iOS pod, no Android
// DLScanPackage — so the app builds without the Nitro module and crashes on the
// first scan. (It previously only worked via a manual, uncommitted symlink.)
//
// Expo SDK 54 autolinking loads this app-root config and resolves
// `dependencies[*].root` BEFORE its recursive scan (see
// expo-modules-autolinking's rncliLocal/reactNativeConfig), so declaring the
// library's root here makes it reliably discoverable on BOTH platforms with no
// symlink. The library's own root react-native.config.js still provides the
// Android packageImportPath/packageInstance and the iOS podspec auto-detect.
//
// Metro JS resolution is handled separately by metro.config.js
// (resolver.extraNodeModules maps the import to the same root).
module.exports = {
  dependencies: {
    'react-native-dl-scan': {
      root: path.resolve(__dirname, '..'),
    },
  },
};
