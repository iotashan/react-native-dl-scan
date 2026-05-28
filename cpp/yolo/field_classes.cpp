#include "field_classes.hpp"

namespace dlscan {
namespace yolo {

// Order verified against the Python sorted() result of:
//   ["surname", "given_name", "birthday", "gender", "expire_date",
//    "personal_num", "country", "card_num1", "card_num2", "face",
//    "list_1", "list_2", "list_3", "list_3c", "list_4a", "list_4b",
//    "list_4d", "list_5", "list_8f", "list_8s", "list_9", "list_9a",
//    "list_12", "list_15", "list_16", "list_17", "list_18", "list_19",
//    "donor", "ghostimg"]
// Python sorts strings lexicographically, so "list_12" comes BEFORE "list_15"
// (because "1" < "1" then "2" < "5"), and "list_2" comes AFTER "list_19"
// (because "list_1*" < "list_2"). The ordering below was generated and
// double-checked against this rule.
const std::array<const char*, kNumClasses> kFieldClassNames = {
    "birthday",      //  0
    "card_num1",     //  1
    "card_num2",     //  2
    "country",       //  3
    "donor",         //  4
    "expire_date",   //  5
    "face",          //  6
    "gender",        //  7
    "ghostimg",      //  8
    "given_name",    //  9
    "list_1",        // 10
    "list_12",       // 11
    "list_15",       // 12
    "list_16",       // 13
    "list_17",       // 14
    "list_18",       // 15
    "list_19",       // 16
    "list_2",        // 17
    "list_3",        // 18
    "list_3c",       // 19
    "list_4a",       // 20
    "list_4b",       // 21
    "list_4d",       // 22
    "list_5",        // 23
    "list_8f",       // 24
    "list_8s",       // 25
    "list_9",        // 26
    "list_9a",       // 27
    "personal_num",  // 28
    "surname",       // 29
};

const char* class_name_or_empty(int class_id) {
    if (class_id < 0 ||
        static_cast<std::size_t>(class_id) >= kNumClasses) {
        return "";
    }
    return kFieldClassNames[static_cast<std::size_t>(class_id)];
}

// Parallel-indexed table to kFieldClassNames. Maintained by hand because
// (a) the FieldId enum values are not sequential, (b) several class
// indices (face, donor, ghostimg, card_num1, card_num2, list_3c) have
// no FieldId counterpart and map to FieldId::Unknown. Verified against
// kFieldClassNames at static-init via a one-time assert in the unit test.
//
// Order MUST match kFieldClassNames exactly.
static constexpr std::array<FieldId, kNumClasses> kFieldClassToFieldId = {
    FieldId::Birthday,    //  0  birthday
    FieldId::Unknown,     //  1  card_num1
    FieldId::Unknown,     //  2  card_num2
    FieldId::Country,     //  3  country
    FieldId::Unknown,     //  4  donor
    FieldId::ExpireDate,  //  5  expire_date
    FieldId::Unknown,     //  6  face
    FieldId::Gender,      //  7  gender
    FieldId::Unknown,     //  8  ghostimg
    FieldId::GivenName,   //  9  given_name
    FieldId::List1,       // 10  list_1
    FieldId::List12,      // 11  list_12
    FieldId::List15,      // 12  list_15
    FieldId::List16,      // 13  list_16
    FieldId::List17,      // 14  list_17
    FieldId::List18,      // 15  list_18
    FieldId::List19,      // 16  list_19
    FieldId::List2,       // 17  list_2
    FieldId::List3,       // 18  list_3
    FieldId::Unknown,     // 19  list_3c
    FieldId::List4a,      // 20  list_4a
    FieldId::List4b,      // 21  list_4b
    FieldId::List4d,      // 22  list_4d
    FieldId::List5,       // 23  list_5
    FieldId::List8f,      // 24  list_8f
    FieldId::List8s,      // 25  list_8s
    FieldId::List9,       // 26  list_9
    FieldId::List9a,      // 27  list_9a
    FieldId::PersonalNum, // 28  personal_num
    FieldId::Surname,     // 29  surname
};

FieldId class_id_to_field_id(int class_id) {
    if (class_id < 0 ||
        static_cast<std::size_t>(class_id) >= kNumClasses) {
        return FieldId::Unknown;
    }
    return kFieldClassToFieldId[static_cast<std::size_t>(class_id)];
}

FieldId class_name_to_field_id(std::string_view class_name) {
    for (std::size_t i = 0; i < kNumClasses; ++i) {
        if (class_name == kFieldClassNames[i]) {
            return kFieldClassToFieldId[i];
        }
    }
    return FieldId::Unknown;
}

} // namespace yolo
} // namespace dlscan
