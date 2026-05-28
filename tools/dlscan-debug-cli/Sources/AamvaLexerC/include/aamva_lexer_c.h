/*
 * C-compat header for SwiftPM clang-modulemap import.
 *
 * The canonical declarations live in cpp/aamva/aamva_lexer_c.hpp, which
 * uses C++ headers (<cstddef>, <cstdint>) because the iOS production
 * pod compiles every translation unit as C++. The SwiftPM modulemap
 * imports headers in C mode by default, so we provide this thin C-style
 * shim that includes C-flavoured headers and forwards the rest by
 * including the canonical .hpp inside a __cplusplus guard.
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
/* When compiled as C++ (the cpp/aamva_lexer_c.cpp impl side) include
 * the real header so the prototypes match. */
#include "aamva_lexer_c.hpp"
#else
/* C / Swift consumers see the prototypes directly. Kept byte-for-byte
 * identical to the extern "C" block in aamva_lexer_c.hpp. */

typedef void* dlscan_aamva_handle;

typedef struct dlscan_aamva_token_c {
    char index[8];
    char raw_index[8];
    const char* label;
    const char* value;
    size_t range_begin;
    size_t range_end;
} dlscan_aamva_token_c;

dlscan_aamva_handle dlscan_aamva_new(void);
void dlscan_aamva_delete(dlscan_aamva_handle handle);

size_t dlscan_aamva_find_all(
    dlscan_aamva_handle handle,
    const char* text,
    size_t text_len,
    dlscan_aamva_token_c* out_tokens,
    size_t capacity);

int dlscan_aamva_find_one(
    dlscan_aamva_handle handle,
    const char* text,
    size_t text_len,
    size_t start_index,
    dlscan_aamva_token_c* out_token);

int dlscan_aamva_is_compatible_label(
    const char* canonical_index,
    const char* label);

int dlscan_aamva_value_matches_domain(
    const char* value,
    size_t value_len,
    const char* canonical_index);

int dlscan_aamva_clean_value_to_domain(
    const char* value,
    size_t value_len,
    const char* canonical_index,
    char* out_buf,
    size_t out_capacity,
    size_t* out_written);

size_t dlscan_aamva_canonicalize_index(
    const char* raw,
    size_t raw_len,
    char* out_buf,
    size_t out_capacity);

#endif /* __cplusplus */
