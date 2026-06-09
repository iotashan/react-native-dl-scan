import Foundation
#if canImport(AamvaLexerC)
// The macOS debug CLI links the C ABI via a dedicated SwiftPM C++ target
// (tools/dlscan-debug-cli/Sources/AamvaLexerC). In the iOS production
// build the C ABI is exposed via the pod's module map; no import needed.
//
// Task #70: `internal import` is the Swift 5.9+ replacement for
// `@_implementationOnly` (SE-0409). The latter emits a deprecation
// warning in any module not built with library-evolution mode, which
// the DLScanDebugCore SwiftPM library target is not. The new attribute
// hides AamvaLexerC from this module's ABI without that caveat.
// Compiler-version-gated for safety on older toolchains; the upcoming-
// feature flag is also enabled in the SwiftPM target's swiftSettings.
#if compiler(>=5.9)
internal import AamvaLexerC
#else
@_implementationOnly import AamvaLexerC
#endif
#endif

/// AAMVA D-20 / DL-AID-005-3 visible-field lexer — iOS Swift wrapper.
///
/// Public surface stays identical to the previous Swift-native impl; the
/// implementation now forwards to the shared C++ lexer at
/// `cpp/aamva/aamva_lexer.hpp` via the C ABI in
/// `cpp/aamva/aamva_lexer_c.hpp`. State machine, regex patterns, and
/// round-5/6 invariants live in C++ — see aamva_lexer.hpp for the
/// invariant list and the 51-test parity suite.
///
/// ASCII input precondition: byte offsets returned by the C ABI map
/// directly to String.utf8 indices, which are then bridged back to
/// String.Index for callers that previously used Range<String.Index>.
/// Non-ASCII OCR is filtered before tokens reach this layer.
///
/// v2 Sequence E — task #53.

struct AamvaToken {
    /// Canonicalized AAMVA index, e.g. "1", "4d", "16".
    let index: String
    /// Visible label found between index and value, e.g. "HGT", or nil.
    let label: String?
    /// Trimmed value text after index (and label, if present).
    let value: String
    /// Character range in the source string covered by this token.
    /// Backed by utf8 byte offsets from the C++ lexer; correct for ASCII.
    let range: Range<String.Index>
    /// Exactly what OCR produced for the index, pre-canonicalize.
    let rawIndex: String
}

enum AamvaLexer {

    /// Find the first AAMVA token at-or-after `startIndex` in `text`.
    static func findAamvaToken(in text: String, startIndex: Int = 0) -> AamvaToken? {
        guard let handle = LexerHandle.shared.borrow() else { return nil }
        defer { LexerHandle.shared.release() }
        return text.withCString { cstr -> AamvaToken? in
            var out = dlscan_aamva_token_c()
            let textLen = strlen(cstr)
            let found = dlscan_aamva_find_one(
                handle,
                cstr,
                textLen,
                size_t(startIndex),
                &out)
            return found != 0 ? convertToken(out, source: text) : nil
        }
    }

    /// Find all AAMVA tokens in `text`, in textual order.
    static func findAllAamvaTokens(in text: String) -> [AamvaToken] {
        guard let handle = LexerHandle.shared.borrow() else { return [] }
        defer { LexerHandle.shared.release() }
        return text.withCString { cstr -> [AamvaToken] in
            let textLen = strlen(cstr)
            // 32 covers any realistic single-observation token count;
            // re-allocates if the lexer reports more.
            var buf = [dlscan_aamva_token_c](repeating: dlscan_aamva_token_c(),
                                              count: 32)
            var count = dlscan_aamva_find_all(handle, cstr, textLen,
                                              &buf, buf.count)
            if count > buf.count {
                buf = [dlscan_aamva_token_c](repeating: dlscan_aamva_token_c(),
                                              count: count)
                count = dlscan_aamva_find_all(handle, cstr, textLen,
                                              &buf, buf.count)
            }
            var out: [AamvaToken] = []
            out.reserveCapacity(count)
            for i in 0..<count {
                out.append(convertToken(buf[i], source: text))
            }
            return out
        }
    }

    /// Gate (b) check used by the demographic parser.
    static func isCompatibleLabel(canonicalIndex: String, label: String?) -> Bool {
        guard let label else { return false }
        return canonicalIndex.withCString { idx in
            label.withCString { lbl in
                dlscan_aamva_is_compatible_label(idx, lbl) != 0
            }
        }
    }

    /// Gate (c): does `value` match the expected-domain regex for `domainKey`?
    static func valueMatchesDomain(_ value: String, domainKey: String) -> Bool {
        return value.withCString { v in
            domainKey.withCString { k in
                let n = strlen(v)
                return dlscan_aamva_value_matches_domain(v, n, k) != 0
            }
        }
    }

    // MARK: - Internals

    /// Per-thread handle pool. The handle owns last-call value strings;
    /// we copy them into Swift String inside `convertToken` before the
    /// next call invalidates them, so a single shared handle per thread
    /// is enough. The wrapper is reentrancy-safe by virtue of the copy.
    private final class LexerHandle {
        static let shared = LexerHandle()
        private let lock = NSLock()
        private var handle: UnsafeMutableRawPointer?

        func borrow() -> UnsafeMutableRawPointer? {
            lock.lock()
            if handle == nil {
                handle = dlscan_aamva_new()
            }
            return handle
        }
        func release() {
            lock.unlock()
        }
    }

    /// Convert a C struct token into a Swift AamvaToken. Copies value and
    /// rawIndex into native Swift Strings before the handle's storage
    /// can be invalidated by the next call.
    private static func convertToken(_ c: dlscan_aamva_token_c,
                                     source text: String) -> AamvaToken {
        var indexCopy = c.index
        let indexStr = withUnsafePointer(to: &indexCopy) { ptr -> String in
            ptr.withMemoryRebound(to: CChar.self,
                                  capacity: MemoryLayout.size(ofValue: c.index)) {
                String(cString: $0)
            }
        }
        var rawCopy = c.raw_index
        let rawStr = withUnsafePointer(to: &rawCopy) { ptr -> String in
            ptr.withMemoryRebound(to: CChar.self,
                                  capacity: MemoryLayout.size(ofValue: c.raw_index)) {
                String(cString: $0)
            }
        }
        let labelStr: String? = c.label.map { String(cString: $0) }
        let valueStr: String = c.value.map { String(cString: $0) } ?? ""

        // ASCII precondition: byte offsets in `range_begin/range_end`
        // are utf8-offset indices into `text`, equivalent to character
        // indices because OCR-filtered input is single-byte ASCII.
        let u8 = text.utf8
        let lo = u8.index(u8.startIndex, offsetBy: Int(c.range_begin),
                          limitedBy: u8.endIndex) ?? u8.endIndex
        let hi = u8.index(u8.startIndex, offsetBy: Int(c.range_end),
                          limitedBy: u8.endIndex) ?? u8.endIndex
        let range = Range(uncheckedBounds: (
            lower: String.Index(lo, within: text) ?? text.startIndex,
            upper: String.Index(hi, within: text) ?? text.endIndex))

        return AamvaToken(
            index: indexStr,
            label: labelStr,
            value: valueStr,
            range: range,
            rawIndex: rawStr)
    }
}
