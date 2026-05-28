#include "aamva/aamva_lexer_c.hpp"
#include "aamva/aamva_lexer.hpp"

#include <algorithm>
#include <cstring>
#include <new>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

// Static label pool: maps a label string to a stable program-lifetime
// pointer that the C ABI can hand back without lifetime concerns. The
// pool is keyed by the label content, so the same label always resolves
// to the same pointer (handy for == on the Swift / Kotlin side).
const char* label_pool_intern(const std::string& label) {
    if (label.empty()) return nullptr;
    static std::unordered_map<std::string, std::string> pool;
    auto it = pool.find(label);
    if (it != pool.end()) return it->second.c_str();
    auto inserted = pool.emplace(label, label);
    return inserted.first->second.c_str();
}

struct CHandle {
    // Strings backing the last result's `value` pointers. Index per token
    // matches indices in lastTokens. Held until the next call mutates.
    std::vector<std::string> lastValues;
    // Owned token records so callers don't have to allocate.
    std::vector<dlscan::AamvaToken> lastTokens;
};

inline CHandle* as_handle(dlscan_aamva_handle h) {
    return static_cast<CHandle*>(h);
}

// Copy a std::string into a fixed-size, null-terminated char array.
template <std::size_t N>
void copy_fixed(char (&dst)[N], const std::string& src) {
    const std::size_t n = std::min<std::size_t>(src.size(), N - 1);
    std::memcpy(dst, src.data(), n);
    dst[n] = '\0';
}

// Fill an output token struct from a C++ AamvaToken plus the handle-owned
// value string for that slot.
void fill_token_c(dlscan_aamva_token_c& out,
                  const dlscan::AamvaToken& tok,
                  const std::string& valueStorage) {
    copy_fixed(out.index, tok.index);
    copy_fixed(out.raw_index, tok.raw_index);
    out.label = tok.has_label ? label_pool_intern(tok.label) : nullptr;
    out.value = valueStorage.c_str();
    out.range_begin = tok.range_begin;
    out.range_end = tok.range_end;
}

}  // namespace

extern "C" {

dlscan_aamva_handle dlscan_aamva_new(void) {
    try {
        return new CHandle();
    } catch (const std::bad_alloc&) {
        return nullptr;
    }
}

void dlscan_aamva_delete(dlscan_aamva_handle handle) {
    delete as_handle(handle);
}

size_t dlscan_aamva_find_all(
    dlscan_aamva_handle handle,
    const char* text,
    size_t text_len,
    dlscan_aamva_token_c* out_tokens,
    size_t capacity) {
    auto* h = as_handle(handle);
    if (h == nullptr || (text == nullptr && text_len > 0)) return 0;

    std::string_view view(text == nullptr ? "" : text, text_len);
    h->lastTokens = dlscan::find_all_aamva_tokens(view);

    // Materialise value strings up-front so c_str() pointers don't
    // dangle as the vector reallocates between push_backs.
    h->lastValues.clear();
    h->lastValues.reserve(h->lastTokens.size());
    for (const auto& t : h->lastTokens) {
        h->lastValues.push_back(t.value);
    }

    const size_t n = h->lastTokens.size();
    const size_t writeCount = (n < capacity) ? n : capacity;
    if (out_tokens != nullptr) {
        for (size_t i = 0; i < writeCount; ++i) {
            fill_token_c(out_tokens[i], h->lastTokens[i], h->lastValues[i]);
        }
    }
    return n;
}

int dlscan_aamva_find_one(
    dlscan_aamva_handle handle,
    const char* text,
    size_t text_len,
    size_t start_index,
    dlscan_aamva_token_c* out_token) {
    auto* h = as_handle(handle);
    if (h == nullptr || out_token == nullptr) return 0;
    if (text == nullptr && text_len > 0) return 0;

    std::string_view view(text == nullptr ? "" : text, text_len);
    auto found = dlscan::find_aamva_token(view, start_index);
    if (!found) {
        h->lastValues.clear();
        h->lastTokens.clear();
        return 0;
    }
    // Stash result inside the handle for stable c_str() lifetime.
    h->lastTokens.clear();
    h->lastTokens.push_back(std::move(*found));
    h->lastValues.clear();
    h->lastValues.push_back(h->lastTokens[0].value);
    fill_token_c(*out_token, h->lastTokens[0], h->lastValues[0]);
    return 1;
}

int dlscan_aamva_is_compatible_label(
    const char* canonical_index,
    const char* label) {
    if (canonical_index == nullptr || label == nullptr) return 0;
    return dlscan::is_compatible_label(canonical_index, label) ? 1 : 0;
}

int dlscan_aamva_value_matches_domain(
    const char* value,
    size_t value_len,
    const char* canonical_index) {
    if (canonical_index == nullptr) return 0;
    if (value == nullptr && value_len > 0) return 0;
    std::string_view v(value == nullptr ? "" : value, value_len);
    return dlscan::value_matches_domain(v, canonical_index) ? 1 : 0;
}

int dlscan_aamva_clean_value_to_domain(
    const char* value,
    size_t value_len,
    const char* canonical_index,
    char* out_buf,
    size_t out_capacity,
    size_t* out_written) {
    if (out_written != nullptr) *out_written = 0;
    if (canonical_index == nullptr) return 0;
    if (value == nullptr && value_len > 0) return 0;

    std::string_view v(value == nullptr ? "" : value, value_len);
    auto cleaned = dlscan::clean_value_to_domain(v, canonical_index);
    if (!cleaned) return 0;

    const size_t len = cleaned->size();
    if (out_written != nullptr) *out_written = len;
    if (out_buf != nullptr && out_capacity > 0) {
        const size_t n = std::min<size_t>(len, out_capacity - 1);
        std::memcpy(out_buf, cleaned->data(), n);
        out_buf[n] = '\0';
    }
    return 1;
}

size_t dlscan_aamva_canonicalize_index(
    const char* raw,
    size_t raw_len,
    char* out_buf,
    size_t out_capacity) {
    if (raw == nullptr && raw_len > 0) return 0;
    std::string_view v(raw == nullptr ? "" : raw, raw_len);
    std::string canon = dlscan::aamva_canonicalize_index(v);
    const size_t len = canon.size();
    if (out_buf != nullptr && out_capacity > 0) {
        const size_t n = std::min<size_t>(len, out_capacity - 1);
        std::memcpy(out_buf, canon.data(), n);
        out_buf[n] = '\0';
    }
    return len;
}

}  // extern "C"
