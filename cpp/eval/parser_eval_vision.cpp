// parser_eval_vision — end-to-end OFFLINE generalization harness.
//
// Unlike parser_eval (which replays IDNet's *recorded* per-field ocr_string
// through the parser), this tool feeds OUR macOS Vision OCR — the SAME engine
// the iOS scanner uses — through the SAME shared C++ field-detector-free path
// the device runs:
//
//   whole-card Vision OCR text lines  (reading order, raw)
//     -> dlscan::parse_aamva_demographic_fields(lines)   [StrictTextPool]
//     -> dlscan::extract_fields_from_candidates(candidates)
//     -> dlscan::LicenseData
//
// then scores the parsed fields against IDNet's ground truth, per (state,
// field). This is the faithful "OCR + parser, no field detector" measurement
// — exactly the candidate sourcing in HybridDLScanIOS.ocrExtractFields minus
// the bbox/field-detector candidates (which need the on-device YOLO model).
//
// Inputs:
//   --obs <path>     JSONL of {doc_type, sample_id, image, lines:[...]}
//                    produced by run_ocr.py (one line per sampled image).
//   IDNET_DATA_ROOT  dir containing ocr_pairs.jsonl (the ground truth).
//   --csv <path>     optional: write a per-(state,field) results CSV.
//
// Output (stdout): the same table shape as parser_eval, so the two can be
// compared field-for-field against parser_eval_baseline_2026-06-07.txt.
//
// Scoring is byte-identical to parser_eval.cpp (same normalize_for_compare,
// same edit_distance cap=1, same field_getters), so any delta vs the baseline
// is attributable purely to OCR quality + the demographic parser's recovery,
// NOT to a scoring change.

#include "ocr/ocr_field_extractor.hpp"
#include "license_data.hpp"

#include <cstdlib>
#include <cstring>
#include <functional>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

// ---- flat-JSON string extractor (shared shape with parser_eval.cpp) --------
static bool extract_string(const std::string& line, const std::string& key,
                           std::string& out) {
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
            if (next == '"' || next == '\\' || next == '/') { value.push_back(next); p += 2; continue; }
            if (next == 'n') { value.push_back('\n'); p += 2; continue; }
            if (next == 't') { value.push_back('\t'); p += 2; continue; }
            if (next == 'r') { value.push_back('\r'); p += 2; continue; }
            value.push_back(line[p]); ++p; continue;
        }
        value.push_back(line[p]); ++p;
    }
    out = value;
    return true;
}

// Extract the "lines" array (array of JSON strings) from an observation row.
// Preserves order. Returns false if no "lines" key is found.
static bool extract_string_array(const std::string& line, const std::string& key,
                                 std::vector<std::string>& out) {
    std::string needle = "\"" + key + "\":";
    size_t k = line.find(needle);
    if (k == std::string::npos) return false;
    size_t p = k + needle.size();
    while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) ++p;
    if (p >= line.size() || line[p] != '[') return false;
    ++p;
    while (p < line.size()) {
        while (p < line.size() && (line[p] == ' ' || line[p] == ',' || line[p] == '\t')) ++p;
        if (p < line.size() && line[p] == ']') break;
        if (p >= line.size() || line[p] != '"') break;  // malformed
        ++p;
        std::string value;
        while (p < line.size() && line[p] != '"') {
            if (line[p] == '\\' && p + 1 < line.size()) {
                char next = line[p + 1];
                if (next == '"' || next == '\\' || next == '/') { value.push_back(next); p += 2; continue; }
                if (next == 'n') { value.push_back('\n'); p += 2; continue; }
                if (next == 't') { value.push_back('\t'); p += 2; continue; }
                if (next == 'r') { value.push_back('\r'); p += 2; continue; }
                value.push_back(line[p]); ++p; continue;
            }
            value.push_back(line[p]); ++p;
        }
        if (p < line.size()) ++p;  // closing quote
        out.push_back(std::move(value));
    }
    return true;
}

// ---- edit distance (cap=1/2), identical to parser_eval.cpp -----------------
static int edit_distance(const std::string& a, const std::string& b, int cap) {
    int la = (int)a.size(), lb = (int)b.size();
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

// ---- normalization (byte-identical to parser_eval.cpp) ---------------------
static std::string norm_upper_collapse(const std::string& s) {
    std::string out; out.reserve(s.size());
    bool last_space = false;
    for (char c : s) {
        unsigned char uc = (unsigned char)c;
        if (std::isspace(uc)) {
            if (!out.empty() && !last_space) { out.push_back(' '); last_space = true; }
        } else { out.push_back((char)std::toupper(uc)); last_space = false; }
    }
    if (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}
static std::string norm_strip_ws_upper(const std::string& s) {
    std::string out; out.reserve(s.size());
    for (char c : s) { unsigned char uc = (unsigned char)c; if (!std::isspace(uc)) out.push_back((char)std::toupper(uc)); }
    return out;
}
static std::string norm_digits_only(const std::string& s) {
    std::string out; out.reserve(s.size());
    for (char c : s) if (std::isdigit((unsigned char)c)) out.push_back(c);
    return out;
}
static std::string normalize_for_compare(const std::string& field_id, const std::string& v) {
    if (field_id == "list_4d" || field_id == "personal_num" ||
        field_id == "card_num1" || field_id == "card_num2")
        return norm_strip_ws_upper(v);
    if (field_id == "list_16" || field_id == "list_17")
        return norm_digits_only(v);
    if (field_id == "list_3" || field_id == "list_4a" || field_id == "list_4b" ||
        field_id == "birthday" || field_id == "expire_date") {
        if (v.size() == 10 && v[4] == '-' && v[7] == '-') return v;
        if (v.size() == 10 && (v[2] == '/' || v[2] == '-') && (v[5] == '/' || v[5] == '-')) {
            std::string yyyy = v.substr(6, 4), mm = v.substr(0, 2), dd = v.substr(3, 2);
            return yyyy + "-" + mm + "-" + dd;
        }
        return v;
    }
    return norm_upper_collapse(v);
}

// ---- field_id -> LicenseData getter (identical to parser_eval.cpp) ---------
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
    };
    return m;
}

struct FieldStats {
    size_t n = 0, strict_match = 0, edit1_match = 0, parser_returned = 0;
};

} // namespace

int main(int argc, char** argv) {
    const char* data_root = std::getenv("IDNET_DATA_ROOT");
    if (!data_root) { std::fprintf(stderr, "ERROR: IDNET_DATA_ROOT required\n"); return 1; }
    std::string obs_path, csv_path;
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "--obs") && i + 1 < argc) obs_path = argv[++i];
        else if (!std::strcmp(argv[i], "--csv") && i + 1 < argc) csv_path = argv[++i];
    }
    if (obs_path.empty()) { std::fprintf(stderr, "ERROR: --obs <jsonl> required\n"); return 1; }

    // 1. Load GT keyed by (doc_type, sample_id) -> field_id -> gt_string.
    using SampleKey = std::pair<std::string, std::string>;
    std::map<SampleKey, std::map<std::string, std::string>> gt;
    {
        std::string gt_path = std::string(data_root) + "/ocr_pairs.jsonl";
        std::ifstream in(gt_path);
        if (!in.is_open()) { std::cerr << "cannot open " << gt_path << "\n"; return 2; }
        std::string line;
        size_t rows = 0;
        while (std::getline(in, line)) {
            if (line.empty() || line[0] != '{') continue;
            std::string sid, dt, fid, gts;
            if (!extract_string(line, "sample_id", sid)) continue;
            if (!extract_string(line, "doc_type", dt)) continue;
            if (!extract_string(line, "field_id", fid)) continue;
            if (!extract_string(line, "gt_string", gts)) continue;
            gt[{dt, sid}][fid] = gts;
            ++rows;
        }
        std::cerr << "# loaded GT: " << rows << " field rows, " << gt.size()
                  << " unique (doc_type, sample_id) keys\n";
    }

    // 2. Stream the observations JSONL; run the pipeline per sample; score.
    std::map<std::string, FieldStats> stats;  // key = "<state>::<field_id>"
    std::ifstream obs(obs_path);
    if (!obs.is_open()) { std::cerr << "cannot open " << obs_path << "\n"; return 2; }
    std::string line;
    size_t n_samples = 0, n_no_gt = 0, n_parser_null = 0;
    std::map<std::string, size_t> per_state_samples;
    std::map<std::string, size_t> per_state_null;
    while (std::getline(obs, line)) {
        if (line.empty() || line[0] != '{') continue;
        std::string dt, sid;
        if (!extract_string(line, "doc_type", dt)) continue;
        if (!extract_string(line, "sample_id", sid)) continue;
        std::vector<std::string> lines;
        extract_string_array(line, "lines", lines);

        auto git = gt.find({dt, sid});
        if (git == gt.end()) { ++n_no_gt; continue; }
        ++n_samples;
        ++per_state_samples[dt];

        // ---- THE PIPELINE (faithful to HybridDLScanIOS.ocrExtractFields) ----
        // Raw whole-card observation texts (Vision reading order) -> shared
        // C++ demographic marker parser -> typed candidates -> extractor.
        dlscan::ObservationVector ov;
        ov.reserve(lines.size());
        for (auto& l : lines) ov.push_back(l);
        dlscan::FieldCandidateVector cands = dlscan::parse_aamva_demographic_fields(ov);
        std::optional<dlscan::LicenseData> parsed =
            dlscan::extract_fields_from_candidates(cands);
        if (!parsed.has_value()) { ++n_parser_null; ++per_state_null[dt]; }

        // Score every GT field we have a getter for.
        for (const auto& [field_id, gt_value] : git->second) {
            auto getter_it = field_getters().find(field_id);
            if (getter_it == field_getters().end()) continue;
            std::string key_s = dt + "::" + field_id;
            FieldStats& s = stats[key_s];
            ++s.n;
            std::optional<std::string> got;
            if (parsed.has_value()) got = getter_it->second(*parsed);
            if (got.has_value() && !got->empty()) ++s.parser_returned;
            std::string gt_norm = normalize_for_compare(field_id, gt_value);
            std::string got_norm = normalize_for_compare(field_id, got.value_or(""));
            if (gt_norm == got_norm) { ++s.strict_match; ++s.edit1_match; }
            else if (edit_distance(gt_norm, got_norm, 1) <= 1) { ++s.edit1_match; }
        }
    }
    std::cerr << "# scored " << n_samples << " samples ("
              << n_no_gt << " obs rows had no matching GT, "
              << n_parser_null << " produced null LicenseData)\n";
    for (const auto& [st, c] : per_state_samples)
        std::cerr << "#   " << st << ": " << c << " samples, "
                  << per_state_null[st] << " null LicenseData ("
                  << (c ? 100.0 * per_state_null[st] / c : 0.0) << "%)\n";

    // 3. Table.
    std::cout << std::left << std::setw(28) << "state" << std::setw(14) << "field"
              << std::right << std::setw(10) << "strict%" << std::setw(10) << "edit1%"
              << std::setw(10) << "returned%" << std::setw(8) << "N" << "\n";
    std::cout << std::string(80, '-') << "\n";
    std::ofstream csv;
    if (!csv_path.empty()) { csv.open(csv_path); csv << "state,field,strict_pct,edit1_pct,returned_pct,N\n"; }
    for (const auto& [key_s, s] : stats) {
        size_t sep = key_s.find("::");
        std::string state = key_s.substr(0, sep), field = key_s.substr(sep + 2);
        double strict = s.n ? 100.0 * s.strict_match / s.n : 0.0;
        double edit1  = s.n ? 100.0 * s.edit1_match  / s.n : 0.0;
        double ret    = s.n ? 100.0 * s.parser_returned / s.n : 0.0;
        std::cout << std::left << std::setw(28) << state << std::setw(14) << field
                  << std::right << std::fixed << std::setprecision(1)
                  << std::setw(10) << strict << std::setw(10) << edit1
                  << std::setw(10) << ret << std::setw(8) << s.n << "\n";
        if (csv.is_open())
            csv << state << "," << field << "," << std::fixed << std::setprecision(1)
                << strict << "," << edit1 << "," << ret << "," << s.n << "\n";
    }
    std::cout << "# samples scored: " << n_samples << "\n";
    return 0;
}
