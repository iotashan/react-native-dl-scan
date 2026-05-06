#include "error_codes.hpp"

namespace dlscan {

std::string error_message(ScanError error) {
    switch (error) {
        case ScanError::InvalidHeader:
            return "Invalid AAMVA header: data does not contain ANSI or AAMVA marker";
        case ScanError::EmptyData:
            return "Empty data: no input provided";
        case ScanError::UnknownVersion:
            return "Unknown AAMVA version: could not detect version from header";
        case ScanError::MalformedDate:
            return "Malformed date: date string does not match expected format";
    }
    return "Unknown error";
}

} // namespace dlscan
