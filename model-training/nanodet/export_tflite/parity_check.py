#!/usr/bin/env python
"""Verify the exported .tflite matches the PyTorch model numerically."""
import os
import numpy as np
import torch
import yaml
from nanodet.model.arch import build_model
from nanodet.util.yacs import CfgNode
from ai_edge_litert.interpreter import Interpreter

HERE = os.path.expanduser("~/nanodet-rescue")
raw = yaml.safe_load(open(os.path.join(HERE, "dlscan-nanodet-plus-m_416.yml")))
cfg = CfgNode(raw, new_allowed=True)
cfg.model.arch.backbone.pretrain = False
m = build_model(cfg.model); m.eval()
ck = torch.load(os.path.join(HERE, "nanodet_model_best.pth"), map_location="cpu", weights_only=False)
m.load_state_dict(ck["state_dict"], strict=True)

torch.manual_seed(0)
x_nhwc = torch.randn(1, 416, 416, 3)
with torch.no_grad():
    y_torch = m(x_nhwc.permute(0, 3, 1, 2).contiguous()).numpy()

it = Interpreter(model_path=os.path.join(HERE, "export/nanodet_field_416.tflite"))
it.allocate_tensors()
inp = it.get_input_details()[0]; out = it.get_output_details()[0]
it.set_tensor(inp["index"], x_nhwc.numpy().astype(np.float32))
it.invoke()
y_tfl = it.get_tensor(out["index"])

d = np.abs(y_torch - y_tfl)
print("shapes:", y_torch.shape, y_tfl.shape)
print("max abs diff :", float(d.max()))
print("mean abs diff:", float(d.mean()))
# split: first 30 channels are sigmoid class scores (0..1), last 32 are DFL logits
cls_t, cls_f = y_torch[..., :30], y_tfl[..., :30]
print("cls max abs diff (sigmoid 0..1):", float(np.abs(cls_t - cls_f).max()))
print("allclose atol=1e-4:", np.allclose(y_torch, y_tfl, atol=1e-4))
print("allclose atol=1e-3:", np.allclose(y_torch, y_tfl, atol=1e-3))
print("corr:", float(np.corrcoef(y_torch.ravel(), y_tfl.ravel())[0, 1]))
