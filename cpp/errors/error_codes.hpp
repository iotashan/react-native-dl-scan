#pragma once
#include <string>

namespace dlscan {

enum class ScanError {
    InvalidHeader,
    EmptyData,
    UnknownVersion,
    MalformedDate,
};

std::string error_message(ScanError error);

} // namespace dlscan
