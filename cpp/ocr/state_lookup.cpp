#include "state_lookup.hpp"

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

namespace dlscan {

namespace {

struct StateEntry {
    const char* code;
    const char* name;
    const char* country;
    /// First-N-character ZIP/postal-code prefix patterns this state covers.
    /// US: pipe-separated 3-digit prefixes ("530|531|532|...|549" for WI).
    /// CA: pipe-separated single letters ("K|L|M|N|P" for ON).
    /// We store the *first byte* of the prefix and the inclusive numeric range
    /// for US, or the set of letters for CA, as a single canonical pipe-list
    /// string; is_zip_consistent_with_state does the prefix match.
    const char* zip_prefix;
};

// US states + DC + territories. ZIP prefixes per USPS (3-digit-prefix ranges).
// Source: USPS Pub 28; ranges may have gaps but the prefix-startswith check
// is intentionally generous — we want to flag obvious mismatches, not
// catch every edge case of USPS reassignments.
static const StateEntry kStates[] = {
    // 2-letter, name (uppercase), country, ZIP prefixes
    {"AL", "ALABAMA",        "US", "350|351|352|354|355|356|357|358|359|360|361|362|363|364|365|366|367|368|369"},
    {"AK", "ALASKA",         "US", "995|996|997|998|999"},
    {"AZ", "ARIZONA",        "US", "850|851|852|853|855|856|857|859|860|863|864|865"},
    {"AR", "ARKANSAS",       "US", "716|717|718|719|720|721|722|723|724|725|726|727|728|729"},
    {"CA", "CALIFORNIA",     "US", "900|901|902|903|904|905|906|907|908|910|911|912|913|914|915|916|917|918|919|920|921|922|923|924|925|926|927|928|930|931|932|933|934|935|936|937|938|939|940|941|942|943|944|945|946|947|948|949|950|951|952|953|954|955|956|957|958|959|960|961"},
    {"CO", "COLORADO",       "US", "800|801|802|803|804|805|806|807|808|809|810|811|812|813|814|815|816"},
    {"CT", "CONNECTICUT",    "US", "060|061|062|063|064|065|066|067|068|069"},
    {"DE", "DELAWARE",       "US", "197|198|199"},
    {"DC", "DISTRICT OF COLUMBIA", "US", "200|202|203|204|205|569"},
    {"FL", "FLORIDA",        "US", "320|321|322|323|324|325|326|327|328|329|330|331|332|333|334|335|336|337|338|339|341|342|344|346|347|349"},
    {"GA", "GEORGIA",        "US", "300|301|302|303|304|305|306|307|308|309|310|311|312|313|314|315|316|317|318|319|398|399"},
    {"HI", "HAWAII",         "US", "967|968"},
    {"ID", "IDAHO",          "US", "832|833|834|835|836|837|838"},
    {"IL", "ILLINOIS",       "US", "600|601|602|603|604|605|606|607|608|609|610|611|612|613|614|615|616|617|618|619|620|622|623|624|625|626|627|628|629"},
    {"IN", "INDIANA",        "US", "460|461|462|463|464|465|466|467|468|469|470|471|472|473|474|475|476|477|478|479"},
    {"IA", "IOWA",           "US", "500|501|502|503|504|505|506|507|508|509|510|511|512|513|514|515|516|520|521|522|523|524|525|526|527|528"},
    {"KS", "KANSAS",         "US", "660|661|662|664|665|666|667|668|669|670|671|672|673|674|675|676|677|678|679"},
    {"KY", "KENTUCKY",       "US", "400|401|402|403|404|405|406|407|408|409|410|411|412|413|414|415|416|417|418|420|421|422|423|424|425|426|427"},
    {"LA", "LOUISIANA",      "US", "700|701|703|704|705|706|707|708|710|711|712|713|714"},
    {"ME", "MAINE",          "US", "039|040|041|042|043|044|045|046|047|048|049"},
    {"MD", "MARYLAND",       "US", "206|207|208|209|210|211|212|214|215|216|217|218|219"},
    {"MA", "MASSACHUSETTS",  "US", "010|011|012|013|014|015|016|017|018|019|020|021|022|023|024|025|026|027|055"},
    {"MI", "MICHIGAN",       "US", "480|481|482|483|484|485|486|487|488|489|490|491|492|493|494|495|496|497|498|499"},
    {"MN", "MINNESOTA",      "US", "550|551|553|554|555|556|557|558|559|560|561|562|563|564|565|566|567"},
    {"MS", "MISSISSIPPI",    "US", "386|387|388|389|390|391|392|393|394|395|396|397"},
    {"MO", "MISSOURI",       "US", "630|631|633|634|635|636|637|638|639|640|641|644|645|646|647|648|649|650|651|652|653|654|655|656|657|658"},
    {"MT", "MONTANA",        "US", "590|591|592|593|594|595|596|597|598|599"},
    {"NE", "NEBRASKA",       "US", "680|681|683|684|685|686|687|688|689|690|691|692|693"},
    {"NV", "NEVADA",         "US", "889|890|891|893|894|895|897|898"},
    {"NH", "NEW HAMPSHIRE",  "US", "030|031|032|033|034|035|036|037|038"},
    {"NJ", "NEW JERSEY",     "US", "070|071|072|073|074|075|076|077|078|079|080|081|082|083|084|085|086|087|088|089"},
    {"NM", "NEW MEXICO",     "US", "870|871|873|874|875|877|878|879|880|881|882|883|884"},
    {"NY", "NEW YORK",       "US", "005|100|101|102|103|104|105|106|107|108|109|110|111|112|113|114|115|116|117|118|119|120|121|122|123|124|125|126|127|128|129|130|131|132|133|134|135|136|137|138|139|140|141|142|143|144|145|146|147|148|149"},
    {"NC", "NORTH CAROLINA", "US", "270|271|272|273|274|275|276|277|278|279|280|281|282|283|284|285|286|287|288|289"},
    {"ND", "NORTH DAKOTA",   "US", "580|581|582|583|584|585|586|587|588"},
    {"OH", "OHIO",           "US", "430|431|432|433|434|435|436|437|438|439|440|441|442|443|444|445|446|447|448|449|450|451|452|453|454|455|456|457|458"},
    {"OK", "OKLAHOMA",       "US", "730|731|733|734|735|736|737|738|739|740|741|743|744|745|746|747|748|749"},
    {"OR", "OREGON",         "US", "970|971|972|973|974|975|976|977|978|979"},
    {"PA", "PENNSYLVANIA",   "US", "150|151|152|153|154|155|156|157|158|159|160|161|162|163|164|165|166|167|168|169|170|171|172|173|174|175|176|177|178|179|180|181|182|183|184|185|186|187|188|189|190|191|192|193|194|195|196"},
    {"RI", "RHODE ISLAND",   "US", "028|029"},
    {"SC", "SOUTH CAROLINA", "US", "290|291|292|293|294|295|296|297|298|299"},
    {"SD", "SOUTH DAKOTA",   "US", "570|571|572|573|574|575|576|577"},
    {"TN", "TENNESSEE",      "US", "370|371|372|373|374|375|376|377|378|379|380|381|382|383|384|385"},
    {"TX", "TEXAS",          "US", "733|750|751|752|753|754|755|756|757|758|759|760|761|762|763|764|765|766|767|768|769|770|771|772|773|774|775|776|777|778|779|780|781|782|783|784|785|786|787|788|789|790|791|792|793|794|795|796|797|798|799|885"},
    {"UT", "UTAH",           "US", "840|841|842|843|844|845|846|847"},
    {"VT", "VERMONT",        "US", "050|051|052|053|054|056|057|058|059"},
    {"VA", "VIRGINIA",       "US", "201|220|221|222|223|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246"},
    {"WA", "WASHINGTON",     "US", "980|981|982|983|984|985|986|988|989|990|991|992|993|994"},
    {"WV", "WEST VIRGINIA",  "US", "247|248|249|250|251|252|253|254|255|256|257|258|259|260|261|262|263|264|265|266|267|268"},
    {"WI", "WISCONSIN",      "US", "530|531|532|534|535|537|538|539|540|541|542|543|544|545|546|547|548|549"},
    {"WY", "WYOMING",        "US", "820|821|822|823|824|825|826|827|828|829|830|831"},
    // US territories
    {"PR", "PUERTO RICO",    "US", "006|007|009"},
    {"VI", "VIRGIN ISLANDS", "US", "008"},
    {"GU", "GUAM",           "US", "969"},
    {"AS", "AMERICAN SAMOA", "US", "967"},
    {"MP", "NORTHERN MARIANA ISLANDS", "US", "969"},
    // Military APO/FPO use AA/AE/AP with ZIPs 340/090-098/962-966 — skipped.

    // Canadian provinces + territories. First letter of postal code is the
    // province identifier; second/third chars further refine but the first
    // letter alone is the canonical state→postal mapping.
    {"AB", "ALBERTA",                "CA", "T"},
    {"BC", "BRITISH COLUMBIA",       "CA", "V"},
    {"MB", "MANITOBA",               "CA", "R"},
    {"NB", "NEW BRUNSWICK",          "CA", "E"},
    {"NL", "NEWFOUNDLAND AND LABRADOR", "CA", "A"},
    {"NS", "NOVA SCOTIA",            "CA", "B"},
    {"NT", "NORTHWEST TERRITORIES",  "CA", "X"},
    {"NU", "NUNAVUT",                "CA", "X"},
    {"ON", "ONTARIO",                "CA", "K|L|M|N|P"},
    {"PE", "PRINCE EDWARD ISLAND",   "CA", "C"},
    {"QC", "QUEBEC",                 "CA", "G|H|J"},
    {"SK", "SASKATCHEWAN",           "CA", "S"},
    {"YT", "YUKON",                  "CA", "Y"},
};

static constexpr size_t kStateCount = sizeof(kStates) / sizeof(kStates[0]);

// ---------------------------------------------------------------------------
// String helpers (local — duplicated from ocr_field_extractor to avoid a
// cross-file dependency; ~5 LOC).
// ---------------------------------------------------------------------------

static std::string to_upper_local(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return std::toupper(c); });
    return out;
}

static std::string collapse_ws(const std::string& s) {
    std::string out;
    bool last_space = false;
    for (char c : s) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!out.empty() && !last_space) {
                out.push_back(' ');
                last_space = true;
            }
        } else {
            out.push_back(c);
            last_space = false;
        }
    }
    if (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

/// Tokenize a US ZIP or Canadian postal code into its prefix-comparison form:
///   US "53703" → "537" (first 3 digits)
///   US "53703-1234" → "537"
///   CA "K1A 0B1" → "K"  (first letter)
///   CA "K1A0B1" (no space) → "K"
///   anything else → ""
static std::string zip_prefix(const std::string& zip) {
    std::string z;
    for (char c : zip) {
        if (!std::isspace(static_cast<unsigned char>(c))) z.push_back(c);
    }
    if (z.empty()) return "";
    // CA postal: starts with a letter
    if (std::isalpha(static_cast<unsigned char>(z[0]))) {
        return std::string(1, std::toupper(static_cast<unsigned char>(z[0])));
    }
    // US ZIP: digits, take first 3
    if (z.size() >= 3 && std::isdigit(static_cast<unsigned char>(z[0]))) {
        return z.substr(0, 3);
    }
    return "";
}

/// Does the pipe-separated [prefix_list] contain [needle]? Case-sensitive.
static bool prefix_list_contains(const std::string& prefix_list,
                                  const std::string& needle) {
    if (prefix_list.empty() || needle.empty()) return false;
    size_t pos = 0;
    while (pos < prefix_list.size()) {
        size_t next = prefix_list.find('|', pos);
        if (next == std::string::npos) next = prefix_list.size();
        if (prefix_list.compare(pos, next - pos, needle) == 0) return true;
        pos = next + 1;
    }
    return false;
}

} // anonymous namespace

const char* const kCanadianPostalCodeRegex = R"([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)";
const char* const kUsZipCodeRegex = R"(\d{5}(?:-\d{4})?)";

std::optional<StateLookupResult> lookup_state(const std::string& token) {
    if (token.empty()) return std::nullopt;
    std::string upper = to_upper_local(collapse_ws(token));
    if (upper.empty()) return std::nullopt;
    for (size_t i = 0; i < kStateCount; ++i) {
        const StateEntry& s = kStates[i];
        if (upper == s.code || upper == s.name) {
            return StateLookupResult{s.code, s.name, s.country};
        }
    }
    return std::nullopt;
}

bool is_zip_consistent_with_state(const std::string& state_code,
                                   const std::string& zip) {
    if (state_code.empty() || zip.empty()) return false;
    std::string code = to_upper_local(state_code);
    std::string prefix = zip_prefix(zip);
    if (prefix.empty()) return false;
    for (size_t i = 0; i < kStateCount; ++i) {
        if (code == kStates[i].code) {
            return prefix_list_contains(kStates[i].zip_prefix, prefix);
        }
    }
    return false;
}

} // namespace dlscan
