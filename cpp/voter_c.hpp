#pragma once

// C ABI bridge for dlscan::FieldVoter. Designed to be callable from:
//   - Swift via Cxx interop (Swift speaks the C ABI directly)
//   - Android JNI via a thin extern "C" wrapper (no C++ name mangling,
//     no ABI brittleness vs raw C++ JNI)
//
// All functions are reentrancy-safe (the underlying FieldVoter holds an
// internal std::mutex). Pointer arguments must not be null unless noted.
//
// Lifetime contract: the caller owns the opaque handle and MUST call
// dlscan_voter_delete exactly once per dlscan_voter_new. Reusing a deleted
// handle is undefined behaviour (matches std::unique_ptr semantics).
//
// Wire format for accept() / consensus(): parallel arrays per review
// round-2 lock. Both ends agree on the array length; nullable optional
// values use sentinel values (NaN for floats, INT_MIN for frameIndex).
//
// v2 Sequence D — task #52.

#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/// Opaque voter handle. Pointer to a heap-allocated dlscan::FieldVoter
/// (owned by the C++ side). Never dereference from a non-C++ caller.
typedef void* dlscan_voter_handle;

/// Create a new voter with the given per-bucket FIFO size and per-bucket
/// minimum winning vote count. Pass 0 to use defaults (20 max, 2 min).
/// Returns nullptr on allocation failure.
dlscan_voter_handle dlscan_voter_new(int maxVotes, int minVotes);

/// Destroy a voter handle. Idempotent on nullptr; UB on use-after-free.
void dlscan_voter_delete(dlscan_voter_handle handle);

/// Drop all accumulated state. No-op on nullptr.
void dlscan_voter_reset(dlscan_voter_handle handle);

/// Number of distinct (FieldId, FieldSource) buckets currently in the
/// voter. Diagnostic only; not on the hot path. Returns 0 on nullptr.
size_t dlscan_voter_bucket_count(dlscan_voter_handle handle);

/// Push one frame's candidates. Arrays MUST have equal length [count].
/// Each candidate is constructed from:
///   id          = fieldIds[i]    (cast to FieldId)
///   source      = sources[i]     (cast to FieldSource)
///   text        = texts[i]       (UTF-8 C-string; nullptr/empty → skipped)
/// Optional metadata (-1.0f or INT_MIN sentinel = nullopt):
///   ocrConfidence       = ocrConf[i]
///   detectorConfidence  = detectorConf[i]
///   iou                 = iou[i]
///   frameIndex          = frameIndex[i]
///
/// Pass null for entire arrays that aren't needed (e.g. ocrConf=nullptr
/// means all candidates have no ocrConfidence). Per-element opt-out is
/// the sentinel; whole-array opt-out is nullptr.
void dlscan_voter_accept(
    dlscan_voter_handle handle,
    size_t count,
    const int* fieldIds,
    const int* sources,
    const char* const* texts,
    const float* ocrConf,
    const float* detectorConf,
    const float* iou,
    const int* frameIndex);

/// Compute consensus. Caller pre-allocates parallel out-arrays of size
/// [capacity]; the function writes up to [capacity] consensus candidates
/// and returns the count written. If the real count exceeds [capacity],
/// the function still returns the real count and writes [capacity]
/// entries — the caller should reallocate and retry. Returns 0 on nullptr.
///
/// outTexts is an array of C-string buffers; each buffer's pointer
/// remains valid until the next call to dlscan_voter_consensus or
/// dlscan_voter_delete on the same handle (the strings live inside the
/// voter's internal state, not the caller's memory). Treat them as
/// borrowed pointers — copy if you need to outlive the next call.
///
/// Sentinels in optional out-arrays: -1.0f for floats, INT_MIN for
/// frameIndex. Out-arrays may be nullptr if the caller doesn't need the
/// corresponding metadata.
size_t dlscan_voter_consensus(
    dlscan_voter_handle handle,
    size_t capacity,
    int* outFieldIds,
    int* outSources,
    const char** outTexts,
    float* outOcrConf,
    float* outDetectorConf,
    float* outIou,
    int* outFrameIndex);

// v2 Sequence G — the legacy dlscan_voter_accept_legacy /
// dlscan_voter_consensus_legacy functions (string-keyed map shape with
// "_strict" suffix encoding) are DELETED. Use the typed accept/consensus
// above with parallel FieldId / FieldSource int arrays.

#ifdef __cplusplus
}  // extern "C"
#endif
