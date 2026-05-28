#include <gtest/gtest.h>
#include "aamva/aamva_parser.hpp"

using namespace dlscan;

// Helper: get string field value or empty string
static std::string sval(const std::optional<std::string>& opt) {
    return opt.has_value() ? opt.value() : "";
}

// ============================================================================
// Version Detection Tests
// ============================================================================

TEST(AAMVAVersionDetection, V1) {
    const std::string data =
        "@\n\x1E\nANSI 636000010002DL\nDAQ123\nDABSMITH\nDACJOHN\nDBB19900815";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(1));
}

TEST(AAMVAVersionDetection, V4) {
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(4));
}

TEST(AAMVAVersionDetection, V9) {
    const std::string data =
        "@\n\x1E\nANSI 636000090002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(9));
}

TEST(AAMVAVersionDetection, V10) {
    const std::string data =
        "@\n\x1E\nANSI 636000100002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(10));
}

TEST(AAMVAVersionDetection, V11) {
    const std::string data =
        "@\n\x1E\nANSI 636000110002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(11));
}

// ============================================================================
// Version 1 Tests (yyyyMMdd dates, DAB/DAC/DAD fields)
// ============================================================================

TEST(AAMVAV1, BasicFields) {
    const std::string data =
        "@\n\x1E\nANSI 636000010002DL\n"
        "DAQ999888777\nDABJOHNSON\nDACROBERT\nDADMICHAEL\n"
        "DBB19851220\nDBA20281231\nDBD20200115\n"
        "DBC1\nDAYBRO\nDAU511\nDAG456 ELM STREET\n"
        "DAISPRINGFiELD\nDAJIL\nDAK627040000\n"
        "DCAB\nDCBNONE\nDCDNONE";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(1));
    EXPECT_EQ(sval(r->lastName), "JOHNSON");
    EXPECT_EQ(sval(r->firstName), "ROBERT");
    EXPECT_EQ(sval(r->middleName), "MICHAEL");
    EXPECT_EQ(sval(r->licenseNumber), "999888777");
    // v1 dates are yyyyMMdd
    EXPECT_EQ(sval(r->dateOfBirth), "1985-12-20");
    EXPECT_EQ(sval(r->expirationDate), "2028-12-31");
    EXPECT_EQ(sval(r->issueDate), "2020-01-15");
    EXPECT_EQ(sval(r->sex), "M");
}

// ============================================================================
// Version 1 DAA Composite Name Tests
// ============================================================================

TEST(AAMVAV1, DAACompositeName) {
    const std::string data =
        "@\n\x1E\nANSI 636000010002DL\n"
        "DAQ111222333\nDAAWILLIAMS,SARAH,ANN\nDBB19900601\nDBC2";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "WILLIAMS");
    EXPECT_EQ(sval(r->firstName), "SARAH");
    EXPECT_EQ(sval(r->middleName), "ANN");
    EXPECT_EQ(sval(r->sex), "F");
}

// ============================================================================
// Version 2 Tests (MMddyyyy dates, DCS/DCT fields)
// ============================================================================

TEST(AAMVAV2, BasicFields) {
    const std::string data =
        "@\n\x1E\nANSI 636000020002DL\n"
        "DAQ555666777\nDCSMARTINEZ\nDCTMARIA,ELENA\n"
        "DBB03151988\nDBA06302029\nDBC2\n"
        "DAG789 OAK AVE\nDAIDALLAS\nDAJTX\nDAK752010000";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(2));
    EXPECT_EQ(sval(r->lastName), "MARTINEZ");
    EXPECT_EQ(sval(r->firstName), "MARIA");
    EXPECT_EQ(sval(r->middleName), "ELENA");
    // v2 dates are MMddyyyy
    EXPECT_EQ(sval(r->dateOfBirth), "1988-03-15");
    EXPECT_EQ(sval(r->sex), "F");
}

// ============================================================================
// Version 4+ Standard Tests (Modern Format)
// ============================================================================

TEST(AAMVAModern, V9AllFields) {
    const std::string data =
        "@\n\x1E\nANSI 636000090002DL00410278ZV03190008\n"
        "DAQ123456789\nDCSSAMPLE\nDACJOHN\nDADMICHAEL\n"
        "DBB08151990\nDBA12312028\nDBD01152023\n"
        "DBC1\nDAYGRN\nDAU510\nDAG123 MAIN ST\n"
        "DAIRICHMOND\nDAJVA\nDAK232200000\n"
        "DCGUSA\nDCAA\nDCBNONE\nDCDNONE";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->firstName), "JOHN");
    EXPECT_EQ(sval(r->lastName), "SAMPLE");
    EXPECT_EQ(sval(r->middleName), "MICHAEL");
    EXPECT_EQ(sval(r->licenseNumber), "123456789");
    EXPECT_EQ(sval(r->dateOfBirth), "1990-08-15");
    EXPECT_EQ(sval(r->expirationDate), "2028-12-31");
    EXPECT_EQ(sval(r->issueDate), "2023-01-15");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->eyeColor), "GRN");
    EXPECT_EQ(sval(r->height), "510");
    EXPECT_EQ(sval(r->street), "123 MAIN ST");
    EXPECT_EQ(sval(r->city), "RICHMOND");
    EXPECT_EQ(sval(r->state), "VA");
    EXPECT_EQ(sval(r->postalCode), "23220");
    EXPECT_EQ(sval(r->country), "USA");
    EXPECT_EQ(sval(r->vehicleClass), "A");
    EXPECT_EQ(sval(r->restrictions), "NONE");
    EXPECT_EQ(sval(r->endorsements), "NONE");
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(9));
}

// ============================================================================
// Canadian Card Tests
// ============================================================================

TEST(AAMVACanada, V9CanadianCard) {
    const std::string data =
        "@\n\x1E\nANSI 636000090002DL\n"
        "DAQA1234567\nDCSLEBLANC\nDACJEAN\nDADPIERRE\n"
        "DBB19870520\nDBA20300101\nDBC1\n"
        "DCGCAN\nDAJON\nDAK M4B1A5";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->country), "CAN");
    // v9 Canada uses yyyyMMdd
    EXPECT_EQ(sval(r->dateOfBirth), "1987-05-20");
    EXPECT_EQ(sval(r->state), "ON");
    EXPECT_EQ(sval(r->postalCode), "M4B1A5");
}

TEST(AAMVACanada, V2CanadianMMddyyyy) {
    const std::string data =
        "@\n\x1E\nANSI 636000020002DL\n"
        "DAQB5555555\nDCSDUPONT\nDCTMARIE\n"
        "DBB05201987\nDBC2\nDCGCAN\nDAJQC";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    // v2 Canada uses MMddyyyy
    EXPECT_EQ(sval(r->dateOfBirth), "1987-05-20");
}

// ============================================================================
// Date Format Tests
// ============================================================================

TEST(AAMVADates, YYYYMMDDFormat) {
    const std::string data =
        "ANSI 636000010002DL\n"
        "DAQA1234567\nDCSSMITH\nDACJANE\n"
        "DBB19850320\nDBA20290101\nDBC2";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1985-03-20");
    EXPECT_EQ(sval(r->sex), "F");
}

// ============================================================================
// Sex Code Tests
// ============================================================================

TEST(AAMVASex, Code9MapsToX) {
    const std::string data = "AAMVA\nDAQX9999\nDCSTEST\nDBC9";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->sex), "X");
}

TEST(AAMVASex, UnknownCodeReturnsEmpty) {
    const std::string data = "AAMVA\nDAQX9999\nDCSTEST\nDBC7";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->sex.has_value());
}

// ============================================================================
// Edge Case Tests
// ============================================================================

TEST(AAMVAEdgeCases, RejectsNonAAMVA) {
    EXPECT_FALSE(parse_aamva("This is not a barcode").has_value());
}

TEST(AAMVAEdgeCases, RejectsEmpty) {
    EXPECT_FALSE(parse_aamva("").has_value());
}

TEST(AAMVAEdgeCases, DefaultsCountryToUSA) {
    const std::string data = "ANSI 636000\nDAQ999\nDCSSMITH";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAEdgeCases, HandlesRecordSeparator) {
    // \x1E as separator
    // Use "\036" (octal) to avoid hex-escape ambiguity with following alphanum chars
    const std::string data = "ANSI 636000\036" "DAQ777888\036" "DCSJONES\036" "DCTBILL";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "777888");
    EXPECT_EQ(sval(r->firstName), "BILL");
}

TEST(AAMVAEdgeCases, HandlesDLPrefixOnElementLine) {
    const std::string data =
        "ANSI 636000090002\nDLDAQ444555\nDCSSMITH\nDACBOB";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "444555");
}

TEST(AAMVAEdgeCases, V1PAStarCodesFallback) {
    const std::string data =
        "ANSI 636000010002DL\nDAQ111\nDABDOE\nPAACDL\nPAENONE\nPAFS";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->vehicleClass), "CDL");
    EXPECT_EQ(sval(r->restrictions), "NONE");
    EXPECT_EQ(sval(r->endorsements), "S");
}

// ============================================================================
// Name Resolution Fallback Tests
// ============================================================================

TEST(AAMVANameResolution, DACPriorityOverDCT) {
    const std::string data = "ANSI 636000\nDAQ999\nDCSSMITH\nDACJOHN\nDCTJANE";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->firstName), "JOHN");
}

TEST(AAMVANameResolution, DCSPriorityOverDAB) {
    const std::string data = "ANSI 636000\nDAQ999\nDCSSMITH\nDABJONES";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "SMITH");
}

TEST(AAMVANameResolution, DABFallback) {
    const std::string data = "ANSI 636000\nDAQ999\nDABJOHNSON";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "JOHNSON");
}

TEST(AAMVANameResolution, DCTCommaSeparated) {
    const std::string data = "ANSI 636000\nDAQ999\nDCSSMITH\nDCTJANE,MARIE,ANN";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->firstName), "JANE");
    EXPECT_EQ(sval(r->middleName), "MARIE ANN");
}

TEST(AAMVANameResolution, DAACompositeNameFallback) {
    const std::string data = "ANSI 636000\nDAQ999\nDAADOE,JOHN,MICHAEL";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "DOE");
    EXPECT_EQ(sval(r->firstName), "JOHN");
    EXPECT_EQ(sval(r->middleName), "MICHAEL");
}

// ============================================================================
// Multi-State Tests
// ============================================================================

TEST(AAMVAMultiState, FL_v1_DAACompositeName) {
    const std::string data =
        "@\n\nANSI 6360100102DL00390187ZF02260043\n"
        "DAATESTER,JOEY,MIDLAND\n"
        "DAG1234 PARK ST LOT 504\n"
        "DAIKEY WEST\nDAJFL\nDAK33040-0504 \n"
        "DAQH574712510891\n"
        "DBA20220309\nDBB19410509\nDBC1\n"
        "DBD20140501\nDAU601";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "FL v1: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(1));
    EXPECT_EQ(sval(r->firstName), "JOEY");
    EXPECT_EQ(sval(r->lastName), "TESTER");
    EXPECT_EQ(sval(r->middleName), "MIDLAND");
    EXPECT_EQ(sval(r->licenseNumber), "H574712510891");
    EXPECT_EQ(sval(r->dateOfBirth), "1941-05-09");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "FL");
}

TEST(AAMVAMultiState, CT_v1_AAMVAHeader) {
    const std::string data =
        "@\n\nAAMVA6360060101DL00290179\n"
        "DAACTLIC,ADULT,A\n"
        "DAG60 STATE ST\nDAIWETHERSFIELD\n"
        "DAJCT\nDAK061091896\n"
        "DAQ990000001\nDBA20150101\n"
        "DBB19610101\nDBC2\nDBD20090223\n"
        "DAU506\nDAYBLU";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "CT v1: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(1));
    EXPECT_EQ(sval(r->firstName), "ADULT");
    EXPECT_EQ(sval(r->lastName), "CTLIC");
    EXPECT_EQ(sval(r->middleName), "A");
    EXPECT_EQ(sval(r->licenseNumber), "990000001");
    EXPECT_EQ(sval(r->dateOfBirth), "1961-01-01");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "CT");
}

TEST(AAMVAMultiState, DC_v1_HyphenatedLastName) {
    const std::string data =
        "@\n\nANSI 6360430102DL00390197ZD02360003\n"
        "DAAL-MAAR,DIANA,ROBIN\n"
        "DAG1234 14TH ST SW 1A\n"
        "DAIWASHINGTON\nDAJDC\nDAK20009-1234\n"
        "DAQ3234567\nDBA20210729\n"
        "DBB19850729\nDBC2\nDBD20130730\nDAU506";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "DC v1: should parse";
    EXPECT_EQ(sval(r->firstName), "DIANA");
    EXPECT_EQ(sval(r->lastName), "L-MAAR");
    EXPECT_EQ(sval(r->middleName), "ROBIN");
    EXPECT_EQ(sval(r->licenseNumber), "3234567");
    EXPECT_EQ(sval(r->dateOfBirth), "1985-07-29");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "DC");
}

TEST(AAMVAMultiState, SC_v1_TrailingCommaInDAA) {
    const std::string data =
        "@\n\nANSI 6360050101DL00300216\n"
        "DAQ102639206\n"
        "DAASMITH,MARY,ROBINS\n"
        "DAG209 CEDAR HILL DR UNIT 12\n"
        "DAISURFSIDE BEACH\nDAJSC\n"
        "DAK295754321\nDBA20190212\n"
        "DBB19720212\nDBC2\nDBD20090619\n"
        "DAU510\nDAW128";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "SC v1: should parse";
    EXPECT_EQ(sval(r->firstName), "MARY");
    EXPECT_EQ(sval(r->lastName), "SMITH");
    EXPECT_EQ(sval(r->middleName), "ROBINS");
    EXPECT_EQ(sval(r->licenseNumber), "102639206");
    EXPECT_EQ(sval(r->dateOfBirth), "1972-02-12");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "SC");
}

TEST(AAMVAMultiState, PA_v1_SpaceSeparatedNameInDAA) {
    // PA v1 has "JOHN P SMITH" in DAA — no commas, so DAA split by comma yields
    // only one component. lastName = "JOHN P SMITH", firstName = nil, middleName = nil.
    const std::string data =
        "@\n\nANSI 6360250101DL00290194\n"
        "DAQ26798765\n"
        "DAAJOHN P SMITH\n"
        "DAG140 MAIN ST\n"
        "DAIPHILADELPHIA\nDAJPA\nDAK19130\n"
        "DBA20200203\nDBB19860202\n"
        "DBC1\nDBD20160104\nDAU600\nDAYHAZ";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "PA v1: should parse";
    // Swift test expects: firstName=nil, lastName="JOHN P SMITH"
    EXPECT_EQ(sval(r->lastName), "JOHN P SMITH");
    EXPECT_FALSE(r->firstName.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "26798765");
    EXPECT_EQ(sval(r->dateOfBirth), "1986-02-02");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "PA");
}

TEST(AAMVAMultiState, NB_v2_CanadianCard) {
    const std::string data =
        "@\n\nANSI 636017020002DL00410390ZN04310059\n"
        "DCANONE\nDCBNONE\nDCDNONE\n"
        "DBA08082021\nDCSMOTORIST\n"
        "DCTMARY M\nDBD08122017\n"
        "DBB08081962\nDBC2\nDAU168 CM\n"
        "DAG123 EAGLEHEAD DR\nDAIGRND-BAY-WFLD\n"
        "DAJNB\nDAKE5K 1Y3\nDAQ1234567\nDCGCAN";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "NB v2: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(2));
    EXPECT_EQ(sval(r->firstName), "MARY M");
    EXPECT_EQ(sval(r->lastName), "MOTORIST");
    EXPECT_FALSE(r->middleName.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "1234567");
    EXPECT_EQ(sval(r->dateOfBirth), "1962-08-08");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "NB");
    EXPECT_EQ(sval(r->country), "CAN");
}

TEST(AAMVAMultiState, VA_v3_DCTCommaSeparated) {
    const std::string data =
        "@\nANSI 636000030001DL00310440\n"
        "DCANONE\nDCB158X9\nDCDS\n"
        "DBA08142017\nDCSMAURY\n"
        "DCTJUSTIN,WILLIAM\n"
        "DBD08142009\nDBB07151958\n"
        "DBC1\nDAYBRO\nDAU075 in\n"
        "DAG17 FIRST STREET\nDAISTAUNTON\n"
        "DAJVA\nDAK244010000\n"
        "DAQT16700185\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "VA v3: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(3));
    EXPECT_EQ(sval(r->firstName), "JUSTIN");
    EXPECT_EQ(sval(r->lastName), "MAURY");
    EXPECT_EQ(sval(r->middleName), "WILLIAM");
    EXPECT_EQ(sval(r->licenseNumber), "T16700185");
    EXPECT_EQ(sval(r->dateOfBirth), "1958-07-15");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "VA");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, TX_v3) {
    const std::string data =
        "@\n\nANSI 636015030002DL00410215ZT02560015\n"
        "DCAC\nDCBNONE\nDCDNONE\n"
        "DBA10242019\nDCSGONSALVES\n"
        "DCTROBERTO\nDBD10252014\n"
        "DBB10241993\nDBC1\nDAYBRO\n"
        "DAU65 IN\nDAG1254 FIRST\n"
        "DAIEL PASO\nDAJTX\nDAK79936\n"
        "DAQ37110073\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "TX v3: should parse";
    EXPECT_EQ(sval(r->firstName), "ROBERTO");
    EXPECT_EQ(sval(r->lastName), "GONSALVES");
    EXPECT_FALSE(r->middleName.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "37110073");
    EXPECT_EQ(sval(r->dateOfBirth), "1993-10-24");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "TX");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, ON_v3_Canadian) {
    const std::string data =
        "@\n\nANSI 636012030001DL00000367\n"
        "DCAG\nDCBNONE\nDCDNONE\n"
        "DBA20200603\nDCSTESTER\n"
        "DCTMARY,ANN\nDBD20170607\n"
        "DBB19960603\nDBC2\n"
        "DAYNONE\nDAU170 CM\n"
        "DAG123 ST GEORGE ST E\n"
        "DAIfergus\nDAJON\n"
        "DAKN1M 3J6\n"
        "DAQS9244-43879-65702\nDCGCAN";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "ON v3: should parse";
    EXPECT_EQ(sval(r->firstName), "MARY");
    EXPECT_EQ(sval(r->lastName), "TESTER");
    EXPECT_EQ(sval(r->middleName), "ANN");
    EXPECT_EQ(sval(r->licenseNumber), "S9244-43879-65702");
    EXPECT_EQ(sval(r->dateOfBirth), "1996-06-03");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "ON");
    EXPECT_EQ(sval(r->country), "CAN");
}

TEST(AAMVAMultiState, WA_v3) {
    const std::string data =
        "@\n\nANSI 636045030002DL00410226ZW02670051\n"
        "DCANONE\nDCBNONE\nDCDNONE\n"
        "DBA05232021\nDCSTESTER\n"
        "DCTMARY S\nDBD04162015\n"
        "DBB05231950\nDBC2\nDAYBRO\n"
        "DAU061 IN\nDAG16255 PEWDER CT SE\n"
        "DAIREDMOND\nDAJWA\n"
        "DAK980081234\nDAQTESTEDM504K9\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "WA v3: should parse";
    EXPECT_EQ(sval(r->firstName), "MARY S");
    EXPECT_EQ(sval(r->lastName), "TESTER");
    EXPECT_FALSE(r->middleName.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "TESTEDM504K9");
    EXPECT_EQ(sval(r->dateOfBirth), "1950-05-23");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "WA");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, CA_v4) {
    const std::string correct_data =
        "@\n\nANSI 636014040002DL00410278ZC03190034\n"
        "DCAC\nDCBNONE\nDCDNONE\n"
        "DBA07052019\nDCSHARPER\n"
        "DACELIJAH\nDADMASON\n"
        "DBD02022016\nDBB07051973\n"
        "DBC1\nDAYBLU\nDAU068 IN\n"
        "DAG671 BLUEBERRY HILL DR\n"
        "DAIMILPITAS\nDAJCA\n"
        "DAK950350000\nDAQF1485768\nDCGUSA";
    auto r = parse_aamva(correct_data);
    ASSERT_TRUE(r.has_value()) << "CA v4: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(4));
    EXPECT_EQ(sval(r->firstName), "ELIJAH");
    EXPECT_EQ(sval(r->lastName), "HARPER");
    EXPECT_EQ(sval(r->middleName), "MASON");
    EXPECT_EQ(sval(r->licenseNumber), "F1485768");
    EXPECT_EQ(sval(r->dateOfBirth), "1973-07-05");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "CA");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, IA_v4) {
    const std::string data =
        "@\n\nANSI 636018040102DL00410258ZI02990028\n"
        "DCAC\nDCBNONE\nDCDL\n"
        "DBA07112020\nDCSSMITH\n"
        "DACMARK\nDADMOTORIST\n"
        "DBD10162013\nDBB07111991\n"
        "DBC1\nDAYGRN\nDAU072 IN\n"
        "DAG123 ANY MAIN ST\n"
        "DAIRED OAK\nDAJIA\n"
        "DAK515660000\nDAQ109BB2608\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "IA v4: should parse";
    EXPECT_EQ(sval(r->firstName), "MARK");
    EXPECT_EQ(sval(r->lastName), "SMITH");
    EXPECT_EQ(sval(r->middleName), "MOTORIST");
    EXPECT_EQ(sval(r->licenseNumber), "109BB2608");
    EXPECT_EQ(sval(r->dateOfBirth), "1991-07-11");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "IA");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, IN_v4) {
    const std::string data =
        "@\n\nANSI 636037040002DL00410260ZI03010024\n"
        "DAQ3249-09-7547\nDCSMOTORIST\n"
        "DACRYAN\nDADMICHAEL\n"
        "DCANONE\nDCBNONE\nDCDNONE\n"
        "DBD08032016\nDBB02251993\n"
        "DBA02252023\nDBC1\nDAU069 IN\n"
        "DAYHAZ\nDAG12345 W HENCHMEN CIR\n"
        "DAIANYCITY\nDAJIN\n"
        "DAK474580000\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "IN v4: should parse";
    EXPECT_EQ(sval(r->firstName), "RYAN");
    EXPECT_EQ(sval(r->lastName), "MOTORIST");
    EXPECT_EQ(sval(r->middleName), "MICHAEL");
    EXPECT_EQ(sval(r->licenseNumber), "3249-09-7547");
    EXPECT_EQ(sval(r->dateOfBirth), "1993-02-25");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "IN");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, AR_v5) {
    const std::string data =
        "@\n\nANSI 636021050002DL00410232ZA02730015\n"
        "DCB\nDAQ9298847972\n"
        "DCAD\nDAK71901 4455\n"
        "DAJAR\nDAIHOT SPRINGS\n"
        "DAG321 MAIN ST\nDADRALPH\n"
        "DACMICHAEL\nDBD09132016\n"
        "DCSMOTORIST\nDBC1\n"
        "DBB11221946\nDBA11222024\n"
        "DAYBRO\nDCGUSA\nDAU070 IN";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "AR v5: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(5));
    EXPECT_EQ(sval(r->firstName), "MICHAEL");
    EXPECT_EQ(sval(r->lastName), "MOTORIST");
    EXPECT_EQ(sval(r->middleName), "RALPH");
    EXPECT_EQ(sval(r->licenseNumber), "9298847972");
    EXPECT_EQ(sval(r->dateOfBirth), "1946-11-22");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "AR");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, KY_v5) {
    const std::string data =
        "@\n\nANSI 636046050002DL00410264ZK03050035\n"
        "DAQK12340057\nDCSSMITH\n"
        "DACMARY\nDADANN\n"
        "DCAD\nDCB1\nDCDNONE\n"
        "DBD11222017\nDBB11121954\n"
        "DBA12132021\nDBC2\nDAU065 IN\n"
        "DAYHAZ\nDAG123 WISTERIA LN 23\n"
        "DAILOUISVILLE\nDAJKY\n"
        "DAK402180000\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "KY v5: should parse";
    EXPECT_EQ(sval(r->firstName), "MARY");
    EXPECT_EQ(sval(r->lastName), "SMITH");
    EXPECT_EQ(sval(r->middleName), "ANN");
    EXPECT_EQ(sval(r->licenseNumber), "K12340057");
    EXPECT_EQ(sval(r->dateOfBirth), "1954-11-12");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "KY");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, TN_v6_IDCard) {
    const std::string tn_data =
        "@\n\nANSI 636053060002ID00410228ZT02690036\n"
        "DAQ115775955\nDCSSMITH\n"
        "DACELIZABETH\nDADMOTORIST\n"
        "DBD02062018\nDBB12131961\n"
        "DBA02062026\nDBC2\n"
        "DAU063 IN\nDAYGRN\n"
        "DAG21078 MAGNOLIA RD\n"
        "DAINASHVILLE\nDAJTN\n"
        "DAK370115509\nDCGUSA";
    auto r = parse_aamva(tn_data);
    ASSERT_TRUE(r.has_value()) << "TN v6: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(6));
    EXPECT_EQ(sval(r->firstName), "ELIZABETH");
    EXPECT_EQ(sval(r->lastName), "SMITH");
    EXPECT_EQ(sval(r->middleName), "MOTORIST");
    EXPECT_EQ(sval(r->licenseNumber), "115775955");
    EXPECT_EQ(sval(r->dateOfBirth), "1961-12-13");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "TN");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, CO_v7) {
    const std::string data =
        "@\n\nANSI 636020070002DL00410224ZC02650010\n"
        "DAQ102367033\nDCSMOTORIST\n"
        "DACMICHAEL\nDADCODY\n"
        "DCAR\nDCBNONE\nDCDNONE\n"
        "DBD08082013\nDBB07131992\n"
        "DBA07132018\nDBC1\n"
        "DAU073 IN\nDAYGRN\n"
        "DAG909 COUNTRY ROAD 206\n"
        "DAIBOULDER\nDAJCO\n"
        "DAK816350000\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "CO v7: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(7));
    EXPECT_EQ(sval(r->firstName), "MICHAEL");
    EXPECT_EQ(sval(r->lastName), "MOTORIST");
    EXPECT_EQ(sval(r->middleName), "CODY");
    EXPECT_EQ(sval(r->licenseNumber), "102367033");
    EXPECT_EQ(sval(r->dateOfBirth), "1992-07-13");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "CO");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, NY_v7_MixedCaseNames) {
    const std::string data =
        "@\nANSI 636001070002DL00410392ZN04330047\n"
        "DCANONE\nDCBNONE\nDCDNONE\n"
        "DBA08312013\nDCSMichael\n"
        "DACM\nDADMotorist\n"
        "DBD08312013\nDBB08312013\n"
        "DBC1\nDAYBRO\nDAU064 in\n"
        "DAG2345 ANYWHERE STREET\n"
        "DAIYOUR CITY\nDAJNY\n"
        "DAK123450000\nDAQNONE\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "NY v7: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(7));
    EXPECT_EQ(sval(r->firstName), "M");
    EXPECT_EQ(sval(r->lastName), "Michael");
    EXPECT_EQ(sval(r->middleName), "Motorist");
    EXPECT_EQ(sval(r->licenseNumber), "NONE");
    EXPECT_EQ(sval(r->dateOfBirth), "2013-08-31");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "NY");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, OH_v8) {
    const std::string data =
        "@\n\nANSI 636023080102DL00410270ZO03110024\n"
        "DBA02232020\nDCSMOTORIST\n"
        "DACDEBBIE\nDADT\n"
        "DBD12022016\nDBB02231956\n"
        "DBC2\nDAYBRO\nDAU060 IN\n"
        "DAG102 PARK AVE\n"
        "DAINORTHWOOD\nDAJOH\n"
        "DAK436191234\nDAQPJ842270\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "OH v8: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(8));
    EXPECT_EQ(sval(r->firstName), "DEBBIE");
    EXPECT_EQ(sval(r->lastName), "MOTORIST");
    EXPECT_EQ(sval(r->middleName), "T");
    EXPECT_EQ(sval(r->licenseNumber), "PJ842270");
    EXPECT_EQ(sval(r->dateOfBirth), "1956-02-23");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "OH");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, NC_v8_MultiWordLastName) {
    const std::string data =
        "@\n\nANSI 636004080002DL00410286ZN03270015\n"
        "DAQ00004985690\n"
        "DCSMORALES MARTIZ\n"
        "DACRICK\nDADSANTIAGO\n"
        "DCAC\nDCBNONE\nDCDNONE\n"
        "DBD11162017\nDBB06121986\n"
        "DBA06122025\nDBC1\n"
        "DAU069 IN\nDAYBRO\n"
        "DAG1440 BROWN TER\n"
        "DAIFAYETTEVILLE\nDAJNC\n"
        "DAK283041234\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "NC v8: should parse";
    EXPECT_EQ(sval(r->firstName), "RICK");
    EXPECT_EQ(sval(r->lastName), "MORALES MARTIZ");
    EXPECT_EQ(sval(r->middleName), "SANTIAGO");
    EXPECT_EQ(sval(r->licenseNumber), "00004985690");
    EXPECT_EQ(sval(r->dateOfBirth), "1986-06-12");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "NC");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, IL_v8) {
    const std::string data =
        "@\n\nANSI 636035080002DL00410281ZI03220021\n"
        "DAQW63177069784\nDCSMOTORIST\n"
        "DACSUSAN\nDADT\n"
        "DCAD\nDCBNONE\nDCDNONE\n"
        "DBD04132017\nDBB06271969\n"
        "DBA06272021\nDBC2\n"
        "DAU068 IN\nDAYGRN\n"
        "DAG123 LAKE SHORE DR APT\n"
        "DAICHICAGO\nDAJIL\n"
        "DAK606110000\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "IL v8: should parse";
    EXPECT_EQ(sval(r->firstName), "SUSAN");
    EXPECT_EQ(sval(r->lastName), "MOTORIST");
    EXPECT_EQ(sval(r->middleName), "T");
    EXPECT_EQ(sval(r->licenseNumber), "W63177069784");
    EXPECT_EQ(sval(r->dateOfBirth), "1969-06-27");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "IL");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, MA_v8) {
    const std::string data =
        "@\n\nANSI 636002080002DL00410260ZM06020044\n"
        "DCAD\nDCBNONE\nDCDNONE\n"
        "DBA08162021\nDCSSAMPLE\n"
        "DACMORRIS\nDADT\n"
        "DBD08092016\nDBB12311971\n"
        "DBC1\nDAU062 in\n"
        "DAG24 BEACON STREET\n"
        "DAIBOSTON\nDAJMA\n"
        "DAK021330000\nDAQS12345678\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "MA v8: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(8));
    EXPECT_EQ(sval(r->firstName), "MORRIS");
    EXPECT_EQ(sval(r->lastName), "SAMPLE");
    EXPECT_EQ(sval(r->middleName), "T");
    EXPECT_EQ(sval(r->licenseNumber), "S12345678");
    EXPECT_EQ(sval(r->dateOfBirth), "1971-12-31");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "MA");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, PA_v9) {
    const std::string data =
        "@\n\nANSI 636025090002DL00410264ZP03050027\n"
        "DAQ25881776\nDCSMORGAN\n"
        "DACCAPTAIN\nDADJACK\n"
        "DCAC\nDCB1\nDCDNONE\n"
        "DBD11282017\nDBB05221960\n"
        "DBA05232021\nDBC1\n"
        "DAU071 IN\nDAYBRO\n"
        "DAG1725 SLOUGH AVE\n"
        "DAISCRANON\nDAJPA\n"
        "DAK185030000\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "PA v9: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(9));
    EXPECT_EQ(sval(r->firstName), "CAPTAIN");
    EXPECT_EQ(sval(r->lastName), "MORGAN");
    EXPECT_EQ(sval(r->middleName), "JACK");
    EXPECT_EQ(sval(r->licenseNumber), "25881776");
    EXPECT_EQ(sval(r->dateOfBirth), "1960-05-22");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "PA");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, PE_v9_Canadian) {
    const std::string data =
        "@\n\nANSI 604426090101DL00310233\n"
        "DCA5\nDCBNONE\nDCDNONE\n"
        "DBA20200904\nDCSFLOWERS\n"
        "DACPATTY\nDADNONE\n"
        "DBD20171222\nDBB19550904\n"
        "DBC2\nDAYBLU\nDAU157 CM\n"
        "DAG123 NORTH LAKE SHORE DR\n"
        "DAIANYTTOWN\nDAJPE\n"
        "DAKC0A 2B4\nDAQ247725\nDCGCAN";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "PE v9: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(9));
    EXPECT_EQ(sval(r->firstName), "PATTY");
    EXPECT_EQ(sval(r->lastName), "FLOWERS");
    EXPECT_EQ(sval(r->middleName), "NONE");
    EXPECT_EQ(sval(r->licenseNumber), "247725");
    EXPECT_EQ(sval(r->dateOfBirth), "1955-09-04");
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_EQ(sval(r->state), "PE");
    EXPECT_EQ(sval(r->country), "CAN");
}

TEST(AAMVAMultiState, MN_v9) {
    const std::string data =
        "@\n\nANSI 636038090002DL00410277ZM03180012\n"
        "DAQH868087743210\nDCSSPARKS\n"
        "DACDALE\nDADTHOR\n"
        "DCAD\nDCB2\nDCDNONE\n"
        "DBD12222018\nDBB01041995\n"
        "DBA01042020\nDBC1\n"
        "DAU070 IN\nDAYGRN\n"
        "DAG12345 MAIN ST\n"
        "DAAITKIN\nDAJMN\n"
        "DAK564311234\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "MN v9: should parse";
    EXPECT_EQ(sval(r->firstName), "DALE");
    EXPECT_EQ(sval(r->lastName), "SPARKS");
    EXPECT_EQ(sval(r->middleName), "THOR");
    EXPECT_EQ(sval(r->licenseNumber), "H868087743210");
    EXPECT_EQ(sval(r->dateOfBirth), "1995-01-04");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "MN");
    EXPECT_EQ(sval(r->country), "USA");
}

TEST(AAMVAMultiState, VA_v10) {
    const std::string data =
        "@\n\x1E\r"
        "ANSI 636000100102DL00410278ZV03190008\n"
        "DLDAQT64235789\n"
        "DCSSAMPLE\nDACMICHAEL\n"
        "DADJOHN\nDCUJR\n"
        "DCAD\nDCBK\nDCDPH\n"
        "DBD06062019\nDBB06061986\n"
        "DBA12102024\nDBC1\n"
        "DAU068 in\nDAYBRO\n"
        "DAG2300 WEST BROAD STREET\n"
        "DAIRICHMOND\nDAJVA\n"
        "DAK232690000\nDCGUSA";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value()) << "VA v10: should parse";
    EXPECT_EQ(r->aamvaVersion, std::optional<int>(10));
    EXPECT_EQ(sval(r->firstName), "MICHAEL");
    EXPECT_EQ(sval(r->lastName), "SAMPLE");
    EXPECT_EQ(sval(r->middleName), "JOHN");
    EXPECT_EQ(sval(r->licenseNumber), "T64235789");
    EXPECT_EQ(sval(r->dateOfBirth), "1986-06-06");
    EXPECT_EQ(sval(r->sex), "M");
    EXPECT_EQ(sval(r->state), "VA");
    EXPECT_EQ(sval(r->country), "USA");
}

// ============================================================================
// Header Embedded Data Tests
// ============================================================================

TEST(AAMVAHeaderEmbedded, DLPlusDAAEmbedded) {
    const std::string data =
        "ANSI 6360100102DL00390187ZF02260043DLDAATESTER,JOEY,MIDLAND\n"
        "DAG123 MAIN ST\nDAJFL\nDAQ555123";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->firstName), "JOEY");
    EXPECT_EQ(sval(r->lastName), "TESTER");
    EXPECT_EQ(sval(r->licenseNumber), "555123");
}

TEST(AAMVAHeaderEmbedded, DAAWithoutDLMarker) {
    const std::string data =
        "AAMVA6360060101DL00290179DAACTLIC,ADULT,A\n"
        "DAG60 STATE ST\nDAJCT\nDAQ990000001";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->firstName), "ADULT");
    EXPECT_EQ(sval(r->lastName), "CTLIC");
}

TEST(AAMVAHeaderEmbedded, NoEmbeddedDataNormalParsing) {
    const std::string data =
        "ANSI 636000090002DL00410278ZV03190008\n"
        "DAQ123456\nDCSSMITH";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "123456");
    EXPECT_EQ(sval(r->lastName), "SMITH");
}

// ============================================================================
// Fix 3: Calendar date validation — impossible dates must be rejected
// ============================================================================

TEST(AAMVADateValidation, InvalidDateFeb30Rejected) {
    // Feb 30 is not a real date — mktime round-trip should reject it.
    // MMddyyyy format: "02302000" = Feb 30 2000
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ123456\nDCSSMITH\nDACJOHN\nDBB02302000";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value()) << "Feb 30 is not a real date; DOB must be nullopt";
}

TEST(AAMVADateValidation, ValidDateFeb28Accepted) {
    // Feb 28 is a valid date
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ123456\nDCSSMITH\nDACJOHN\nDBB02281990";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1990-02-28");
}

// ============================================================================
// Fix 4: Strict integer parsing — non-digit characters must be rejected
// ============================================================================

TEST(AAMVADateValidation, CorruptedDateNonDigitRejected) {
    // "1A012000" in MMddyyyy: month="1A" is not all-digits; DOB must be nullopt
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ123456\nDCSSMITH\nDACJOHN\nDBB1A012000";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value()) << "Non-digit date segment must yield nullopt";
}

// ============================================================================
// Fix 5: split_char with skip_empty — double-comma and leading-comma in DAA
// ============================================================================

TEST(AAMVANameParsing, DAADoubleCommaSkipsEmpty) {
    // "LAST,,MIDDLE" — Swift split omits the empty component between commas.
    // So index 0 = LAST, index 1 = MIDDLE (not the blank in between).
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ123\nDAALAST,,MIDDLE";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "LAST");
    EXPECT_EQ(sval(r->firstName), "MIDDLE");
}

TEST(AAMVANameParsing, DAALeadingCommaSkipsEmpty) {
    // ",FIRST" — Swift split omits the leading empty component.
    // So index 0 = FIRST (the last-name slot).
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ123\nDAA,FIRST";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "FIRST");
    EXPECT_FALSE(r->firstName.has_value()) << "No second component; firstName must be nullopt";
}

// ============================================================================
// PDF417 Confidence Stamping (task #43 follow-up — barcode side)
// ============================================================================

TEST(AAMVAConfidence, EveryPopulatedFieldGetsCrossValidated) {
    // PDF417 is a digital decode of the issuing-authority-encoded string,
    // so every populated field is by definition CrossValidated (1.00).
    const std::string data =
        "@\n\x1E\nANSI 636000090002DL\n"
        "DAQD1234567\n"
        "DCSSMITH\n"
        "DACJOHN\n"
        "DBB08151990\n"
        "DBA08152030\n"
        "DBD08152024\n"
        "DBC1\n"            // sex = 1 → M
        "DAY BRO\n"
        "DAU070 in\n"
        "DAG123 MAIN ST\n"
        "DAISPRINGFIELD\n"
        "DAJIL\n"
        "DAK627010000\n"
        "DCA D\n"
        "DCBNONE\n"
        "DCDNONE";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    auto& conf = r->fieldConfidence;
    // Every populated field MUST have a 1.00 stamp.
    EXPECT_FLOAT_EQ(conf.at("firstName"),      1.00f);
    EXPECT_FLOAT_EQ(conf.at("lastName"),       1.00f);
    EXPECT_FLOAT_EQ(conf.at("licenseNumber"),  1.00f);
    EXPECT_FLOAT_EQ(conf.at("dateOfBirth"),    1.00f);
    EXPECT_FLOAT_EQ(conf.at("expirationDate"), 1.00f);
    EXPECT_FLOAT_EQ(conf.at("issueDate"),      1.00f);
    EXPECT_FLOAT_EQ(conf.at("sex"),            1.00f);
    EXPECT_FLOAT_EQ(conf.at("street"),         1.00f);
    EXPECT_FLOAT_EQ(conf.at("city"),           1.00f);
    EXPECT_FLOAT_EQ(conf.at("state"),          1.00f);
    EXPECT_FLOAT_EQ(conf.at("country"),        1.00f);  // default "USA"
}

TEST(AAMVAConfidence, AbsentFieldsGetNoStamp) {
    // Minimum-viable AAMVA: only DCS / DAC. No other fields populated →
    // no other confidence entries.
    const std::string data =
        "@\n\x1E\nANSI 636000040002DL\nDAQ1\nDCSDOE\nDACJANE";
    auto r = parse_aamva(data);
    ASSERT_TRUE(r.has_value());
    auto& conf = r->fieldConfidence;
    EXPECT_FLOAT_EQ(conf.at("firstName"),     1.00f);
    EXPECT_FLOAT_EQ(conf.at("lastName"),      1.00f);
    EXPECT_FLOAT_EQ(conf.at("licenseNumber"), 1.00f);
    // country defaults to "USA" so it IS stamped — that's intentional.
    EXPECT_FLOAT_EQ(conf.at("country"),       1.00f);
    // Fields that weren't in the input must NOT have a confidence entry.
    EXPECT_EQ(conf.count("dateOfBirth"),   0u);
    EXPECT_EQ(conf.count("eyeColor"),      0u);
    EXPECT_EQ(conf.count("vehicleClass"),  0u);
}
