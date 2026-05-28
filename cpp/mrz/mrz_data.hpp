#pragma once
#include <optional>
#include <string>

namespace dlscan {

enum class MRZType { TD1, TD2, TD3 };

struct MRZData {
    MRZType mrzType;
    std::string documentCode;      // e.g., "P" for passport, "I" for ID, "AC" for residence permit
    std::string issuingState;      // 3-letter ICAO country code (may contain '<' fillers for some states)
    std::string documentNumber;
    std::string primaryIdentifier;    // surname / family name
    std::string secondaryIdentifier;  // given names (joined with spaces)
    std::string nationality;          // 3-letter ICAO country code
    std::string dateOfBirth;          // ISO 8601 yyyy-mm-dd
    std::string sex;                  // "M" / "F" / "X"
    std::string dateOfExpiry;         // ISO 8601 yyyy-mm-dd
    std::string optionalData;         // raw optional data field(s); no further parsing
    bool checkDigitsValid;            // true if all format-specific check digits passed
};

}  // namespace dlscan
