#!/usr/bin/env node
// Guard against the "DlScan silently missing from the build" failure mode.
//
// The example consumes react-native-dl-scan via `portal:..`, which leaves no
// node_modules entry under yarn 3. The library is made discoverable WITHOUT a
// manual symlink by two cooperating pieces:
//   1. example/react-native.config.js  -> native autolinking (iOS pod + Android
//      DlScanPackage) via dependencies['react-native-dl-scan'].root, and
//   2. example/metro.config.js         -> Metro JS resolution via
//      resolver.extraNodeModules['react-native-dl-scan'] = workspaceRoot.
//
// If EITHER drifts, the app builds without the native Nitro module and crashes
// on the first scan — but the build still SUCCEEDS, so the regression is silent.
// This script asserts both paths still see the library. Run `yarn check:linkage`
// (ideally in CI before any example build). Exits non-zero on failure.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PKG = 'react-native-dl-scan';
const exampleRoot = path.join(__dirname, '..');
let ok = true;

// 1. Native autolinking — assert the library is present on BOTH platforms.
for (const platform of ['ios', 'android']) {
  try {
    const out = execSync(
      `npx expo-modules-autolinking react-native-config --platform ${platform}`,
      {
        cwd: exampleRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    const present = out.includes(`'${PKG}'`) || out.includes(`"${PKG}"`);
    console.log(
      `[check:linkage] native autolinking (${platform}): ${present ? 'OK' : 'MISSING'}`
    );
    if (!present) ok = false;
  } catch (err) {
    console.error(
      `[check:linkage] native autolinking (${platform}): could not run — ${err.message}`
    );
    ok = false;
  }
}

// 2. Metro — assert the extraNodeModules mapping that resolves the import is
//    still declared (the import would otherwise fail to resolve with no symlink).
const metroCfg = fs.readFileSync(
  path.join(exampleRoot, 'metro.config.js'),
  'utf8'
);
const metroOk = metroCfg.includes(`'${PKG}': workspaceRoot`);
console.log(
  `[check:linkage] metro extraNodeModules: ${metroOk ? 'OK' : 'MISSING'}`
);
if (!metroOk) ok = false;

if (!ok) {
  console.error(
    `\n[check:linkage] FAIL — ${PKG} is not reliably linked; the example would build WITHOUT the native module. ` +
      `See example/react-native.config.js + example/metro.config.js.`
  );
  process.exit(1);
}
console.log(
  `\n[check:linkage] PASS — ${PKG} is linked for native autolinking + Metro.`
);
