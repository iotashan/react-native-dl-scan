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
#include <string>
#include <vector>

// C++ parsing core
#include "aamva_parser.hpp"
#include "ocr_field_extractor.hpp"

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
    s.height         = ld.height;
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
