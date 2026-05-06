"""
train_disambig.py — Keras per-character disambiguation model training.

Reads OCR_PAIRS_PATH (produced by render_ocr_pairs.py), builds and trains a
per-character classification model that corrects OCR substitution errors.

Default architecture (per-char-classification):
  Input:  [one-hot OCR string padded to MAX_FIELD_LEN chars]
          + [field_id embedding of size FIELD_EMBED_DIM]
  Layers: 1D conv × 2  →  Bidirectional LSTM (64 units)  →  Dense per-position
  Output: same length one-hot (post-softmax), PAD positions masked

Fallback architecture (seq2seq — enabled automatically if measure_error_types.py
printed "ARCHITECTURE: seq2seq", or forced via --seq2seq flag):
  Encoder: 1D conv + LSTM(128)
  Decoder: fixed MAX_FIELD_LEN-step LSTM(128) + Attention + Dense
  Output:  MAX_FIELD_LEN × vocab_size one-hot

Training:
  30 epochs, batch=64, Adam lr=1e-3, sparse_categorical_crossentropy
  Saves best model (by val_accuracy) to RUNS_ROOT/disambig/best.keras

Usage:
    python model-training/disambig/train_disambig.py
    python model-training/disambig/train_disambig.py --dry-run
    python model-training/disambig/train_disambig.py --seq2seq
    python model-training/disambig/train_disambig.py --epochs 5  (dev)
"""

import argparse
import json
import logging
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import OCR_PAIRS_PATH, RUNS_ROOT
from idnet.prepare_yolo_fields import FIELD_CLASSES


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------
# All printable ASCII characters + PAD token
PAD = 0
# Characters: printable ASCII 32–126, then PAD=0 by convention
# Indices: 0=PAD, 1=space(32), 2='!'(33), ..., 96='~'(126)
VOCAB: list[str] = ["<PAD>"] + [chr(i) for i in range(32, 127)]
VOCAB_SIZE = len(VOCAB)
CHAR_TO_IDX: dict[str, int] = {c: i for i, c in enumerate(VOCAB)}

MAX_FIELD_LEN = 24      # max characters per field (truncate / pad to this length)
FIELD_EMBED_DIM = 8     # embedding dimension for field_id
RANDOM_SEED = 42


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "train_disambig.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def detect_architecture() -> str:
    """
    Run measure_error_types.py as a subprocess and parse its stdout for the
    ARCHITECTURE line.  Falls back to per-char-classification on any error.
    """
    measure_script = Path(__file__).parent / "measure_error_types.py"
    try:
        result = subprocess.run(
            [sys.executable, str(measure_script)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        for line in result.stdout.splitlines():
            if line.startswith("ARCHITECTURE:"):
                arch = line.split(":", 1)[1].strip()
                return arch
    except Exception:
        pass
    return "per-char-classification"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def encode_string(s: str, max_len: int) -> list[int]:
    """Encode a string as a list of vocabulary indices, padded/truncated to max_len."""
    indices = [CHAR_TO_IDX.get(c, PAD) for c in s[:max_len]]
    indices += [PAD] * (max_len - len(indices))
    return indices


def load_pairs(
    n_max: int | None = None,
    rng: random.Random | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Load OCR pairs from OCR_PAIRS_PATH.

    Returns:
        ocr_encoded:    (N, MAX_FIELD_LEN) int32 — encoded OCR strings
        gt_encoded:     (N, MAX_FIELD_LEN) int32 — encoded ground-truth strings
        field_ids:      (N,) int32 — field class index
        sample_weights: (N,) float32 — 1.0 everywhere (placeholder for class balancing)
    """
    field_id_map = {f: i for i, f in enumerate(FIELD_CLASSES)}
    n_fields = len(FIELD_CLASSES)

    rows: list[tuple[list[int], list[int], int]] = []

    with open(OCR_PAIRS_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                pair = json.loads(line)
            except json.JSONDecodeError:
                continue
            if pair.get("error_type") == "correct":
                continue  # skip perfect pairs
            ocr_str = pair.get("ocr_string", "")
            gt_str = pair.get("gt_string", "")
            field_id_str = pair.get("field_id", "")
            field_idx = field_id_map.get(field_id_str, 0)
            rows.append((encode_string(ocr_str, MAX_FIELD_LEN),
                         encode_string(gt_str, MAX_FIELD_LEN),
                         field_idx))

    if rng and n_max and len(rows) > n_max:
        rows = rng.sample(rows, n_max)

    if not rows:
        raise ValueError(f"No error pairs loaded from {OCR_PAIRS_PATH}")

    ocr_arr = np.array([r[0] for r in rows], dtype=np.int32)
    gt_arr = np.array([r[1] for r in rows], dtype=np.int32)
    field_arr = np.array([r[2] for r in rows], dtype=np.int32)
    weights = np.ones(len(rows), dtype=np.float32)

    return ocr_arr, gt_arr, field_arr, weights


# ---------------------------------------------------------------------------
# Model architectures
# ---------------------------------------------------------------------------

def build_per_char_model(n_fields: int) -> "keras.Model":
    """
    Per-character classification model.

    Input:  ocr_input  (batch, MAX_FIELD_LEN) int — one char per position
            field_input (batch,) int — field class ID
    Output: (batch, MAX_FIELD_LEN, VOCAB_SIZE) float — softmax over vocab per pos
    """
    import keras
    from keras import layers

    ocr_input = keras.Input(shape=(MAX_FIELD_LEN,), dtype="int32", name="ocr_input")
    field_input = keras.Input(shape=(), dtype="int32", name="field_input")

    # Character embedding
    x = layers.Embedding(VOCAB_SIZE, 32, mask_zero=True, name="char_embed")(ocr_input)

    # Field embedding, broadcast across sequence length
    field_embed = layers.Embedding(n_fields, FIELD_EMBED_DIM, name="field_embed")(field_input)
    field_emb_tiled = layers.Lambda(
        lambda t: keras.ops.repeat(
            keras.ops.expand_dims(t, axis=1), MAX_FIELD_LEN, axis=1
        )
    )(field_embed)

    # Concatenate char embedding + field context
    x = layers.Concatenate(axis=-1)([x, field_emb_tiled])

    # Two 1D conv layers for local context
    x = layers.Conv1D(64, 3, padding="same", activation="relu", name="conv1")(x)
    x = layers.Conv1D(64, 3, padding="same", activation="relu", name="conv2")(x)

    # Bidirectional LSTM for sequence context
    x = layers.Bidirectional(layers.LSTM(64, return_sequences=True), name="bilstm")(x)

    # Per-position character classification
    output = layers.Dense(VOCAB_SIZE, activation="softmax", name="char_logits")(x)

    model = keras.Model(
        inputs=[ocr_input, field_input],
        outputs=output,
        name="disambig_per_char",
    )
    return model


def build_seq2seq_model(n_fields: int) -> "keras.Model":
    """
    Fixed-max-output-length encoder-decoder (LSTM seq2seq with attention).

    TFLite-exportable: uses fixed MAX_FIELD_LEN output length (no dynamic
    autoregressive decoding at inference — all steps unrolled statically).

    Input:  ocr_input   (batch, MAX_FIELD_LEN) int
            field_input (batch,) int
    Output: (batch, MAX_FIELD_LEN, VOCAB_SIZE) float
    """
    import keras
    from keras import layers

    ocr_input = keras.Input(shape=(MAX_FIELD_LEN,), dtype="int32", name="ocr_input")
    field_input = keras.Input(shape=(), dtype="int32", name="field_input")

    # Encoder
    char_emb = layers.Embedding(VOCAB_SIZE, 32, mask_zero=True, name="enc_char_embed")(ocr_input)
    field_emb = layers.Embedding(n_fields, FIELD_EMBED_DIM, name="enc_field_embed")(field_input)
    field_tiled = layers.Lambda(
        lambda t: keras.ops.repeat(keras.ops.expand_dims(t, axis=1), MAX_FIELD_LEN, axis=1)
    )(field_emb)
    enc_input = layers.Concatenate(axis=-1)([char_emb, field_tiled])
    enc_input = layers.Conv1D(64, 3, padding="same", activation="relu", name="enc_conv")(enc_input)
    enc_out, enc_h, enc_c = layers.LSTM(128, return_sequences=True, return_state=True,
                                         name="encoder_lstm")(enc_input)

    # Decoder: teacher-forced during training (OCR as decoder input)
    dec_input = layers.Embedding(VOCAB_SIZE, 32, name="dec_embed")(ocr_input)
    dec_out, _, _ = layers.LSTM(128, return_sequences=True, return_state=True,
                                 name="decoder_lstm")(dec_input, initial_state=[enc_h, enc_c])

    # Bahdanau-style dot-product attention
    attn_scores = layers.Dot(axes=[2, 2], name="attn_scores")([dec_out, enc_out])
    attn_weights = layers.Softmax(axis=-1, name="attn_weights")(attn_scores)
    context = layers.Dot(axes=[2, 1], name="context")([attn_weights, enc_out])
    dec_with_context = layers.Concatenate(axis=-1, name="dec_context")([dec_out, context])

    output = layers.Dense(VOCAB_SIZE, activation="softmax", name="char_logits")(dec_with_context)

    model = keras.Model(
        inputs=[ocr_input, field_input],
        outputs=output,
        name="disambig_seq2seq",
    )
    return model


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train(
    architecture: str,
    epochs: int,
    batch_size: int,
    dry_run: bool,
    logger: logging.Logger,
    seed: int = RANDOM_SEED,
) -> None:
    rng = random.Random(seed)
    n_fields = len(FIELD_CLASSES)
    run_dir = RUNS_ROOT / "disambig"
    run_dir.mkdir(parents=True, exist_ok=True)

    if dry_run:
        logger.info("[dry-run] Architecture: %s", architecture)
        logger.info("[dry-run] Would train for %d epochs, batch=%d", epochs, batch_size)
        logger.info("[dry-run] Would save to %s/best.keras", run_dir)
        return

    # Imports deferred so the script parses cleanly without TF installed
    try:
        import keras
        import tensorflow as tf
    except ImportError as e:
        logger.error("Import error: %s\nRun: pip install -r requirements.txt", e)
        sys.exit(1)

    keras.utils.set_random_seed(seed)

    logger.info("Loading OCR pairs from %s ...", OCR_PAIRS_PATH)
    ocr_arr, gt_arr, field_arr, weights = load_pairs(rng=rng)
    logger.info("Loaded %d error pairs", len(ocr_arr))

    # Train/val split (90/10)
    n = len(ocr_arr)
    n_val = int(n * 0.1)
    indices = list(range(n))
    rng.shuffle(indices)
    val_idx = indices[:n_val]
    trn_idx = indices[n_val:]

    def make_dataset(idx: list[int], shuffle: bool) -> "tf.data.Dataset":
        ds = tf.data.Dataset.from_tensor_slices((
            {"ocr_input": ocr_arr[idx], "field_input": field_arr[idx]},
            gt_arr[idx],
        ))
        if shuffle:
            ds = ds.shuffle(min(10000, len(idx)), seed=seed)
        return ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)

    train_ds = make_dataset(trn_idx, shuffle=True)
    val_ds = make_dataset(val_idx, shuffle=False)

    # Build model
    logger.info("Building architecture: %s", architecture)
    if architecture == "seq2seq":
        model = build_seq2seq_model(n_fields)
    else:
        model = build_per_char_model(n_fields)

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.summary(print_fn=logger.info)

    # Callbacks
    best_path = str(run_dir / "best.keras")
    callbacks = [
        keras.callbacks.ModelCheckpoint(
            filepath=best_path,
            monitor="val_accuracy",
            save_best_only=True,
            verbose=1,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=3,
            min_lr=1e-6,
            verbose=1,
        ),
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=5,
            restore_best_weights=True,
            verbose=1,
        ),
        keras.callbacks.CSVLogger(str(run_dir / "history.csv")),
    ]

    logger.info(
        "Training for up to %d epochs (early stopping patience=5)...", epochs
    )
    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=epochs,
        callbacks=callbacks,
        verbose=1,
    )

    final_val_acc = history.history["val_accuracy"][-1]
    logger.info("Training complete. Final val_accuracy: %.4f", final_val_acc)
    logger.info("Best model saved to: %s", best_path)
    logger.info(
        "Next step: python model-training/export/export_disambig.py"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train Keras disambig model (per-char-classification or seq2seq)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without training.",
    )
    parser.add_argument(
        "--seq2seq",
        action="store_true",
        help=(
            "Force seq2seq architecture regardless of measure_error_types.py output. "
            "Default: auto-detect from measure_error_types.py."
        ),
    )
    parser.add_argument(
        "--per-char",
        action="store_true",
        help="Force per-char-classification architecture.",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=30,
        help="Max training epochs (default: 30; early stopping may trigger sooner).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Batch size (default: 64).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=RANDOM_SEED,
        help=f"Random seed (default: {RANDOM_SEED}).",
    )
    args = parser.parse_args()

    log_dir = RUNS_ROOT / "disambig"
    logger = setup_logging(log_dir)

    # Determine architecture
    if args.seq2seq:
        architecture = "seq2seq"
        logger.info("Architecture forced to seq2seq via --seq2seq flag.")
    elif args.per_char:
        architecture = "per-char-classification"
        logger.info("Architecture forced to per-char-classification via --per-char flag.")
    else:
        if not args.dry_run and OCR_PAIRS_PATH.exists():
            logger.info("Auto-detecting architecture from measure_error_types.py ...")
            architecture = detect_architecture()
            logger.info("Detected architecture: %s", architecture)
        else:
            architecture = "per-char-classification"
            logger.info(
                "Using default architecture: %s (OCR pairs not yet available or dry-run)",
                architecture,
            )

    if not args.dry_run and not OCR_PAIRS_PATH.exists():
        logger.error(
            "OCR pairs file not found: %s\nRun render_ocr_pairs.py first.", OCR_PAIRS_PATH
        )
        sys.exit(1)

    train(
        architecture=architecture,
        epochs=args.epochs,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        logger=logger,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
