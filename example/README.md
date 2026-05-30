# `react-native-dl-scan` example app

This is the official sample for **react-native-dl-scan**. It is intentionally small (one app, one screen, no router, no Redux) but exercises every meaningful surface of the library and several patterns that aren't obvious from the library's API alone. If you're integrating the library into your own product, the patterns here are tested and load-bearing.

The app runs on iOS (physical device or Simulator with [SimCam](https://simcam.swmansion.com)) and Android (physical device — Pixel 6 and newer recommended).

## Running it

```sh
# from the repo root
yarn                              # install workspace deps
cd example
yarn ios                          # builds + installs to a booted iOS device/simulator
# or
yarn android                      # builds + installs to a connected Android device
```

For physical iOS the project is signed with team `3VPB4NZTQS` by default — change `example/ios/DlScanExample.xcodeproj/project.pbxproj` `DEVELOPMENT_TEAM` if you're a different developer. For Android no signing config is needed for `assembleDebug`.

## What it demonstrates

### Multi-camera virtual device with auto-macro switching (iOS)

`components/ScannerScreen.tsx` requests `useCameraDevice('back', { physicalDevices: ['ultra-wide-angle', 'wide-angle'] })`. On supported iPhones this returns a "virtual" device whose `switchFactors` array tells Vision Camera at which zoom factor the OS should switch from wide → ultra-wide. The screen pins `zoom={0.97 × switchFactor}` so the camera stays on the wide lens at ~6" distance but flips to ultra-wide auto-macro when you move closer. Android uses the neutral `zoom={Math.max(1, minZoom)}` path because Pixel cameras don't expose the same multi-device topology.

This is the cleanest answer to the "close hold blurs at 4 inches" problem without writing a custom camera UI.

### Multi-frame voter (library-side, surfaced in UI)

The library accumulates `FieldCandidate` records into a per-instance C++ `FieldVoter` and emits the cross-frame consensus to JS only after every successful frame. The example reads `licenseData.dataConfidence` per frame and the result view groups fields by tier (`cross_validated` / `all_gates_passed` / `shape_matched` / `extracted_raw`) on the **ConfidenceRail** above the field grid.

### Confidence rail + tier-aware field chips

`ResultView.tsx` renders every field via `<FieldChip>` (defined at the bottom of the same file). Each chip:
- Looks up `dataConfidence[field]` and colors a halo line at the top edge by tier.
- Suppresses the confidence chip + dropped-styling when the value itself is missing (no more "95% Not detected" contradictions).
- Renders "Not detected" italic placeholder for required fields that didn't populate.

The minimum-tier slider in **DebugDrawer.tsx** (`tweaks.minTier`) drops any field whose tier is below the threshold. Set it to `Verified only` to see only `cross_validated` fields — that's the strictest read.

### Scan-again session-epoch remount

The "Scan next license" button in `ActionBar.tsx` increments a `scanSessionId` integer in `App.tsx` and passes it as `key={scanSessionId}` on `<ScannerScreen>`. React unmounts the whole subtree and mounts a fresh one, which means the `useLicenseScanner` hook gets a fresh C++ voter (no carry-over votes from the prior license), and no stale-closure passive effect from the previous render can re-emit the prior license's data.

This is the fix for the "scan-again instantly re-emits prior result" bug (#79). The prior `useLayoutEffect` + `useRef` guard approach was unsound because passive effects can close over pre-reset state.

### Mode flip + auto-fallback timer

`ModeFlip.tsx` toggles between barcode (back of DL, PDF417) and OCR (front of DL, text). When the user is in barcode mode and OCR auto-fallback is enabled in tweaks, an interval in `App.tsx` counts down `fallbackSec` seconds and flips to OCR if no barcode is detected. The countdown ring is rendered by `viewfinder/FallbackCountdown.tsx`.

### Viewfinder geometry (95% portrait fill)

`viewfinder/geometry.ts` exports a pure `computeViewfinderGeometry(containerW, containerH, fillPct)` that respects the **ID-1 (CR80) aspect ratio** of a real driver's license card. The screen passes `fillPct={0.95}` for phone portrait — the cutout card is sized to 95% of viewport width with `cardH = cardW / 1.585`. The shadow/border, reticle, and pipeline overlay all derive their geometry from the same function so they stay aligned without re-deriving.

### Stop-scanning toggle

The primary action button in `ActionBar.tsx` is `"Start scan"` when idle and `"Stop scanning"` while scanning. Stopping returns the phase machine to `idle` without resetting the voter — useful for "I held the card crooked, let me re-aim" flows.

### Debug drawer

Tap the bug icon in the bottom-right to open `DebugDrawer.tsx`. The drawer shows:
- Scanner settings (auto-fallback toggle + seconds, min-confidence-tier slider, haptic on capture)
- Aesthetic settings (direction = Onyx / Vellum / Lumen; theme = Auto / Light / Dark)
- Fixture button (toggle the pipeline animation)
- **Pipeline** — visual diagram of the 5-stage pipeline (camera frame → MLKit/VisionKit OCR → JS → Nitro JNI → C++ extractor → 4-gate voter)
- Confidence tier legend
- Raw payload of the most recent scan

The pipeline animation is purely visual and isn't tied to the actual processing — it's an illustration aid, not a progress indicator. (#82 follow-up: tie animation to actual stages.)

### Theme + direction tokens

`theme/tokens.ts` defines three palettes (Onyx, Vellum, Lumen — the design's "directions") and three themes (Auto, Light, Dark). `theme/useTokens.ts` resolves both into a single `ThemeTokens` object that every component receives via prop. The example follows the system appearance by default. No third-party theming lib.

### LogBox suppression

`App.tsx` calls `LogBox.ignoreAllLogs(true)` at module load. In dev builds the yellow LogBox banner intercepts taps on the Start-scan button at the bottom of the screen during agent-device-driven testing. Release builds disable LogBox anyway. Disable this line if you want to see warnings in dev.

## Layout

```
example/
├── App.tsx                        — Orchestrates phase machine + cross-screen state
├── components/
│   ├── ActionBar.tsx              — Bottom bar: Start/Stop + scan-again + debug
│   ├── DebugDrawer.tsx            — Tweaks + raw-payload bottom sheet
│   ├── FlipCard.tsx               — 3D flip animation for the scan ↔ result transition
│   ├── ModeFlip.tsx               — barcode/OCR toggle
│   ├── PipelineOverlay.tsx        — Per-frame extraction stages overlay
│   ├── ResultView.tsx             — Hero card + ALL FIELDS grid + ConfidenceRail
│   ├── ScannerScreen.tsx          — Camera + viewfinder + reticle composition
│   ├── TopBar.tsx                 — App name + session counter
│   └── viewfinder/
│       ├── FallbackCountdown.tsx  — Barcode → OCR auto-fallback ring
│       ├── geometry.ts            — Pure geometry helper, unit-testable
│       ├── Reticle.tsx            — Corner brackets + center anchor
│       └── Viewfinder.tsx         — Cutout scrim + reticle + countdown
├── hooks/
│   ├── useDeviceLayout.ts         — Phone vs tablet, portrait vs landscape
│   └── useTweaks.ts               — Persisted user-tweakable settings
└── theme/
    ├── tokens.ts                  — Palette + direction definitions
    └── useTokens.ts               — Theme/direction resolver
```

## On-device test harness

Both platforms are driveable via [agent-device](https://incubator.callstack.com/agent-device/) for scripted UI testing. For Android the runner ships with the CLI; for iOS the runner needs a one-time sign-and-install: add an Apple ID in **Xcode → Settings → Accounts** so Xcode can auto-create the runner provisioning profiles, then set `AGENT_DEVICE_IOS_TEAM_ID=<your-team-id>` and run `agent-device open <bundle-id> --platform ios` once (the first run takes ~30–60s while it builds and installs the runner). See the [agent-device docs](https://incubator.callstack.com/agent-device/) for the full runner-signing walkthrough.

For iOS Simulator camera testing, [SimCam](https://simcam.swmansion.com) feeds a static image into the simulator's AVFoundation camera so the OCR pipeline can run end-to-end on an unattended machine. The image-prep recipe that frames a full DL inside the viewfinder in iPad-portrait is a **3:4 portrait canvas (1080×1440)** with the license upscaled to ~50% of canvas width and centered, e.g. with ImageMagick:

```sh
magick "$src.jpg" \
  -resize 540x \
  -background gray85 \
  -gravity center \
  -extent 1080x1440 \
  out.png

# then point SimCam's back camera at it (absolute path):
/Applications/SimCam.app/Contents/MacOS/simcamctl set-source --back --image "$PWD/out.png"
```

The extra horizontal margin absorbs the cumulative crop from the AVCaptureSession sensor stage and Vision Camera's `resizeMode='cover'`. See the [SimCam docs](https://simcam.swmansion.com) for source-setup details and license activation.
