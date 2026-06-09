# Testing the scanner in the iOS Simulator

The iOS Simulator has no physical camera, and parts of the native ML pipeline
behave differently under it. This page documents what works, what doesn't, and
the recommended workflow.

## TL;DR

| What you want to verify | Simulator | Physical device |
|---|---|---|
| UI, navigation, results screen, settings | ✅ | ✅ |
| JS/native integration (the `DLScan` Nitro module registering, scan lifecycle) | ✅ | ✅ |
| Camera feed reaching the frame processor | ✅ with SimCam (below) | ✅ |
| Document segmentation (DocAligner Core ML) | ⚠️ unreliable | ✅ |
| Full OCR field extraction end-to-end | ⚠️ unreliable | ✅ |
| Scan accuracy claims of any kind | ❌ never | ✅ |

**Rule of thumb:** the simulator is for UI and plumbing; accuracy and pipeline
verification need a physical device.

## Feeding the simulator a camera image — SimCam

[SimCam](https://simcam.swmansion.com) (Software Mansion) streams an arbitrary
image, video, or your Mac's webcam into the simulator's AVFoundation camera.
No app-side SDK or pod is required, and `react-native-vision-camera >= 5.0`
(what this library uses) works with it out of the box.

> Static-image and video sources require a SimCam license; the unlicensed mode
> only forwards the Mac webcam.

Workflow:

1. Launch the SimCam app on the Mac, then boot the simulator.
2. Pre-grant camera permission so the OS prompt doesn't block automation:

   ```bash
   xcrun simctl privacy <device-udid> grant camera <your-app-bundle-id>
   ```

3. Point SimCam at a test image (CLI ships inside the app bundle):

   ```bash
   /Applications/SimCam.app/Contents/MacOS/simcamctl set-source --back \
     --image /Users/<you>/Pictures/dl-test/sample-card.png
   ```

   Use absolute paths, and stage fixtures under `~/Pictures`/`~/Documents`/
   `~/Downloads` — SimCam is sandboxed and intermittently fails to read from
   `/tmp`.

### Image prep — avoid the double crop

Two aspect-fill stages sit between your file and the frame processor (the
simulated sensor produces portrait 3:4 output, and the `<Camera>` view defaults
to `resizeMode='cover'`). A bare landscape card image gets center-cropped to an
unusable band. The fixture shape that survives both stages in a portrait
layout:

- a **3:4 portrait canvas (e.g. 1080×1440)**,
- with the card scaled to **~50% of canvas width**, centered, on a neutral
  background:

```bash
magick card.jpg -resize 540x -background gray85 -gravity center \
  -extent 1080x1440 ~/Pictures/dl-test/card-padded.png
```

## Known limitation: DocAligner / Vision under the simulator

The document-segmentation model (DocAligner, Core ML on iOS) and some Apple
Vision framework paths have limited simulator support — the simulator lacks the
Neural Engine, and Core ML's CPU fallback does not reproduce on-device
behavior. In practice document detection may return weak or no corner heatmaps
even with a clean SimCam feed, which stalls the OCR pipeline upstream of any
field extraction.

This is an Apple platform limitation, not an app bug. If the viewfinder shows
the card but the scan never progresses past frame capture in the simulator,
that is expected — move to a physical device.

## What to use instead for pipeline verification

- **Physical device**: the only authoritative path for end-to-end scan
  verification on iOS. Any accuracy evaluation must be scored field-by-field
  against known-correct card data — "the scan completed" is not success.
- **Offline parser evaluation**: parsing changes can be validated without any
  device via the C++ evaluation harnesses in `cpp/eval/` (see
  `docs/EVALUATION.md`), which replay recorded OCR observations through the
  shared parser across jurisdictions.
