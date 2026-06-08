# Phase -1.2 result: NanoDet export feasibility — PASSED (2026-05-30)

NanoDet-Plus-m builds + exports to ONNX + runs in onnxruntime. **Use NanoDet (not YOLOX).**

## Ground truth from the probe (corrects the plan)
- Params: **4.23M** (FP32 ~17MB, int8 ~4MB — comparable to the old YOLOv8n).
- FPN levels: **4 strides = 8, 16, 32, 64** (NOT 3). At 640: anchors 80²+40²+20²+10² = 8500.
- Export output: a SINGLE concatenated tensor **[1, num_anchors, 62]**, NOT per-level heads.
  - 62 = num_classes(30) + 4*(reg_max+1), **reg_max=7** → 4*8 = 32.
  - Each anchor row = [30 sigmoid cls scores, 32 DFL distance logits (4 sides × 8 bins)].
- opset 11 works; onnxsim available.

## C++ decode implications (Phase 1 Task 1.3)
- Iterate 4 strides (8/16/32/64), generate grid-cell centers per level (concatenated in stride order).
- Per anchor: sigmoid 30 cls; DFL softmax over 8 bins ×4 sides → ltrb (× stride) → xyxy; per-class NMS.
- reg_max=7 → 8 bins per side (the +1 trap).

## Working dependency pins (the unmaintained-repo tax — reproducible)
Python 3.11, torch 2.2.2, torchvision 0.17.2, pytorch-lightning 1.9.5, setuptools<70
(pkg_resources needed by lightning_fabric), numpy<2, matplotlib, onnx-simplifier, pycocotools.
