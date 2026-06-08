# Phase -1.1 result: runtime gate — LiteRT (NOT ORT) (2026-05-30)

Measured prebuilt artifact sizes (subagent, official releases):
- ORT iOS arm64 = 42.9 MB, Android arm64 .so = 27.4 MB → ~3.5x over the 12 MB gate. ORT-minimal needs from-source builds per release (forbidden by gate / high maintenance).
- LiteRT iOS = 23.4 MB, Android .so = 3.4 MB. Apache-2.0. Core ML delegate = ANE on iOS.
- Neither has a clean official SPM → ORT's SPM "advantage" is illusory; both need a self-wrapped xcframework binaryTarget.
- DECISIVE: our real tree ALREADY uses TFLite on Android (field detector + DocAligner). LiteRT is the incumbent, not a new dep.

DECISION: unified inference runtime = **LiteRT / TFLite C++** on both platforms.
- Model ships as .tflite (NanoDet -> ONNX -> TFLite via onnx2tf). ONNX stays the intermediate + golden source.
- iOS: TFLite C++ API + Core ML delegate (ANE). Android: TFLite C++ (incumbent) + XNNPACK/NNAPI/GPU delegates.
- The C++ decode is runtime-agnostic (operates on the [1,A,62] output tensor); unchanged from the ORT plan.
- Experiment matrix EPs become TFLite delegates: iOS {Core ML delegate, XNNPACK} ; Android {XNNPACK, NNAPI, GPU}.
