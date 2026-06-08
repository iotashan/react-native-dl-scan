#!/usr/bin/env python
"""End-to-end sanity: does the exported field detector actually fire on a real IDNet card?
Compares class-confidence activations on a real image vs random noise, and measures the
fp32->int8 error on IN-DISTRIBUTION input (resolving the OOD caveat from the random-input test)."""
import glob
import os
import cv2
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

# contract preprocessing: BGR, ImageNet mean/std, 416 (stretch is fine for a firing check)
mean = np.array([103.53, 116.28, 123.675], np.float32)
std = np.array([57.375, 57.12, 58.395], np.float32)
imgpath = sorted(glob.glob(os.path.join(HERE, "realimg", "*")))[0]
bgr = cv2.imread(imgpath)
print("image:", os.path.basename(imgpath), bgr.shape)
r = cv2.resize(bgr, (416, 416)).astype(np.float32)
xhwc = (r - mean) / std                      # HWC BGR normalized
xnhwc = xhwc[None].astype(np.float32)         # [1,416,416,3] for tflite
xnchw = torch.from_numpy(xhwc.transpose(2, 0, 1)[None]).float()  # for torch

def cls_stats(o, label):
    cls = o[..., :30]
    # apply sigmoid only if values look like logits (outside [0,1])
    sig = cls if (cls.min() >= -0.01 and cls.max() <= 1.01) else 1 / (1 + np.exp(-cls))
    note = "(already prob)" if sig is cls else "(applied sigmoid)"
    print(f"{label}: cls raw[{cls.min():.3f},{cls.max():.3f}] {note} "
          f"max_conf={sig.max():.3f} | anchors>0.3={(sig>0.3).sum()} >0.5={(sig>0.5).sum()} >0.7={(sig>0.7).sum()}")

with torch.no_grad():
    out_real = m(xnchw).numpy()
    out_noise = m(torch.randn(1, 3, 416, 416)).numpy()
cls_stats(out_real, "REAL card ")
cls_stats(out_noise, "NOISE     ")

def runt(p, x):
    it = Interpreter(model_path=p); it.allocate_tensors()
    i = it.get_input_details()[0]; o = it.get_output_details()[0]
    it.set_tensor(i["index"], x); it.invoke()
    return it.get_tensor(o["index"])

# the exported model bakes sigmoid into the 30 cls channels (to match the C++ decode
# contract); the raw torch model emits logits, so build the expected (sigmoid'd) reference.
expected = out_real.copy()
expected[..., :30] = 1.0 / (1.0 + np.exp(-out_real[..., :30]))
yf = runt(os.path.join(HERE, "export/nanodet_field_416.tflite"), xnhwc)
yi = runt(os.path.join(HERE, "export/nanodet_field_416_dynint8.tflite"), xnhwc)
print("tflite-fp32 vs torch+sigmoid (real): max abs diff", float(np.abs(yf - expected).max()))
cd = np.abs(yi[..., :30] - yf[..., :30])
print("int8 vs fp32 cls error ON REAL input: max", float(cd.max()), "mean", float(cd.mean()))
cls_stats(yi, "int8 card ")
