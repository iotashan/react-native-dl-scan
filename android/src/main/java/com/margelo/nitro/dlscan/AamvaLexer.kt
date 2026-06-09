package com.margelo.nitro.dlscan

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * AAMVA D-20 / DL-AID-005-3 visible-field lexer — Kotlin wrapper.
 *
 * Forwards to the shared C++ lexer at `cpp/aamva/aamva_lexer.{hpp,cpp}`
 * via the [DLScanLexerBridge] JNI bridge. The C++ side is the single
 * source of truth for token recognition; the round-5/6 invariants
 * (digits-only index, alphanumeric boundary, trailing-digit reject,
 * label-peek value-end scan, etc.) live there and are pinned by the
 * 51-case `cpp/tests/aamva_lexer_test.cpp` suite.
 *
 * v2 Sequence E — task #53.
 */

internal data class AamvaToken(
    /** Canonicalized AAMVA index, e.g. "1", "4d", "16". */
    val index: String,
    /** Visible label found between index and value, e.g. "HGT", or null. */
    val label: String?,
    /** Trimmed value text after index (and label, if present). */
    val value: String,
    /** Character range in the source string covered by this token.
     *  Range end is EXCLUSIVE; IntRange.last == range_end - 1. */
    val range: IntRange,
    /** Exactly what OCR produced for the index, pre-canonicalize. */
    val rawIndex: String,
)

internal object AamvaLexer {

    /** Find the first AAMVA token at-or-after [startIndex] in [text]. */
    fun findAamvaToken(text: String, startIndex: Int = 0): AamvaToken? {
        val flat = DLScanLexerBridge.nativeFindOne(text, startIndex) ?: return null
        return parseToken(flat, 0)
    }

    /** Find all AAMVA tokens in [text], in textual order. */
    fun findAllAamvaTokens(text: String): List<AamvaToken> {
        val flat = DLScanLexerBridge.nativeFindAll(text) ?: return emptyList()
        val n = flat.size / 6
        if (n == 0) return emptyList()
        val out = ArrayList<AamvaToken>(n)
        for (i in 0 until n) {
            out += parseToken(flat, i * 6)
        }
        return out
    }

    /** Gate (b) check used by the demographic parser. */
    fun isCompatibleLabel(canonicalIndex: String, label: String?): Boolean {
        if (label == null) return false
        return DLScanLexerBridge.nativeIsCompatibleLabel(canonicalIndex, label)
    }

    /** Gate (c) check used by the demographic parser. */
    fun valueMatchesDomain(value: String, canonicalIndex: String): Boolean {
        return DLScanLexerBridge.nativeValueMatchesDomain(value, canonicalIndex)
    }

    /** Read 6 strings starting at [base] into an AamvaToken. */
    private fun parseToken(flat: Array<String>, base: Int): AamvaToken {
        val index    = flat[base + 0]
        val rawIndex = flat[base + 1]
        val labelStr = flat[base + 2]
        val value    = flat[base + 3]
        val begin    = flat[base + 4].toInt()
        val end      = flat[base + 5].toInt()  // EXCLUSIVE
        return AamvaToken(
            index = index,
            label = if (labelStr.isEmpty()) null else labelStr,
            value = value,
            range = begin until end,           // IntRange is INCLUSIVE..INCLUSIVE,
                                               // `until` builds [begin, end-1].
            rawIndex = rawIndex,
        )
    }
}

/**
 * JNI bridge for the shared C++ lexer. Declared as a standalone object
 * so the external-fun symbols don't collide with HybridDLScanAndroid's,
 * and so callers don't have to instantiate Hybrid* just to lex text.
 *
 * Library is loaded by [HybridDLScanAndroid] (also via System.loadLibrary
 * elsewhere); this object piggybacks on whichever loader fires first.
 * The JNI symbols are mangled as
 * `Java_com_margelo_nitro_dlscan_DLScanLexerBridge_native*`.
 *
 * Wire format (see cpp/dlscan_jni_bridge.cpp): each token is six
 * consecutive strings — index, rawIndex, label-or-empty, value,
 * rangeBeginStr, rangeEndStr-exclusive.
 */
@DoNotStrip
@Keep
internal object DLScanLexerBridge {
    @DoNotStrip @Keep external fun nativeFindAll(text: String): Array<String>?
    @DoNotStrip @Keep external fun nativeFindOne(text: String, startIndex: Int): Array<String>?
    @DoNotStrip @Keep external fun nativeIsCompatibleLabel(
        canonicalIndex: String, label: String): Boolean
    @DoNotStrip @Keep external fun nativeValueMatchesDomain(
        value: String, canonicalIndex: String): Boolean
}
