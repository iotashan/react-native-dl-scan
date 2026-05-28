// Metro config for the example app — consumes the parent react-native-dl-scan
// package via portal:.. in package.json + a manual node_modules symlink.
//
// Critical: forces React, RN, and the Nitro/VC/worklets families to ALWAYS
// resolve to the example's node_modules. Without this, metro picks up the
// LIB's own node_modules copies (a real second physical copy), which
// produces "Invalid hook call: Cannot read property 'useState' of null"
// because each copy maintains its own hook dispatcher state. A simple
// extraNodeModules fallback isn't enough — metro can still walk up the
// directory tree from a lib file and find the lib's copies first. Custom
// resolveRequest is the only mechanism that actually overrides resolution.

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the lib so source edits trigger reloads.
config.watchFolders = [workspaceRoot];

// Singletons: imports of these packages must resolve to a single physical
// copy across the whole bundle. Aliased to the example's node_modules
// (or workspaceRoot for `react-native-dl-scan` itself, since that's where
// the lib lives).
const singletons = {
  'react-native-dl-scan': workspaceRoot,
  'react': path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-native-worklets': path.resolve(
    projectRoot,
    'node_modules/react-native-worklets'
  ),
  'react-native-vision-camera': path.resolve(
    projectRoot,
    'node_modules/react-native-vision-camera'
  ),
  'react-native-vision-camera-barcode-scanner': path.resolve(
    projectRoot,
    'node_modules/react-native-vision-camera-barcode-scanner'
  ),
  'react-native-vision-camera-worklets': path.resolve(
    projectRoot,
    'node_modules/react-native-vision-camera-worklets'
  ),
  'react-native-nitro-modules': path.resolve(
    projectRoot,
    'node_modules/react-native-nitro-modules'
  ),
  'react-native-nitro-image': path.resolve(
    projectRoot,
    'node_modules/react-native-nitro-image'
  ),
  // Phase A — dl-scan example app rebuild (task #71). Same "single physical
  // copy" requirement as the families above. Reanimated relies on a global
  // UI worklet context; svg installs a global component registry; blur and
  // linear-gradient ship native views; haptics talks to a single native
  // module. Multiple copies would silently half-work or crash at first
  // useSharedValue / first <Svg/> render.
  'react-native-reanimated': path.resolve(
    projectRoot,
    'node_modules/react-native-reanimated'
  ),
  'react-native-svg': path.resolve(
    projectRoot,
    'node_modules/react-native-svg'
  ),
  'expo-blur': path.resolve(projectRoot, 'node_modules/expo-blur'),
  'expo-haptics': path.resolve(projectRoot, 'node_modules/expo-haptics'),
  'expo-linear-gradient': path.resolve(
    projectRoot,
    'node_modules/expo-linear-gradient'
  ),
  '@react-native-async-storage/async-storage': path.resolve(
    projectRoot,
    'node_modules/@react-native-async-storage/async-storage'
  ),
};

// Force-resolve singletons regardless of the importer's location.
// Subpath imports like 'react/jsx-runtime' are also redirected.
const originalResolveRequest = config.resolver.resolveRequest;
const exampleRootEntry = path.join(projectRoot, 'index.ts');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const name of Object.keys(singletons)) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      // Re-resolve as if the import came from the example's root entry.
      // This ignores the importer's location (which may be the lib's own
      // node_modules) and forces metro to walk from `example/` outwards.
      return context.resolveRequest(
        { ...context, originModulePath: exampleRootEntry },
        moduleName,
        platform
      );
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Resolve from BOTH local and workspace node_modules so the linked lib's
// own deps are findable but project-local takes priority.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
