#include <gtest/gtest.h>
#include "ocr/state_lookup.hpp"

using namespace dlscan;

TEST(StateLookup, AcceptsTwoLetterCodes) {
    auto r = lookup_state("WI");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "WI");
    EXPECT_EQ(r->name, "WISCONSIN");
    EXPECT_EQ(r->country, "US");
}

TEST(StateLookup, AcceptsTwoLetterCodesCaseInsensitive) {
    auto r = lookup_state("wi");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "WI");
}

TEST(StateLookup, AcceptsFullName) {
    auto r = lookup_state("Wisconsin");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "WI");
    EXPECT_EQ(r->country, "US");
}

TEST(StateLookup, AcceptsFullNameAllCaps) {
    auto r = lookup_state("WISCONSIN");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "WI");
}

TEST(StateLookup, AcceptsMultiWordStateName) {
    auto r = lookup_state("New York");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "NY");

    auto r2 = lookup_state("NEW YORK");
    ASSERT_TRUE(r2.has_value());
    EXPECT_EQ(r2->code, "NY");

    auto r3 = lookup_state("North Carolina");
    ASSERT_TRUE(r3.has_value());
    EXPECT_EQ(r3->code, "NC");
}

TEST(StateLookup, AcceptsCanadianProvinceCode) {
    auto r = lookup_state("ON");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "ON");
    EXPECT_EQ(r->name, "ONTARIO");
    EXPECT_EQ(r->country, "CA");
}

TEST(StateLookup, AcceptsCanadianProvinceFullName) {
    auto r = lookup_state("Ontario");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "ON");
    EXPECT_EQ(r->country, "CA");

    auto r2 = lookup_state("British Columbia");
    ASSERT_TRUE(r2.has_value());
    EXPECT_EQ(r2->code, "BC");
}

TEST(StateLookup, RejectsNonStateText) {
    // The user's explicit false-positive concern: "Wisconsin St" appearing
    // inside a street address must NOT match. Caller is responsible for
    // bounded token extraction; lookup_state itself rejects anything that
    // doesn't EXACTLY match a known state's code or full name.
    EXPECT_FALSE(lookup_state("Wisconsin St").has_value());
    EXPECT_FALSE(lookup_state("Washington Square").has_value());
    EXPECT_FALSE(lookup_state("MAINE STREET").has_value());
    EXPECT_FALSE(lookup_state("Square").has_value());
    EXPECT_FALSE(lookup_state("").has_value());
    EXPECT_FALSE(lookup_state("ZZ").has_value());
}

TEST(StateLookup, RejectsAmbiguousAbbreviationContext) {
    // "OK" is both Oklahoma's code and a common word — but lookup_state
    // doesn't try to disambiguate semantically; the caller's regex must
    // place the token in city-state-zip position before calling. Once
    // here, "OK" is a valid state code.
    auto r = lookup_state("OK");
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->code, "OK");
    EXPECT_EQ(r->name, "OKLAHOMA");
}

TEST(StateLookup, ZipPrefixConsistency_WI) {
    EXPECT_TRUE(is_zip_consistent_with_state("WI", "53703"));
    EXPECT_TRUE(is_zip_consistent_with_state("WI", "53703-1234"));
    EXPECT_TRUE(is_zip_consistent_with_state("WI", "54901"));
    EXPECT_FALSE(is_zip_consistent_with_state("WI", "10001"));  // NY ZIP
    EXPECT_FALSE(is_zip_consistent_with_state("WI", "94110"));  // CA ZIP
}

TEST(StateLookup, ZipPrefixConsistency_NY) {
    EXPECT_TRUE(is_zip_consistent_with_state("NY", "10001"));
    EXPECT_TRUE(is_zip_consistent_with_state("NY", "14901"));
    EXPECT_FALSE(is_zip_consistent_with_state("NY", "53703"));
}

TEST(StateLookup, ZipPrefixConsistency_Canada) {
    EXPECT_TRUE(is_zip_consistent_with_state("ON", "K1A 0B1"));  // Ottawa
    EXPECT_TRUE(is_zip_consistent_with_state("ON", "M5V3L9"));   // Toronto, no space
    EXPECT_TRUE(is_zip_consistent_with_state("BC", "V6B1A1"));   // Vancouver
    EXPECT_FALSE(is_zip_consistent_with_state("ON", "V6B1A1"));  // BC code w/ ON
    EXPECT_FALSE(is_zip_consistent_with_state("BC", "K1A0B1"));  // ON code w/ BC
}

TEST(StateLookup, ZipPrefixConsistency_EmptyOrUnknown) {
    EXPECT_FALSE(is_zip_consistent_with_state("", "53703"));
    EXPECT_FALSE(is_zip_consistent_with_state("WI", ""));
    EXPECT_FALSE(is_zip_consistent_with_state("ZZ", "53703"));
}
