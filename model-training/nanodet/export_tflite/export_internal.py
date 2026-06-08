#!/usr/bin/env python
"""Disk-independent NanoDet field-detector export (runs entirely on internal storage).

Produces, from the proven mAP-0.967 EMA weights:
  export/nanodet_field_416.onnx   NCHW [1,3,416,416] in, [1,3598,62] out  (reference/fallback)
  export/nanodet_field_416.tflite NHWC [1,416,416,3] in, [1,3598,62] out  (for react-native-fast-tflite)

The .tflite input is NHWC to match cpp/detect/preprocess + src/detector.ts. Output is
anchor-major [1,3598,62] (30 sigmoid cls + 4*8 DFL logits) as cpp/detect/nanodet_decode expects.
"""
import os
import torch
import yaml
from nanodet.model.arch import build_model
from nanodet.util.yacs import CfgNode

HERE = os.path.expanduser("~/nanodet-rescue")
OUT = os.path.join(HERE, "export")
os.makedirs(OUT, exist_ok=True)

raw = yaml.safe_load(open(os.path.join(HERE, "dlscan-nanodet-plus-m_416.yml")))
cfg = CfgNode(raw, new_allowed=True)
# skip the pretrained-backbone download; our trained weights overwrite it anyway
cfg.model.arch.backbone.pretrain = False

model = build_model(cfg.model)
model.eval()
ck = torch.load(os.path.join(HERE, "nanodet_model_best.pth"), map_location="cpu", weights_only=False)
model.load_state_dict(ck["state_dict"], strict=True)

with torch.no_grad():
    y = model(torch.randn(1, 3, 416, 416))
assert tuple(y.shape) == (1, 3598, 62), ("unexpected output shape", y.shape)
print("[ok] model built + weights loaded, eval output", tuple(y.shape))

# 1) ONNX reference (NCHW), opset 11 -- best-effort; the .tflite is the real deliverable
onnx_path = os.path.join(OUT, "nanodet_field_416.onnx")
try:
    torch.onnx.export(
        model, torch.randn(1, 3, 416, 416), onnx_path,
        opset_version=11, input_names=["data"], output_names=["output"],
        keep_initializers_as_inputs=True, dynamo=False,
    )
    print("[ok] ONNX ->", onnx_path)
except Exception as e:
    print("[warn] ONNX export skipped:", repr(e)[:200])

# 2) TFLite via ai-edge-torch with an NHWC input adapter
class NHWCAdapter(torch.nn.Module):
    """NHWC input + sigmoid'd class channels, to match the tested C++ decode contract
    (cpp/detect/nanodet_decode: cls are read as probabilities; DFL stay logits)."""
    def __init__(self, m):
        super().__init__()
        self.m = m
    def forward(self, x):  # x: NHWC [1,416,416,3]
        out = self.m(x.permute(0, 3, 1, 2).contiguous())  # [1,3598,62]
        cls = out[..., :30].sigmoid()   # 30 class scores -> probabilities
        reg = out[..., 30:]             # 4*8 DFL logits, decode does the softmax/integral
        return torch.cat([cls, reg], dim=-1)

wrap = NHWCAdapter(model).eval()
with torch.no_grad():
    yz = wrap(torch.randn(1, 416, 416, 3))
assert tuple(yz.shape) == (1, 3598, 62), ("adapter shape", yz.shape)
print("[ok] NHWC adapter output", tuple(yz.shape))

import litert_torch
sample = (torch.randn(1, 416, 416, 3),)
edge = litert_torch.convert(wrap, sample)
tfl_path = os.path.join(OUT, "nanodet_field_416.tflite")
edge.export(tfl_path)
print("[ok] TFLITE ->", tfl_path)
print("DONE")
