#!/usr/bin/env python3
"""Generate DocAligner decode golden fixtures from the real model.

Runs docaligner_lcnet100.tflite on a couple of IDNet cards, saves each raw
[128,128,4] output heatmap as float32, and the reference-decoded corners. The
C++ test (cpp/tests/doc_aligner_test.cpp, DecodesRealModelHeatmap*) reads these
and confirms decode_corners reproduces the corners on real model output.

The decode here MUST match cpp/detect/doc_aligner.cpp exactly: per-channel
argmax + local soft-argmax (weighted centroid, weights = non-negative values)
over a (2*radius+1)^2 window, pixel-center normalized.

Run (from repo root):
  uv run --no-project --with ai-edge-litert --with pillow \\
    python3 model-training/docaligner/gen_golden.py \\
    android/src/main/assets/docaligner_lcnet100.tflite \\
    cpp/tests/fixtures/docaligner_golden
"""
import glob
import sys

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from PIL import Image

# IDNet cards that frame the document cleanly (peaks land near the corners).
CARD_GLOBS = [
    "/Volumes/Work4TB/dev/iotashan/idnet-data/extracted/finland_id/*.jpg",
    "/Volumes/Work4TB/dev/iotashan/idnet-data/extracted/estonia_id/*.jpg",
]


def decode(o, radius=2):
    """Reference decode — keep byte-for-byte in step with decode_corners()."""
    h, w, _ = o.shape
    out = []
    for k in range(4):
        hm = o[:, :, k]
        rmax, cmax = np.unravel_index(int(np.argmax(hm)), hm.shape)
        fr, fc = float(rmax), float(cmax)
        if radius > 0:
            sw = swr = swc = 0.0
            for dr in range(-radius, radius + 1):
                for dc in range(-radius, radius + 1):
                    r, c = rmax + dr, cmax + dc
                    if 0 <= r < h and 0 <= c < w:
                        v = float(hm[r, c])
                        if v > 0:
                            sw += v
                            swr += v * r
                            swc += v * c
            if sw > 0:
                fr, fc = swr / sw, swc / sw
        out.append(((fc + 0.5) / w, (fr + 0.5) / h))
    return out


def main(model_path, fixture_dir):
    it = Interpreter(model_path=model_path)
    it.allocate_tensors()
    inp = it.get_input_details()[0]
    out = it.get_output_details()[0]
    cards = [g[0] for g in (sorted(glob.glob(p)) for p in CARD_GLOBS) if g]
    for i, p in enumerate(cards):
        im = Image.open(p).convert("RGB").resize((256, 256), Image.BILINEAR)
        x = (np.asarray(im, dtype=np.float32) / 255.0)[None]
        it.set_tensor(inp["index"], x)
        it.invoke()
        o = it.get_tensor(out["index"])[0].astype(np.float32)  # [128,128,4]
        o.tofile(f"{fixture_dir}/heatmap_{i}.bin")
        with open(f"{fixture_dir}/corners_{i}.txt", "w") as f:
            for cx, cy in decode(o):
                f.write(f"{cx:.8f} {cy:.8f}\n")
        print(f"  fixture {i}: {p.split('/')[-2]}")
    print(f"wrote {len(cards)} fixtures to {fixture_dir}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
