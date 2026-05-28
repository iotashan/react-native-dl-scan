#pragma once

// C ABI bridge for dlscan::find_aamva_token / find_all_aamva_tokens.
// Callable from:
//   - Swift via Cxx / C interop (Swift speaks the C ABI directly; std::regex
//     and std::string_view aren't yet round-trip safe through Cxx interop,
//     so the C ABI is the safer migration path).
//   - Android JNI via a thin extern "C" wrapper (no C++ name mangling).
//
// Lifetime: the caller owns an opaque handle and MUST call
// dlscan_aamva_delete exactly once per dlscan_aamva_new. Token output
// strings (value, raw_index) are stored on the handle and remain valid
// only until the NEXT call on the same handle, or until delete. Index
// and raw_index are also copied into fixed-size char[8] fields on the
// struct (sufficient for any AAMVA index: max is "9a" = 2 chars + null).
// Label is a pointer into static program storage (label-pool strings are
// compile-time constants), so its lifetime is the program's.
//
// v2 Sequence E — task #53.

#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/// Opaque handle owning per-call result storage. Not thread-safe.
///
/// IMPORTANT: the C ABI also touches process-global state (the static
/// label intern pool used to back AamvaToken.label). Per-thread handles
/// are NOT sufficient — all C ABI calls from any handle must be
/// externally serialized across the entire process. Guard with a
/// single caller-side lock (the iOS wrapper uses a shared NSLock; the
/// Android JNI bridge does not go through this C ABI at all).
///
/// round-2 doc fix: prior comment said "one handle per thread"
/// which is incorrect given the shared intern pool.
typedef void* dlscan_aamva_handle;

/// Flat token shape passed across the C ABI. Designed to be walked as a
/// simple array on both Swift and JNI sides without parallel-array
/// co-iteration.
typedef struct dlscan_aamva_token_c {
    /// Canonicalized AAMVA index, null-terminated. Max 3 chars (e.g. "4d").
    char index[8];
    /// Pre-canonicalize raw bytes from OCR, null-terminated. Max 3 chars.
    char raw_index[8];
    /// Visible label (UPPERCASE) found between index and value. Points
    /// into static label-pool storage; nullptr if no label was matched.
    /// Never owned by the caller.
    const char* label;
    /// Trimmed value text after index (and label, if present). Null-
    /// terminated. Points into handle-owned storage; INVALIDATED on the
    /// next find/find_all call on the same handle, or on delete. Copy if
    /// needed beyond that.
    const char* value;
    /// Byte offset (inclusive) of the full token's start in the source.
    size_t range_begin;
    /// Byte offset (EXCLUSIVE) of the full token's end in the source.
    size_t range_end;
} dlscan_aamva_token_c;

/// Create a new handle. Returns nullptr on allocation failure.
dlscan_aamva_handle dlscan_aamva_new(void);

/// Destroy a handle. Idempotent on nullptr. UB on use-after-free.
void dlscan_aamva_delete(dlscan_aamva_handle handle);

/// Find all AAMVA tokens in [text, text + text_len). Fills up to
/// [capacity] entries into out_tokens and returns the real count. If
/// real_count > capacity the caller should reallocate and retry.
///
/// Output string pointers (token.value) remain valid until the next
/// dlscan_aamva_find_all / dlscan_aamva_find_one call on the same
/// handle, or until dlscan_aamva_delete. token.label points into
/// program-static storage and is valid for the program's lifetime.
///
/// Returns 0 on null handle or null text. text_len may be 0.
size_t dlscan_aamva_find_all(
    dlscan_aamva_handle handle,
    const char* text,
    size_t text_len,
    dlscan_aamva_token_c* out_tokens,
    size_t capacity);

/// Find the first AAMVA token at-or-after start_index in [text, text+text_len).
/// Returns 1 on found (fills out_token), 0 on not found. Same lifetime
/// contract as dlscan_aamva_find_all.
int dlscan_aamva_find_one(
    dlscan_aamva_handle handle,
    const char* text,
    size_t text_len,
    size_t start_index,
    dlscan_aamva_token_c* out_token);

/// Gate (b) of demographic parser: is `label` compatible with `canonical_index`?
/// Both strings are null-terminated. Returns 0 on no match / nulls / unknowns,
/// 1 on match. Case-insensitive on label.
int dlscan_aamva_is_compatible_label(
    const char* canonical_index,
    const char* label);

/// Gate (c) of demographic parser: does `value` (length-prefixed) match
/// the expected-domain regex for `canonical_index`? Returns 1 on match,
/// 0 on miss / unknowns / nulls.
int dlscan_aamva_value_matches_domain(
    const char* value,
    size_t value_len,
    const char* canonical_index);

/// Cleaned-value variant: writes the matched substring into out_buf (up
/// to out_capacity - 1 bytes + null terminator) and stores the required
/// length (excluding null) into *out_written. Returns 1 on match, 0 on
/// miss. If out_buf is null or out_capacity is 0, the function still
/// reports the match status and required length so callers can size
/// their buffer.
int dlscan_aamva_clean_value_to_domain(
    const char* value,
    size_t value_len,
    const char* canonical_index,
    char* out_buf,
    size_t out_capacity,
    size_t* out_written);

/// Canonicalize an OCR-recognized index substring. Writes lowercase
/// (with WI 46→4d alias) into out_buf, null-terminated. Returns the
/// number of bytes written (excluding null). Pass out_capacity = 0 to
/// query the required length. out_buf may be nullptr only when
/// out_capacity is 0.
size_t dlscan_aamva_canonicalize_index(
    const char* raw,
    size_t raw_len,
    char* out_buf,
    size_t out_capacity);

#ifdef __cplusplus
}  // extern "C"
#endif
