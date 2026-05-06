"""
GPU / CPU / ANE throughput micro-benchmarks for M3 Ultra.

This is a SKELETON — fill in the benchmark bodies when you want
to profile a specific model or operation.

Suggested benchmarks to implement:
  - GPU FP16 throughput: batch inference with YOLOv8n-OBB on MPS device,
    measure images/sec at batch sizes 1, 8, 32, 128.
  - CPU throughput: same model on CPU, for smoke-test comparison baseline.
  - Neural Engine inference latency: Core ML model via coremltools.models.MLModel
    predict(), measure per-sample latency with the `computeUnits` set to
    ANE_ONLY, CPU_AND_NE, ALL.
  - Memory bandwidth saturation: torch.zeros(..., device='mps') fill + matmul
    at increasing tensor sizes; compare achieved GB/s vs M3 Ultra peak 819 GB/s.

Usage (once implemented):
  python model-training/utils/benchmarks.py --benchmark gpu_fp16
  python model-training/utils/benchmarks.py --benchmark ane_latency --model models/DlScanDocDetector.mlmodelc
"""

import argparse
import time
from pathlib import Path


def benchmark_gpu_fp16(model_path: Path | None = None, batch_sizes: list[int] | None = None) -> None:
    """
    TODO: Measure YOLOv8n-OBB inference throughput on MPS (FP16).

    Suggested implementation:
      1. Load model with YOLO(model_path) or use a dummy yolov8n-obb.pt.
      2. For each batch_size in batch_sizes:
         a. Warmup 5 iterations.
         b. Time 50 iterations.
         c. Report images/sec and ms/image.
    """
    raise NotImplementedError("Fill in GPU FP16 benchmark")


def benchmark_cpu(model_path: Path | None = None) -> None:
    """
    TODO: Measure YOLOv8n-OBB inference throughput on CPU.

    Used as a correctness baseline when MPS OBB smoke test fails.
    """
    raise NotImplementedError("Fill in CPU benchmark")


def benchmark_ane_latency(model_path: Path) -> None:
    """
    TODO: Measure Core ML model inference latency on the Neural Engine.

    Suggested implementation:
      import coremltools as ct
      model = ct.models.MLModel(str(model_path),
                                compute_units=ct.ComputeUnit.CPU_AND_NE)
      # Warmup
      for _ in range(10):
          model.predict(dummy_input)
      # Timed run
      t0 = time.perf_counter()
      for _ in range(100):
          model.predict(dummy_input)
      elapsed = time.perf_counter() - t0
      print(f"ANE latency: {elapsed / 100 * 1000:.2f} ms/image")
    """
    raise NotImplementedError("Fill in ANE latency benchmark")


def main() -> None:
    parser = argparse.ArgumentParser(description="M3 Ultra throughput benchmarks")
    parser.add_argument(
        "--benchmark",
        choices=["gpu_fp16", "cpu", "ane_latency"],
        required=True,
        help="Which benchmark to run",
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=None,
        help="Path to model weights (.pt or .mlmodelc)",
    )
    parser.add_argument(
        "--batch-sizes",
        nargs="+",
        type=int,
        default=[1, 8, 32, 128],
        help="Batch sizes to sweep (GPU benchmark only)",
    )
    args = parser.parse_args()

    if args.benchmark == "gpu_fp16":
        benchmark_gpu_fp16(model_path=args.model, batch_sizes=args.batch_sizes)
    elif args.benchmark == "cpu":
        benchmark_cpu(model_path=args.model)
    elif args.benchmark == "ane_latency":
        if args.model is None:
            parser.error("--model required for ane_latency benchmark")
        benchmark_ane_latency(model_path=args.model)


if __name__ == "__main__":
    main()
