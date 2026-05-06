#pragma once
#include <optional>
#include <string>
#include "mrz/mrz_data.hpp"

namespace dlscan {

/// Document type — determined at parse time.
/// DriverLicense: AAMVA barcode or OCR without MRZ.
/// Passport / NationalId / ResidencePermit: populated from MRZ parse.
/// Unknown: default when type cannot be determined.
enum class DocumentType {
    DriverLicense,
    Passport,
    NationalId,
    ResidencePermit,
    Unknown
};

/// POD struct representing a parsed driver's license.
/// All fields are optional; present only when successfully parsed.
/// String fields match the keys from the Swift AAMVAParser dictionary output.
struct LicenseData {
    std::optional<std::string> firstName;
    std::optional<std::string> lastName;
    std::optional<std::string> middleName;
    std::optional<std::string> licenseNumber;
    std::optional<std::string> dateOfBirth;
    std::optional<std::string> expirationDate;
    std::optional<std::string> issueDate;
    std::optional<std::string> sex;
    std::optional<std::string> eyeColor;
    std::optional<std::string> height;
    std::optional<std::string> street;
    std::optional<std::string> city;
    std::optional<std::string> state;
    std::optional<std::string> postalCode;
    std::optional<std::string> country;
    std::optional<std::string> vehicleClass;
    std::optional<std::string> restrictions;
    std::optional<std::string> endorsements;
    std::optional<int> aamvaVersion;

    // MRZ / travel document extension (additive; null for driver licenses).
    std::optional<DocumentType> documentType;
    std::optional<MRZData> mrz;
};

} // namespace dlscan
