/**
 * dlscan_jni_bridge.cpp
 *
 * JNI entry points called by Kotlin's `external fun` declarations in
 * HybridDlScanAndroid.  The functions bridge between the Kotlin world and the
 * shared C++ core (aamva_parser / ocr_field_extractor).
 *
 * Build: added to the DlScan shared library via CMakeLists.txt so it shares
 * the same .so as the nitrogen-generated JNI bindings and the C++ core.
 *
 * Threading: Both functions are called from worker threads managed by the
 * Kotlin side; no additional synchronization is needed in C++.
 */

#include <jni.h>
#include <fbjni/fbjni.h>
#include <algorithm>
#include <string>
#include <vector>

// C++ parsing core
#include "aamva_parser.hpp"
#include "aamva_lexer.hpp"
#include "license_data.hpp"
#include "ocr_field_extractor.hpp"
#include "voter.hpp"
#include "yolo/field_classes.hpp"
#include "detect/detect_c.hpp"  // JS-orchestrated fast-tflite C-ABI

// Nitro/nitrogen-generated bridges
#include "LicenseDataSpec.hpp"
#include "JLicenseDataSpec.hpp"
#include "Sex.hpp"
#include "DocumentType.hpp"
#include "MRZDataSpec.hpp"
#include "MRZTypeSpec.hpp"

namespace dlscan_jni {

using namespace facebook;
using NitroSpec         = margelo::nitro::dlscan::LicenseDataSpec;
using NitroSex          = margelo::nitro::dlscan::Sex;
using NitroDocType      = margelo::nitro::dlscan::DocumentType;
using NitroMRZDataSpec  = margelo::nitro::dlscan::MRZDataSpec;
using NitroMRZType      = margelo::nitro::dlscan::MRZTypeSpec;

/**
 * Convert dlscan::LicenseData (C++ core POD) → margelo::nitro::dlscan::LicenseDataSpec
 * (Nitro struct used by the generated JNI bridge).
 *
 * Field order mirrors LicenseDataSpec's explicit constructor so we can use
 * named-field assignment and stay robust to future reordering.
 */
static NitroSpec toNitroSpec(const dlscan::LicenseData& ld) {
    NitroSpec s;

    s.firstName      = ld.firstName;
    s.lastName       = ld.lastName;
    s.middleName     = ld.middleName;
    s.licenseNumber  = ld.licenseNumber;
    s.dateOfBirth    = ld.dateOfBirth;
    s.expirationDate = ld.expirationDate;
    s.issueDate      = ld.issueDate;
    s.street         = ld.street;
    s.city           = ld.city;
    s.state          = ld.state;
    s.postalCode     = ld.postalCode;
    s.country        = ld.country;
    s.eyeColor       = ld.eyeColor;
    s.hairColor      = ld.hairColor;
    s.height         = ld.height;
    s.weight         = ld.weight;
    s.vehicleClass   = ld.vehicleClass;
    s.restrictions   = ld.restrictions;
    s.endorsements   = ld.endorsements;

    // sex: dlscan stores std::optional<std::string> ("M"/"F"/"X");
    // Nitro stores std::optional<Sex> enum.
    if (ld.sex.has_value()) {
        if      (*ld.sex == "M") s.sex = NitroSex::M;
        else if (*ld.sex == "F") s.sex = NitroSex::F;
        else if (*ld.sex == "X") s.sex = NitroSex::X;
        // Unknown values: leave s.sex as std::nullopt.
    }

    // aamvaVersion: dlscan int → Nitro double
    if (ld.aamvaVersion.has_value()) {
        s.aamvaVersion = static_cast<double>(*ld.aamvaVersion);
    }

    // documentType: dlscan::DocumentType → margelo::nitro::dlscan::DocumentType
    if (ld.documentType.has_value()) {
        switch (*ld.documentType) {
            case dlscan::DocumentType::Passport:
                s.documentType = NitroDocType::PASSPORT; break;
            case dlscan::DocumentType::NationalId:
                s.documentType = NitroDocType::NATIONAL_ID; break;
            case dlscan::DocumentType::ResidencePermit:
                s.documentType = NitroDocType::RESIDENCE_PERMIT; break;
            case dlscan::DocumentType::DriverLicense:
                s.documentType = NitroDocType::DRIVER_LICENSE; break;
            default:
                s.documentType = NitroDocType::UNKNOWN; break;
        }
    }

    // fieldConfidence: map<string, float> → JSON string via shared C++
    // dlscan::confidence_json(). Task #38; Nitro v0.35 generics on
    // Map<string,number> don't round-trip cleanly through Cxx, so we
    // transport as a JSON string and decode JS-side.
    std::string conf = dlscan::confidence_json(ld);
    if (!conf.empty()) {
        s.dataConfidenceJson = conf;
    }

    // mrz: dlscan::MRZData → margelo::nitro::dlscan::MRZDataSpec
    if (ld.mrz.has_value()) {
        const auto& m = *ld.mrz;
        NitroMRZDataSpec mrzSpec;

        // MRZType
        switch (m.mrzType) {
            case dlscan::MRZType::TD1: mrzSpec.mrzType = NitroMRZType::TD1; break;
            case dlscan::MRZType::TD2: mrzSpec.mrzType = NitroMRZType::TD2; break;
            default:                  mrzSpec.mrzType = NitroMRZType::TD3; break;
        }

        mrzSpec.documentCode        = m.documentCode;
        mrzSpec.issuingState        = m.issuingState;
        mrzSpec.documentNumber      = m.documentNumber;
        mrzSpec.primaryIdentifier   = m.primaryIdentifier;
        mrzSpec.secondaryIdentifier = m.secondaryIdentifier;
        mrzSpec.nationality         = m.nationality;
        mrzSpec.dateOfBirth         = m.dateOfBirth;
        mrzSpec.dateOfExpiry        = m.dateOfExpiry;
        mrzSpec.optionalData        = m.optionalData;
        mrzSpec.checkDigitsValid    = m.checkDigitsValid;

        // sex: std::string ("M"/"F"/"X") → NitroSex
        if      (m.sex == "M") mrzSpec.sex = NitroSex::M;
        else if (m.sex == "F") mrzSpec.sex = NitroSex::F;
        else                   mrzSpec.sex = NitroSex::X;

        s.mrz = mrzSpec;
    }

    return s;
}

} // namespace dlscan_jni

// ---------------------------------------------------------------------------
// JNI entry points
//
// Method-name mangling convention:
//   Java_<package_underscored>_<ClassName>_<methodName>
//
// Package:  com.margelo.nitro.dlscan
// Class:    HybridDlScanAndroid
// ---------------------------------------------------------------------------

extern "C" JNIEXPORT jobject JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeParseBarcode(
        JNIEnv* env, jobject /* thiz */, jstring jBarcodeData) {

    if (jBarcodeData == nullptr) return nullptr;

    // jstring → std::string
    const char* utf = env->GetStringUTFChars(jBarcodeData, nullptr);
    if (utf == nullptr) return nullptr;           // OOM in GetStringUTFChars
    std::string data(utf);
    env->ReleaseStringUTFChars(jBarcodeData, utf);

    // Parse via shared C++ core
    auto cppResult = dlscan::parse_aamva(data);
    if (!cppResult.has_value()) {
        return nullptr;                           // Kotlin sees null → NullType variant
    }

    // Convert to Nitro spec and hand off to fbjni bridge.
    // JLicenseDataSpec::fromCpp returns a local_ref<JLicenseDataSpec::javaobject>.
    // Calling .release() transfers ownership of the underlying JNI local ref to
    // the caller (the JVM frame), which is exactly what a JNI method must return.
    auto spec = dlscan_jni::toNitroSpec(*cppResult);
    return margelo::nitro::dlscan::JLicenseDataSpec::fromCpp(spec).release();
}

extern "C" JNIEXPORT jobject JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeExtractOcrFields(
        JNIEnv* env, jobject /* thiz */, jobjectArray jLines) {

    if (jLines == nullptr) return nullptr;

    // String[] → std::vector<std::string>
    std::vector<std::string> lines;
    jsize len = env->GetArrayLength(jLines);
    lines.reserve(static_cast<size_t>(len));
    for (jsize i = 0; i < len; ++i) {
        auto jstr = static_cast<jstring>(env->GetObjectArrayElement(jLines, i));
        if (jstr == nullptr) continue;
        const char* utf = env->GetStringUTFChars(jstr, nullptr);
        if (utf != nullptr) {
            lines.emplace_back(utf);
            env->ReleaseStringUTFChars(jstr, utf);
        }
        env->DeleteLocalRef(jstr);
    }

    auto cppResult = dlscan::extract_ocr_fields(lines);
    if (!cppResult.has_value()) {
        return nullptr;
    }

    auto spec = dlscan_jni::toNitroSpec(*cppResult);
    return margelo::nitro::dlscan::JLicenseDataSpec::fromCpp(spec).release();
}

// ---------------------------------------------------------------------------
// Phase 4 additions — YOLO post-processing + structured field extraction.
// ---------------------------------------------------------------------------

#include "yolo_postprocess.hpp"
#include "field_classes.hpp"
#include <map>
#include <cstring>

/**
 * nativeExtractFieldsCandidates
 *
 * Bridges Kotlin's typed parallel arrays (IntArray fieldIds, IntArray
 * sources, Array<String> texts) into a std::vector<dlscan::FieldCandidate>,
 * then calls dlscan::extract_fields_from_candidates. The typed candidate
 * pipeline replaced the legacy nativeExtractFieldsStructured(keys, values)
 * path in v2 Sequence G (task #54). One typed candidate per detected /
 * strict-parsed field is passed across the JNI boundary.
 *
 * Kotlin signature:
 *   external fun nativeExtractFieldsStructured(keys: Array<String>,
 *                                                values: Array<String>): LicenseDataSpec?
 */
extern "C" JNIEXPORT jobject JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeExtractFieldsCandidates(
        JNIEnv* env, jobject /* thiz */,
        jintArray jFieldIds, jintArray jSources, jobjectArray jTexts) {
    // v2 Sequence G — typed FieldCandidate input. Replaces the legacy
    // nativeExtractFieldsStructured(keys, values) path. Parallel arrays;
    // length mismatch is a Kotlin-side bug. Empty texts are dropped here
    // (matches the legacy FieldsMap skip-empties behavior).
    if (jFieldIds == nullptr || jSources == nullptr || jTexts == nullptr) return nullptr;

    const jsize n = env->GetArrayLength(jFieldIds);
    if (env->GetArrayLength(jSources) != n) return nullptr;
    if (env->GetArrayLength(jTexts) != n) return nullptr;

    jint* fieldIds = env->GetIntArrayElements(jFieldIds, nullptr);
    jint* sources = env->GetIntArrayElements(jSources, nullptr);
    if (fieldIds == nullptr || sources == nullptr) {
        if (fieldIds) env->ReleaseIntArrayElements(jFieldIds, fieldIds, JNI_ABORT);
        if (sources) env->ReleaseIntArrayElements(jSources, sources, JNI_ABORT);
        return nullptr;
    }

    std::vector<dlscan::FieldCandidate> candidates;
    candidates.reserve(static_cast<std::size_t>(n));
    for (jsize i = 0; i < n; ++i) {
        auto id = static_cast<dlscan::FieldId>(fieldIds[i]);
        auto src = static_cast<dlscan::FieldSource>(sources[i]);
        if (id == dlscan::FieldId::Unknown) continue;
        auto jT = (jstring) env->GetObjectArrayElement(jTexts, i);
        if (jT == nullptr) continue;
        const char* tChars = env->GetStringUTFChars(jT, nullptr);
        std::string text(tChars ? tChars : "");
        if (tChars) env->ReleaseStringUTFChars(jT, tChars);
        env->DeleteLocalRef(jT);
        if (text.empty()) continue;
        dlscan::FieldCandidate c;
        c.id = id;
        c.source = src;
        c.text = std::move(text);
        candidates.push_back(std::move(c));
    }
    env->ReleaseIntArrayElements(jFieldIds, fieldIds, JNI_ABORT);
    env->ReleaseIntArrayElements(jSources, sources, JNI_ABORT);

    auto cppResult = dlscan::extract_fields_from_candidates(candidates);
    if (!cppResult.has_value()) return nullptr;

    auto spec = dlscan_jni::toNitroSpec(*cppResult);
    return margelo::nitro::dlscan::JLicenseDataSpec::fromCpp(spec).release();
}

/**
 * nativeClassName
 *
 * Bridge for dlscan::yolo::class_name_or_empty. Returns the canonical YOLO
 * class name for the given index (e.g., 0 -> "birthday", 29 -> "surname")
 * or an empty string for out-of-range. Single source of truth lives in
 * cpp/yolo/field_classes.cpp; do NOT mirror in Kotlin.
 *
 * Kotlin signature:
 *   external fun nativeClassName(classId: Int): String
 */
extern "C" JNIEXPORT jstring JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeClassName(
        JNIEnv* env, jobject /* thiz */, jint jClassId) {
    const char* name = dlscan::yolo::class_name_or_empty(static_cast<int>(jClassId));
    return env->NewStringUTF(name != nullptr ? name : "");
}

/**
 * nativeParseAamvaDemographicFields
 *
 * Bridges the shared C++ marker-anchored demographic parser
 * (dlscan::parse_aamva_demographic_fields) so Kotlin and Swift run the
 * IDENTICAL 4-gate strict-text-pool scan — including the 1-step look-ahead
 * (links a bare "4d" marker to its value on the next OCR observation), the
 * fused-row marker extraction (sex single-[MFX] out of "15 SEX M 18 HOT ..."),
 * and the name-marker-2 trailing-junk strip. Previously this orchestration was
 * duplicated in HybridDlScanAndroid.parseAamvaDemographicFields; it now lives
 * in C++ with one host-unit-test regression (cpp/tests/aamva_demographic_test).
 *
 * Input: Array<String> of OCR observation texts IN READING ORDER (already
 * AAMVA-index-split by the Kotlin splitObservationByAamvaIndices). bbox
 * geometry is not needed for the text-only marker parse.
 *
 * Returns: flat Array<String> of length 3*N, three strings per candidate
 * [fieldIdStr, sourceStr, text] — same wire shape as nativeVoterConsensus.
 * Source is always StrictTextPool (3). Returns null on null input.
 *
 * Kotlin signature:
 *   external fun nativeParseAamvaDemographicFields(texts: Array<String>): Array<String>?
 */
extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeParseAamvaDemographicFields(
        JNIEnv* env, jobject /* thiz */, jobjectArray jTexts) {
    if (jTexts == nullptr) return nullptr;
    const jsize n = env->GetArrayLength(jTexts);
    dlscan::ObservationVector observations;
    observations.reserve(static_cast<std::size_t>(n));
    for (jsize i = 0; i < n; ++i) {
        auto jT = (jstring) env->GetObjectArrayElement(jTexts, i);
        if (jT == nullptr) { observations.emplace_back(); continue; }
        const char* tChars = env->GetStringUTFChars(jT, nullptr);
        observations.emplace_back(tChars ? tChars : "");
        if (tChars) env->ReleaseStringUTFChars(jT, tChars);
        env->DeleteLocalRef(jT);
    }

    const auto candidates = dlscan::parse_aamva_demographic_fields(observations);

    jclass stringCls = env->FindClass("java/lang/String");
    if (stringCls == nullptr) return nullptr;
    jobjectArray out = env->NewObjectArray(
        static_cast<jsize>(candidates.size() * 3), stringCls, nullptr);
    if (out == nullptr) {
        env->DeleteLocalRef(stringCls);
        return nullptr;
    }
    jsize idx = 0;
    for (const auto& c : candidates) {
        jstring jId = env->NewStringUTF(std::to_string(static_cast<int>(c.id)).c_str());
        jstring jSrc = env->NewStringUTF(std::to_string(static_cast<int>(c.source)).c_str());
        jstring jTxt = env->NewStringUTF(c.text.c_str());
        env->SetObjectArrayElement(out, idx++, jId);
        env->SetObjectArrayElement(out, idx++, jSrc);
        env->SetObjectArrayElement(out, idx++, jTxt);
        env->DeleteLocalRef(jId);
        env->DeleteLocalRef(jSrc);
        env->DeleteLocalRef(jTxt);
    }
    env->DeleteLocalRef(stringCls);
    return out;
}


// ============================================================================
// Multi-frame voter (v2 Sequence D + G, tasks #52 / #54). The C++
// FieldVoter is the shared implementation; Kotlin holds a Long handle
// (heap pointer cast to jlong) and routes accept/consensus/reset/new/
// delete through these JNI functions. Wire is fully typed since
// Sequence G — typed FieldId / FieldSource int arrays in accept; flat
// Array<String> with 3 strings per consensus record [fieldIdStr,
// sourceStr, text]. No string keys, no "_strict" suffix encoding.
// ============================================================================

/**
 * Kotlin signature:
 *   external fun nativeVoterNew(maxVotes: Int, minVotes: Int): Long
 *
 * Returns a heap pointer cast to jlong, or 0 on allocation failure.
 */
extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeVoterNew(
        JNIEnv* /* env */, jobject /* thiz */, jint jMaxVotes, jint jMinVotes) {
    try {
        auto* v = new dlscan::FieldVoter(
            jMaxVotes > 0 ? static_cast<std::size_t>(jMaxVotes)
                          : dlscan::FieldVoter::DEFAULT_MAX_VOTES,
            jMinVotes > 0 ? static_cast<std::size_t>(jMinVotes)
                          : dlscan::FieldVoter::DEFAULT_MIN_VOTES);
        return reinterpret_cast<jlong>(v);
    } catch (const std::bad_alloc&) {
        return 0;
    }
}

/**
 * Kotlin signature:
 *   external fun nativeVoterDelete(handle: Long)
 *
 * Safe on handle == 0 (no-op).
 */
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeVoterDelete(
        JNIEnv* /* env */, jobject /* thiz */, jlong jHandle) {
    delete reinterpret_cast<dlscan::FieldVoter*>(jHandle);
}

/**
 * Kotlin signature:
 *   external fun nativeVoterReset(handle: Long)
 */
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeVoterReset(
        JNIEnv* /* env */, jobject /* thiz */, jlong jHandle) {
    auto* v = reinterpret_cast<dlscan::FieldVoter*>(jHandle);
    if (v != nullptr) v->reset();
}

/**
 * Kotlin signature:
 *   external fun nativeVoterAccept(
 *       handle: Long, fieldIds: IntArray, sources: IntArray, texts: Array<String>)
 *
 * Typed parallel arrays — direct (FieldId, FieldSource, text) triples,
 * no string-keyed wire format, no "_strict" suffix encoding. Unknown
 * FieldId / FieldSource values are silently dropped (FieldId::Unknown,
 * FieldSource::Unknown). Empty texts skipped.
 *
 * v2 Sequence G — task #54. Replaces the v1 string-key wire shape.
 */
extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeVoterAccept(
        JNIEnv* env, jobject /* thiz */,
        jlong jHandle,
        jintArray jFieldIds, jintArray jSources, jobjectArray jTexts) {
    auto* v = reinterpret_cast<dlscan::FieldVoter*>(jHandle);
    if (v == nullptr || jFieldIds == nullptr || jSources == nullptr || jTexts == nullptr) return;
    const jsize n = env->GetArrayLength(jFieldIds);
    if (env->GetArrayLength(jSources) != n) return;
    if (env->GetArrayLength(jTexts) != n) return;

    jint* fieldIds = env->GetIntArrayElements(jFieldIds, nullptr);
    jint* sources = env->GetIntArrayElements(jSources, nullptr);
    if (fieldIds == nullptr || sources == nullptr) {
        if (fieldIds) env->ReleaseIntArrayElements(jFieldIds, fieldIds, JNI_ABORT);
        if (sources) env->ReleaseIntArrayElements(jSources, sources, JNI_ABORT);
        return;
    }

    std::vector<dlscan::FieldCandidate> frame;
    frame.reserve(static_cast<std::size_t>(n));
    for (jsize i = 0; i < n; ++i) {
        auto id = static_cast<dlscan::FieldId>(fieldIds[i]);
        auto src = static_cast<dlscan::FieldSource>(sources[i]);
        if (id == dlscan::FieldId::Unknown) continue;
        auto jT = (jstring) env->GetObjectArrayElement(jTexts, i);
        if (jT == nullptr) continue;
        const char* tChars = env->GetStringUTFChars(jT, nullptr);
        std::string text(tChars ? tChars : "");
        if (tChars) env->ReleaseStringUTFChars(jT, tChars);
        env->DeleteLocalRef(jT);
        if (text.empty()) continue;
        dlscan::FieldCandidate c;
        c.id = id;
        c.source = src;
        c.text = std::move(text);
        frame.push_back(std::move(c));
    }
    env->ReleaseIntArrayElements(jFieldIds, fieldIds, JNI_ABORT);
    env->ReleaseIntArrayElements(jSources, sources, JNI_ABORT);
    v->accept(frame);
}

/**
 * Kotlin signature:
 *   external fun nativeVoterConsensus(handle: Long): Array<String>?
 *
 * Returns a flat String[] of length 3*N, three strings per consensus
 * candidate: [fieldIdStr, sourceStr, text]. Ints stringified for transport;
 * the Kotlin side parses them back to FieldId / FieldSource enum values.
 * No "_strict" suffix encoding — provenance is in the FieldSource int.
 *
 * v2 Sequence G — task #54.
 */
extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeVoterConsensus(
        JNIEnv* env, jobject /* thiz */, jlong jHandle) {
    auto* v = reinterpret_cast<dlscan::FieldVoter*>(jHandle);
    if (v == nullptr) return nullptr;
    const auto consensus = v->consensus();
    jclass stringCls = env->FindClass("java/lang/String");
    if (stringCls == nullptr) return nullptr;
    jobjectArray out = env->NewObjectArray(
        static_cast<jsize>(consensus.size() * 3), stringCls, nullptr);
    if (out == nullptr) {
        env->DeleteLocalRef(stringCls);
        return nullptr;
    }
    jsize idx = 0;
    for (const auto& c : consensus) {
        jstring jId = env->NewStringUTF(std::to_string(static_cast<int>(c.id)).c_str());
        jstring jSrc = env->NewStringUTF(std::to_string(static_cast<int>(c.source)).c_str());
        jstring jTxt = env->NewStringUTF(c.text.c_str());
        env->SetObjectArrayElement(out, idx++, jId);
        env->SetObjectArrayElement(out, idx++, jSrc);
        env->SetObjectArrayElement(out, idx++, jTxt);
        env->DeleteLocalRef(jId);
        env->DeleteLocalRef(jSrc);
        env->DeleteLocalRef(jTxt);
    }
    env->DeleteLocalRef(stringCls);
    return out;
}

// ===========================================================================
// AAMVA visible-field lexer (v2 Sequence E — task #53). The C++ implementation
// at cpp/aamva/aamva_lexer.{hpp,cpp} is the single source of truth; the
// Kotlin AamvaLexer object delegates here via DlScanLexerBridge external funs.
// JNI is already C++, so we call dlscan:: namespace functions directly
// without going through the C ABI (which exists for Swift Cxx interop).
//
// Wire format for findAll / findOne returns: flat Array<String> with 6
// strings per token. Slots:
//   [i*6 + 0] = canonical index (e.g. "4d")
//   [i*6 + 1] = raw_index pre-canonicalize
//   [i*6 + 2] = label or empty string ("" sentinel — Kotlin maps "" → null)
//   [i*6 + 3] = trimmed value
//   [i*6 + 4] = range_begin (decimal int, stringified)
//   [i*6 + 5] = range_end   (decimal int, stringified, EXCLUSIVE)
//
// All input strings are passed via GetStringUTFChars (Modified UTF-8).
// ASCII-input precondition applies — see aamva_lexer.hpp. Note that
// JNI's GetStringUTFLength returns the *Modified UTF-8* byte length,
// which equals the raw UTF-8 byte count only for pure ASCII input.
// The OCR backend filters to ASCII before tokens reach this layer, so
// the equality holds in practice; if non-ASCII ever surfaces here, the
// byte offsets handed back to Kotlin (range_begin/range_end) would be
// MU8 offsets, not Unicode codepoint indices.
// ===========================================================================

namespace {
// Push one AamvaToken's 6 strings into a flat jobjectArray slot. Releases
// each local ref after assignment so a long token vector doesn't blow the
// per-frame ref budget.
inline void push_token_to_array(JNIEnv* env,
                                 jobjectArray out,
                                 jsize base,
                                 const dlscan::AamvaToken& t) {
    auto set = [&](jsize off, const std::string& s) {
        jstring js = env->NewStringUTF(s.c_str());
        env->SetObjectArrayElement(out, base + off, js);
        env->DeleteLocalRef(js);
    };
    set(0, t.index);
    set(1, t.raw_index);
    set(2, t.has_label ? t.label : std::string{});
    set(3, t.value);
    set(4, std::to_string(t.range_begin));
    set(5, std::to_string(t.range_end));
}
} // namespace

extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_margelo_nitro_dlscan_DlScanLexerBridge_nativeFindAll(
        JNIEnv* env, jobject /* thiz */, jstring jText) {
    if (jText == nullptr) return nullptr;
    const char* cstr = env->GetStringUTFChars(jText, nullptr);
    if (cstr == nullptr) return nullptr;
    const jsize byteLen = env->GetStringUTFLength(jText);
    std::vector<dlscan::AamvaToken> tokens =
        dlscan::find_all_aamva_tokens(std::string_view(cstr, static_cast<size_t>(byteLen)));
    env->ReleaseStringUTFChars(jText, cstr);

    jclass stringCls = env->FindClass("java/lang/String");
    if (stringCls == nullptr) return nullptr;
    const jsize n = static_cast<jsize>(tokens.size()) * 6;
    jobjectArray out = env->NewObjectArray(n, stringCls, nullptr);
    env->DeleteLocalRef(stringCls);
    if (out == nullptr) return nullptr;
    for (size_t i = 0; i < tokens.size(); ++i) {
        push_token_to_array(env, out, static_cast<jsize>(i) * 6, tokens[i]);
    }
    return out;
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_com_margelo_nitro_dlscan_DlScanLexerBridge_nativeFindOne(
        JNIEnv* env, jobject /* thiz */, jstring jText, jint jStartIndex) {
    if (jText == nullptr) return nullptr;
    const char* cstr = env->GetStringUTFChars(jText, nullptr);
    if (cstr == nullptr) return nullptr;
    const jsize byteLen = env->GetStringUTFLength(jText);
    auto tok = dlscan::find_aamva_token(
        std::string_view(cstr, static_cast<size_t>(byteLen)),
        static_cast<size_t>(jStartIndex < 0 ? 0 : jStartIndex));
    env->ReleaseStringUTFChars(jText, cstr);

    if (!tok) return nullptr;
    jclass stringCls = env->FindClass("java/lang/String");
    if (stringCls == nullptr) return nullptr;
    jobjectArray out = env->NewObjectArray(6, stringCls, nullptr);
    env->DeleteLocalRef(stringCls);
    if (out == nullptr) return nullptr;
    push_token_to_array(env, out, 0, *tok);
    return out;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_dlscan_DlScanLexerBridge_nativeIsCompatibleLabel(
        JNIEnv* env, jobject /* thiz */, jstring jIndex, jstring jLabel) {
    if (jIndex == nullptr || jLabel == nullptr) return JNI_FALSE;
    const char* idx = env->GetStringUTFChars(jIndex, nullptr);
    const char* lbl = env->GetStringUTFChars(jLabel, nullptr);
    const bool ok = (idx != nullptr && lbl != nullptr)
                    && dlscan::is_compatible_label(idx, lbl);
    if (idx != nullptr) env->ReleaseStringUTFChars(jIndex, idx);
    if (lbl != nullptr) env->ReleaseStringUTFChars(jLabel, lbl);
    return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_dlscan_DlScanLexerBridge_nativeValueMatchesDomain(
        JNIEnv* env, jobject /* thiz */, jstring jValue, jstring jIndex) {
    if (jValue == nullptr || jIndex == nullptr) return JNI_FALSE;
    const char* val = env->GetStringUTFChars(jValue, nullptr);
    const char* idx = env->GetStringUTFChars(jIndex, nullptr);
    bool ok = false;
    if (val != nullptr && idx != nullptr) {
        ok = dlscan::value_matches_domain(
            std::string_view(val, static_cast<size_t>(env->GetStringUTFLength(jValue))),
            idx);
    }
    if (val != nullptr) env->ReleaseStringUTFChars(jValue, val);
    if (idx != nullptr) env->ReleaseStringUTFChars(jIndex, idx);
    return ok ? JNI_TRUE : JNI_FALSE;
}

/**
 * Kotlin signature:
 *   external fun nativeClassNameToFieldId(name: String): Int
 *
 * Typed bridge for matchObservationsToFields — converts the YOLO class
 * name string (e.g. "list_15") directly to a FieldId int. Returns 0
 * (FieldId::Unknown) for null / unknown names. v2 Sequence G — task #54.
 */
extern "C" JNIEXPORT jint JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeClassNameToFieldId(
        JNIEnv* env, jobject /* thiz */, jstring jName) {
    if (jName == nullptr) return 0;
    const char* nameChars = env->GetStringUTFChars(jName, nullptr);
    if (nameChars == nullptr) return 0;
    auto id = dlscan::yolo::class_name_to_field_id(nameChars);
    env->ReleaseStringUTFChars(jName, nameChars);
    return static_cast<jint>(id);
}

// ---- Detector C-ABI bridge (JS-orchestrated fast-tflite path) --------------
// The Kotlin side (HybridDlScanAndroid) calls these from preprocessFieldInput/
// decodeFieldOutput/preprocessDocAlignerInput/decodeCorners, marshaling the
// Nitro ArrayBuffer <-> primitive arrays. The actual math is the shared,
// 282-test-validated detect_c C-ABI, marshaling the Nitro ArrayBuffer <->
// primitive arrays with a jfloatArray in/out convention. UNVALIDATED against an
// Android (JDK 21) build — to confirm on first gradle build.

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativePreprocessField(
        JNIEnv* env, jobject /* thiz */, jbyteArray jRgb, jint w, jint h) {
    const int size = 416;
    const size_t need = static_cast<size_t>(3) * size * size;
    if (jRgb == nullptr || w <= 0 || h <= 0) return env->NewFloatArray(0);
    const jsize rgbLen = env->GetArrayLength(jRgb);
    jbyte* rgb = env->GetByteArrayElements(jRgb, nullptr);
    if (rgb == nullptr) return env->NewFloatArray(0);
    std::vector<float> out(need);
    float sx = 0, sy = 0;
    size_t n = dlscan_preprocess_field(reinterpret_cast<const uint8_t*>(rgb),
                                       static_cast<size_t>(rgbLen), w, h, size,
                                       out.data(), need, &sx, &sy);
    env->ReleaseByteArrayElements(jRgb, rgb, JNI_ABORT);
    if (n != need) return env->NewFloatArray(0);
    jfloatArray res = env->NewFloatArray(static_cast<jsize>(need));
    if (res != nullptr) env->SetFloatArrayRegion(res, 0, static_cast<jsize>(need), out.data());
    return res;
}

// nativeAugmentRgb — synthesize a TTA-augmented copy of an RGB8 image via the
// shared C++ dlscan_augment_rgb. `mode` is one of DLSCAN_AUG_* (detect_c.hpp).
// Returns a w*h*3 byte array, or an empty array on any error (null/short input,
// non-positive dims, unknown mode). Used by runTtaVerification.
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeAugmentRgb(
        JNIEnv* env, jobject /* thiz */, jbyteArray jRgb, jint w, jint h, jint mode) {
    if (jRgb == nullptr || w <= 0 || h <= 0) return env->NewByteArray(0);
    const size_t need = static_cast<size_t>(3) * static_cast<size_t>(w) * static_cast<size_t>(h);
    const jsize rgbLen = env->GetArrayLength(jRgb);
    jbyte* rgb = env->GetByteArrayElements(jRgb, nullptr);
    if (rgb == nullptr) return env->NewByteArray(0);
    std::vector<uint8_t> out(need);
    size_t n = dlscan_augment_rgb(reinterpret_cast<const uint8_t*>(rgb),
                                  static_cast<size_t>(rgbLen), w, h, mode,
                                  out.data(), need);
    env->ReleaseByteArrayElements(jRgb, rgb, JNI_ABORT);
    if (n != need) return env->NewByteArray(0);
    jbyteArray res = env->NewByteArray(static_cast<jsize>(need));
    if (res != nullptr) {
        env->SetByteArrayRegion(res, 0, static_cast<jsize>(need),
                                reinterpret_cast<const jbyte*>(out.data()));
    }
    return res;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeDecodeField(
        JNIEnv* env, jobject /* thiz */, jfloatArray jOut, jfloat scaleX, jfloat scaleY) {
    if (jOut == nullptr) return env->NewFloatArray(0);
    const jsize len = env->GetArrayLength(jOut);
    jfloat* out = env->GetFloatArrayElements(jOut, nullptr);
    if (out == nullptr) return env->NewFloatArray(0);
    const size_t cap = 100;
    std::vector<int> cls(cap);
    std::vector<float> conf(cap), x1(cap), y1(cap), x2(cap), y2(cap);
    size_t cnt = dlscan_decode_field(reinterpret_cast<const float*>(out),
                                     static_cast<size_t>(len), scaleX, scaleY,
                                     cls.data(), conf.data(), x1.data(), y1.data(),
                                     x2.data(), y2.data(), cap);
    env->ReleaseFloatArrayElements(jOut, out, JNI_ABORT);
    const size_t w = std::min(cnt, cap);
    const jsize outLen = static_cast<jsize>(w * 6);
    jfloatArray res = env->NewFloatArray(outLen);
    if (res == nullptr || outLen == 0) return res != nullptr ? res : env->NewFloatArray(0);
    std::vector<jfloat> packed;
    packed.reserve(w * 6);
    for (size_t i = 0; i < w; ++i) {
        packed.push_back(static_cast<jfloat>(cls[i]));
        packed.push_back(conf[i]);
        packed.push_back(x1[i]);
        packed.push_back(y1[i]);
        packed.push_back(x2[i]);
        packed.push_back(y2[i]);
    }
    env->SetFloatArrayRegion(res, 0, outLen, packed.data());
    return res;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativePreprocessDocAligner(
        JNIEnv* env, jobject /* thiz */, jbyteArray jRgb, jint w, jint h) {
    const int size = 256;
    const size_t need = static_cast<size_t>(3) * size * size;
    if (jRgb == nullptr || w <= 0 || h <= 0) return env->NewFloatArray(0);
    const jsize rgbLen = env->GetArrayLength(jRgb);
    jbyte* rgb = env->GetByteArrayElements(jRgb, nullptr);
    if (rgb == nullptr) return env->NewFloatArray(0);
    std::vector<float> out(need);
    size_t n = dlscan_preprocess_docaligner(reinterpret_cast<const uint8_t*>(rgb),
                                            static_cast<size_t>(rgbLen), w, h, size,
                                            out.data(), need);
    env->ReleaseByteArrayElements(jRgb, rgb, JNI_ABORT);
    if (n != need) return env->NewFloatArray(0);
    jfloatArray res = env->NewFloatArray(static_cast<jsize>(need));
    if (res != nullptr) env->SetFloatArrayRegion(res, 0, static_cast<jsize>(need), out.data());
    return res;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_margelo_nitro_dlscan_HybridDlScanAndroid_nativeDecodeCorners(
        JNIEnv* env, jobject /* thiz */, jfloatArray jOut) {
    if (jOut == nullptr) return env->NewFloatArray(0);
    const jsize len = env->GetArrayLength(jOut);
    jfloat* out = env->GetFloatArrayElements(jOut, nullptr);
    if (out == nullptr) return env->NewFloatArray(0);
    float xs[4] = {0}, ys[4] = {0};
    int ok = dlscan_decode_corners(reinterpret_cast<const float*>(out),
                                   static_cast<size_t>(len), xs, ys);
    env->ReleaseFloatArrayElements(jOut, out, JNI_ABORT);
    if (!ok) return env->NewFloatArray(0);
    jfloatArray res = env->NewFloatArray(8);
    if (res == nullptr) return env->NewFloatArray(0);
    jfloat packed[8] = {xs[0], ys[0], xs[1], ys[1], xs[2], ys[2], xs[3], ys[3]};
    env->SetFloatArrayRegion(res, 0, 8, packed);
    return res;
}

// JNI entry point — fires once when System.loadLibrary("DlScan") completes
// in DlScanOnLoad.kt. Delegates to the nitrogen-generated initialize() which
// runs both fbjni's setup AND margelo::nitro::dlscan::registerAllNatives().
#include "DlScanOnLoad.hpp"
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /* reserved */) {
  return ::margelo::nitro::dlscan::initialize(vm);
}
