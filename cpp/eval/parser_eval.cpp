// parser_eval — replay IDNet's recorded OCR strings through the C++ parser
// and report per-(state, field) accuracy vs. the recorded ground truth.
//
// MVP for task #39 (round-10 design). Pure C++, no Vision/CoreML, no
// platform plumbing — the OCR strings have already been recorded into
// ocr_pairs.jsonl, so the harness can test extract_fields_from_candidates()
// in isolation across all 10 US states + 10 international jurisdictions
// without re-running ML Kit / Vision. (Sequence G — task #54 — migrated
// the eval harness from the legacy FieldsMap path to typed candidates.)
//
// Usage:
//   IDNET_DATA_ROOT=/path/to/idnet-data \
//     ./parser_eval [--state us_wisconsin_dl] [--limit N]
//
// Output (stdout):
//   state                field           strict%  edit1%  N
//   us_wisconsin_dl      list_1          92.3     97.1    831
//   us_wisconsin_dl      list_4d         78.2     85.4    831
//   ...
//
// round-10 grounding rules:
//   - GT key is (doc_type, sample_id, field_id) — sample_ids collide
//     across states.
//   - Composite filenames like XXXX_YYYY_ZZZZ are first-class sample_ids,
//     used verbatim (NOT collapsed to a primary).
//   - Match metrics: strict equality AND Levenshtein <= 1 (per review —
//     "two numbers per (state, field)").
//   - Coverage buckets reported: (samples with GT), (GT rows without
//     image — won't apply here since we don't load images).

#include "ocr/ocr_field_extractor.hpp"
#include "license_data.hpp"
#include "yolo/field_classes.hpp"

#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

// ---------------------------------------------------------------------------
// Minimal flat-JSON line parser — each JSONL line is a single object with
// known string keys, no nesting, no escaped chars beyond \" / \\ / standard
// whitespace inside values. Hand-rolled to avoid adding nlohmann/json as a
// build dep just for this harness.
//
// Extracts the five fields we care about (sample_id, doc_type, field_id,
// gt_string, ocr_string). Returns false on malformed lines.
// ---------------------------------------------------------------------------

struct JsonlRow {
    std::string sample_id;
    std::string doc_type;
    std::string field_id;
    std::string gt_string;
    std::string ocr_string;
};

static bool extract_string(const std::string& line, const std::string& key,
                            std::string& out) {
    // Pattern: "key": "value"
    std::string needle = "\"" + key + "\":";
    size_t k = line.find(needle);
    if (k == std::string::npos) return false;
    size_t p = k + needle.size();
    while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) ++p;
    if (p >= line.size() || line[p] != '"') return false;
    ++p;
    std::string value;
    while (p < line.size() && line[p] != '"') {
        if (line[p] == '\\' && p + 1 < line.size()) {
            char next = line[p + 1];
            // Standard JSON escapes we might see: \" \\ \/ \n \t \r \u
            // For our use case (OCR text), keep it simple — preserve the
            // character verbatim after the backslash.
            if (next == '"' || next == '\\' || next == '/') {
                value.push_back(next);
                p += 2;
                continue;
            }
            if (next == 'n') { value.push_back('\n'); p += 2; continue; }
            if (next == 't') { value.push_back('\t'); p += 2; continue; }
            if (next == 'r') { value.push_back('\r'); p += 2; continue; }
            // Unknown escape — emit as-is and advance one char.
            value.push_back(line[p]);
            ++p;
            continue;
        }
        value.push_back(line[p]);
        ++p;
    }
    out = value;
    return true;
}

static bool parse_jsonl_line(const std::string& line, JsonlRow& out) {
    if (line.empty() || line[0] != '{') return false;
    return extract_string(line, "sample_id", out.sample_id) &&
           extract_string(line, "doc_type", out.doc_type) &&
           extract_string(line, "field_id", out.field_id) &&
           extract_string(line, "gt_string", out.gt_string) &&
           extract_string(line, "ocr_string", out.ocr_string);
}

// ---------------------------------------------------------------------------
// Damerau-Levenshtein edit distance (capped at 2 — we only care about
// "exact" / "edit-1" / "edit-≥2"). O(n*m) with early-exit when the running
// minimum across a row exceeds the cap.
// ---------------------------------------------------------------------------

static int edit_distance(const std::string& a, const std::string& b, int cap) {
    int la = static_cast<int>(a.size());
    int lb = static_cast<int>(b.size());
    if (std::abs(la - lb) > cap) return cap + 1;
    std::vector<int> prev(lb + 1), cur(lb + 1);
    for (int j = 0; j <= lb; ++j) prev[j] = j;
    for (int i = 1; i <= la; ++i) {
        cur[0] = i;
        int row_min = cur[0];
        for (int j = 1; j <= lb; ++j) {
            int cost = (a[i - 1] == b[j - 1]) ? 0 : 1;
            cur[j] = std::min({cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost});
            if (cur[j] < row_min) row_min = cur[j];
        }
        if (row_min > cap) return cap + 1;
        std::swap(prev, cur);
    }
    return prev[lb];
}

// ---------------------------------------------------------------------------
// Per-field normalization — match the production parser's output shape.
//
// round-10: "the GT comparator needs to know the expected parse
// output, not just the card-face string". Dates are well-defined (ISO);
// license numbers strip whitespace; names use case-insensitive collation.
// ---------------------------------------------------------------------------

static std::string norm_upper_collapse(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    bool last_space = false;
    for (char c : s) {
        unsigned char uc = static_cast<unsigned char>(c);
        if (std::isspace(uc)) {
            if (!out.empty() && !last_space) {
                out.push_back(' ');
                last_space = true;
            }
        } else {
            out.push_back(static_cast<char>(std::toupper(uc)));
            last_space = false;
        }
    }
    if (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

static std::string norm_strip_ws_upper(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        unsigned char uc = static_cast<unsigned char>(c);
        if (!std::isspace(uc)) {
            out.push_back(static_cast<char>(std::toupper(uc)));
        }
    }
    return out;
}

static std::string norm_digits_only(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) if (std::isdigit(static_cast<unsigned char>(c))) out.push_back(c);
    return out;
}

static std::string normalize_for_compare(const std::string& field_id,
                                          const std::string& v) {
    // License numbers + ZIPs: strip whitespace, uppercase.
    if (field_id == "list_4d" || field_id == "personal_num" ||
        field_id == "card_num1" || field_id == "card_num2") {
        return norm_strip_ws_upper(v);
    }
    // Height / weight: punctuation varies wildly across state DLs (5'-09''
    // vs 5'09" vs 5-4 vs 64 in; 221 LB vs 221LB vs 221 lbs). Compare on
    // digits-only — measures whether the parser captured the numeric
    // value, regardless of formatting. round-10 acknowledged that
    // some fields have format ambiguity that the eval normalizer must
    // resolve; this is exactly that case.
    if (field_id == "list_16" || field_id == "list_17") {
        return norm_digits_only(v);
    }
    // Dates: try to ISO-normalize via the parser's helpers indirectly —
    // for the eval, just compare the parsed ISO output. The parser
    // already normalises dates to YYYY-MM-DD; the gt_string is the
    // card-face form (e.g., "MM/DD/YYYY"). Normalize the GT side too:
    // if it parses to YYYY-MM-DD, do that comparison; otherwise fall
    // through to text comparison.
    if (field_id == "list_3" || field_id == "list_4a" || field_id == "list_4b" ||
        field_id == "birthday" || field_id == "expire_date") {
        // Accept both MM/DD/YYYY and MM-DD-YYYY → YYYY-MM-DD
        if (v.size() == 10 && v[4] == '-' && v[7] == '-') {
            return v;  // already ISO
        }
        if (v.size() == 10 && (v[2] == '/' || v[2] == '-') &&
            (v[5] == '/' || v[5] == '-')) {
            std::string yyyy = v.substr(6, 4);
            std::string mm = v.substr(0, 2);
            std::string dd = v.substr(3, 2);
            return yyyy + "-" + mm + "-" + dd;
        }
        return v;
    }
    // Default: collapse whitespace + uppercase.
    return norm_upper_collapse(v);
}

// ---------------------------------------------------------------------------
// Field-id → C++ LicenseData accessor table.
//
// Maps the field_id used in ocr_pairs.jsonl to the optional<string> getter
// on dlscan::LicenseData. Only fields the parser currently extracts are
// present; others (list_5, list_8f-vs-list_8s discrimination, list_12, etc.)
// require either pipeline support or a separate fallback path.
// ---------------------------------------------------------------------------

using FieldGetter = std::function<std::optional<std::string>(const dlscan::LicenseData&)>;

static const std::map<std::string, FieldGetter>& field_getters() {
    static const std::map<std::string, FieldGetter> m = {
        {"list_1",  [](const dlscan::LicenseData& d){ return d.lastName; }},
        {"list_2",  [](const dlscan::LicenseData& d){ return d.firstName; }},
        {"list_3",  [](const dlscan::LicenseData& d){ return d.dateOfBirth; }},
        {"list_4a", [](const dlscan::LicenseData& d){ return d.issueDate; }},
        {"list_4b", [](const dlscan::LicenseData& d){ return d.expirationDate; }},
        {"list_4d", [](const dlscan::LicenseData& d){ return d.licenseNumber; }},
        {"list_8f", [](const dlscan::LicenseData& d){ return d.street; }},
        {"list_9",  [](const dlscan::LicenseData& d){ return d.vehicleClass; }},
        {"list_9a", [](const dlscan::LicenseData& d){ return d.restrictions; }},
        {"list_15", [](const dlscan::LicenseData& d){ return d.sex; }},
        {"list_16", [](const dlscan::LicenseData& d){ return d.height; }},
        {"list_17", [](const dlscan::LicenseData& d){ return d.weight; }},
        {"list_18", [](const dlscan::LicenseData& d){ return d.eyeColor; }},
        {"list_19", [](const dlscan::LicenseData& d){ return d.hairColor; }},
        // International IDs
        {"surname",     [](const dlscan::LicenseData& d){ return d.lastName; }},
        {"given_name",  [](const dlscan::LicenseData& d){ return d.firstName; }},
        {"birthday",    [](const dlscan::LicenseData& d){ return d.dateOfBirth; }},
        {"expire_date", [](const dlscan::LicenseData& d){ return d.expirationDate; }},
        {"personal_num", [](const dlscan::LicenseData& d){ return d.licenseNumber; }},
        {"gender",      [](const dlscan::LicenseData& d){ return d.sex; }},
        {"country",     [](const dlscan::LicenseData& d){ return d.country; }},
    };
    return m;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

int main(int argc, char** argv) {
    const char* data_root = std::getenv("IDNET_DATA_ROOT");
    if (data_root == nullptr) {
        std::fprintf(stderr, "ERROR: IDNET_DATA_ROOT environment variable required\n"); return 1;
    }
    std::string state_filter;
    int limit = -1;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--state") == 0 && i + 1 < argc) {
            state_filter = argv[++i];
        } else if (std::strcmp(argv[i], "--limit") == 0 && i + 1 < argc) {
            limit = std::atoi(argv[++i]);
        }
    }

    std::string jsonl_path = std::string(data_root) + "/ocr_pairs.jsonl";
    std::ifstream in(jsonl_path);
    if (!in.is_open()) {
        std::cerr << "cannot open " << jsonl_path << "\n";
        return 2;
    }

    // Group rows by (doc_type, sample_id) so we can rebuild a fields map
    // per image and feed it through the parser.
    using SampleKey = std::pair<std::string, std::string>;  // (doc_type, sample_id)
    struct SampleRows {
        std::map<std::string, std::string> ocr;  // field_id → ocr_string
        std::map<std::string, std::string> gt;   // field_id → gt_string
    };
    std::map<SampleKey, SampleRows> samples;

    std::string line;
    size_t lineno = 0, parsed = 0, skipped = 0;
    while (std::getline(in, line)) {
        ++lineno;
        JsonlRow row;
        if (!parse_jsonl_line(line, row)) { ++skipped; continue; }
        if (!state_filter.empty() && row.doc_type != state_filter) continue;
        SampleKey k{row.doc_type, row.sample_id};
        samples[k].ocr[row.field_id] = row.ocr_string;
        samples[k].gt[row.field_id]  = row.gt_string;
        ++parsed;
    }
    std::cerr << "# read " << lineno << " lines, parsed " << parsed
              << " rows, skipped " << skipped << ", "
              << samples.size() << " unique (doc_type, sample_id) tuples\n";

    // Per-(state, field) counters.
    struct FieldStats {
        size_t n = 0;
        size_t strict_match = 0;
        size_t edit1_match = 0;
        size_t expected_present = 0;     // GT has a value for this field
        size_t parser_returned = 0;       // parser populated this field
    };
    // Key = "<state>::<field_id>"
    std::map<std::string, FieldStats> stats;

    size_t processed = 0;
    for (const auto& [key, rows] : samples) {
        if (limit > 0 && static_cast<int>(processed) >= limit) break;
        ++processed;
        const std::string& state = key.first;

        // Run the parser on this sample's recorded OCR strings. Build typed
        // FieldCandidates from the legacy string-keyed eval data: each
        // (field_id_string, ocr_value) becomes one BboxIoU candidate. The
        // eval harness has no provenance signal (no _strict pairs), so
        // BboxIoU is the only valid source here. v2 Sequence G — task #54.
        std::vector<dlscan::FieldCandidate> candidates;
        candidates.reserve(rows.ocr.size());
        for (const auto& [field_id, ocr_value] : rows.ocr) {
            if (ocr_value.empty()) continue;
            dlscan::FieldId fid = dlscan::yolo::class_name_to_field_id(field_id);
            if (fid == dlscan::FieldId::Unknown) continue;
            dlscan::FieldCandidate c;
            c.id = fid;
            c.source = dlscan::FieldSource::BboxIoU;
            c.text = ocr_value;
            candidates.push_back(std::move(c));
        }
        auto parsed_data = dlscan::extract_fields_from_candidates(candidates);

        // For every field present in GT, evaluate.
        for (const auto& [field_id, gt_value] : rows.gt) {
            auto getter_it = field_getters().find(field_id);
            if (getter_it == field_getters().end()) continue;  // unsupported field

            std::string key_s = state + "::" + field_id;
            FieldStats& s = stats[key_s];
            ++s.n;
            if (!gt_value.empty()) ++s.expected_present;

            std::optional<std::string> got;
            if (parsed_data.has_value()) {
                got = getter_it->second(*parsed_data);
            }
            if (got.has_value() && !got->empty()) ++s.parser_returned;

            std::string gt_norm = normalize_for_compare(field_id, gt_value);
            std::string got_norm = normalize_for_compare(
                field_id, got.value_or(""));
            if (gt_norm == got_norm) {
                ++s.strict_match;
                ++s.edit1_match;
            } else if (edit_distance(gt_norm, got_norm, 1) <= 1) {
                ++s.edit1_match;
            }
        }
    }

    // Sort and print.
    std::cout << std::left
              << std::setw(28) << "state"
              << std::setw(14) << "field"
              << std::right
              << std::setw(10) << "strict%"
              << std::setw(10) << "edit1%"
              << std::setw(10) << "returned%"
              << std::setw(8)  << "N"
              << "\n";
    std::cout << std::string(80, '-') << "\n";
    for (const auto& [key_s, s] : stats) {
        size_t sep = key_s.find("::");
        std::string state = key_s.substr(0, sep);
        std::string field = key_s.substr(sep + 2);
        double strict = s.n ? 100.0 * s.strict_match / s.n : 0.0;
        double edit1 = s.n ? 100.0 * s.edit1_match / s.n : 0.0;
        double ret   = s.n ? 100.0 * s.parser_returned / s.n : 0.0;
        std::cout << std::left
                  << std::setw(28) << state
                  << std::setw(14) << field
                  << std::right << std::fixed << std::setprecision(1)
                  << std::setw(10) << strict
                  << std::setw(10) << edit1
                  << std::setw(10) << ret
                  << std::setw(8)  << s.n
                  << "\n";
    }
    std::cout << "# samples processed: " << processed << " / " << samples.size() << "\n";
    return 0;
}
