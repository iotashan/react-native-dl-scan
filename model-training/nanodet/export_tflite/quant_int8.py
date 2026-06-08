#!/usr/bin/env python
"""Explore dynamic-range int8 weight quantization of the field detector (no calibration data).
Measures quantization error vs the validated fp32 .tflite, split by head so we can see whether
the detection head is degraded (the known int8 risk for this model family)."""
import os
import numpy as np
from ai_edge_quantizer import quantizer, recipe
from ai_edge_litert.interpreter import Interpreter

HERE = os.path.expanduser("~/nanodet-rescue/export")
FP32 = os.path.join(HERE, "nanodet_field_416.tflite")
INT8 = os.path.join(HERE, "nanodet_field_416_dynint8.tflite")

q = quantizer.Quantizer(FP32, recipe.dynamic_wi8_afp32())
result = q.quantize()
result.export_model(INT8)
print("[ok] int8 written", INT8, os.path.getsize(INT8), "bytes vs fp32", os.path.getsize(FP32))

def run(path, x):
    it = Interpreter(model_path=path); it.allocate_tensors()
    i = it.get_input_details()[0]; o = it.get_output_details()[0]
    it.set_tensor(i["index"], x); it.invoke()
    return it.get_tensor(o["index"])

rng = np.random.default_rng(0)
x = rng.standard_normal((1, 416, 416, 3), dtype=np.float32)
y32 = run(FP32, x); y8 = run(INT8, x)
d = np.abs(y32 - y8)
print("overall  max", float(d.max()), "mean", float(d.mean()))
print("cls head (sigmoid 0..1) max", float(np.abs(y32[...,:30]-y8[...,:30]).max()),
      "mean", float(np.abs(y32[...,:30]-y8[...,:30]).mean()))
print("dfl head (logits)       max", float(np.abs(y32[...,30:]-y8[...,30:]).max()),
      "mean", float(np.abs(y32[...,30:]-y8[...,30:]).mean()))
print("corr", float(np.corrcoef(y32.ravel(), y8.ravel())[0,1]))
