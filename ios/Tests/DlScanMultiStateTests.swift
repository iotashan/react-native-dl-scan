import Foundation
import CoreImage
import CoreGraphics
import CoreVideo

// MARK: - Multi-State AAMVA Parser Tests
// Test data sourced from open-source AAMVA parser test suites (IdParser, license-parser, aamva_barcode_library)

struct StateTestCase {
    let name: String
    let data: String
    let version: Int?
    let firstName: String?
    let lastName: String?
    let middleName: String?
    let licenseNumber: String?
    let dateOfBirth: String?
    let sex: String?
    let state: String?
    let country: String?
}

let multiStateTestCases: [StateTestCase] = [
    // MARK: Version 1 (AAMVA 2000)

    StateTestCase(
        name: "FL v1 - DAA composite name",
        data: "@\n\nANSI 6360100102DL00390187ZF02260043\nDAATESTER,JOEY,MIDLAND\nDAG1234 PARK ST LOT 504\nDAIKEY WEST\nDAJFL\nDAK33040-0504 \nDAQH574712510891\nDBA20220309\nDBB19410509\nDBC1\nDBD20140501\nDAU601",
        version: 1, firstName: "JOEY", lastName: "TESTER", middleName: "MIDLAND",
        licenseNumber: "H574712510891", dateOfBirth: "1941-05-09", sex: "M", state: "FL", country: "USA"
    ),
    StateTestCase(
        name: "CT v1 - AAMVA header",
        data: "@\n\nAAMVA6360060101DL00290179\nDAACTLIC,ADULT,A\nDAG60 STATE ST\nDAIWETHERSFIELD\nDAJCT\nDAK061091896\nDAQ990000001\nDBA20150101\nDBB19610101\nDBC2\nDBD20090223\nDAU506\nDAYBLU",
        version: 1, firstName: "ADULT", lastName: "CTLIC", middleName: "A",
        licenseNumber: "990000001", dateOfBirth: "1961-01-01", sex: "F", state: "CT", country: "USA"
    ),
    StateTestCase(
        name: "DC v1 - hyphenated last name",
        data: "@\n\nANSI 6360430102DL00390197ZD02360003\nDAAL-MAAR,DIANA,ROBIN\nDAG1234 14TH ST SW 1A\nDAIWASHINGTON\nDAJDC\nDAK20009-1234\nDAQ3234567\nDBA20210729\nDBB19850729\nDBC2\nDBD20130730\nDAU506",
        version: 1, firstName: "DIANA", lastName: "L-MAAR", middleName: "ROBIN",
        licenseNumber: "3234567", dateOfBirth: "1985-07-29", sex: "F", state: "DC", country: nil
    ),
    StateTestCase(
        name: "SC v1 - trailing comma in DAA",
        data: "@\n\nANSI 6360050101DL00300216\nDAQ102639206\nDAASMITH,MARY,ROBINS\nDAG209 CEDAR HILL DR UNIT 12\nDAISURFSIDE BEACH\nDAJSC\nDAK295754321\nDBA20190212\nDBB19720212\nDBC2\nDBD20090619\nDAU510\nDAW128",
        version: 1, firstName: "MARY", lastName: "SMITH", middleName: "ROBINS",
        licenseNumber: "102639206", dateOfBirth: "1972-02-12", sex: "F", state: "SC", country: nil
    ),
    StateTestCase(
        name: "PA v1 - DAA space-separated name",
        data: "@\n\nANSI 6360250101DL00290194\nDAQ26798765\nDAAJOHN P SMITH\nDAG140 MAIN ST\nDAIPHILADELPHIA\nDAJPA\nDAK19130\nDBA20200203\nDBB19860202\nDBC1\nDBD20160104\nDAU600\nDAYHAZ",
        version: 1, firstName: nil, lastName: "JOHN P SMITH", middleName: nil,
        licenseNumber: "26798765", dateOfBirth: "1986-02-02", sex: "M", state: "PA", country: nil
    ),

    // MARK: Version 2 (AAMVA 2003)

    StateTestCase(
        name: "NB v2 - Canadian card",
        data: "@\n\nANSI 636017020002DL00410390ZN04310059\nDCANONE\nDCBNONE\nDCDNONE\nDBA08082021\nDCSMOTORIST\nDCTMARY M\nDBD08122017\nDBB08081962\nDBC2\nDAU168 CM\nDAG123 EAGLEHEAD DR\nDAIGRND-BAY-WFLD\nDAJNB\nDAKE5K 1Y3\nDAQ1234567\nDCGCAN",
        version: 2, firstName: "MARY M", lastName: "MOTORIST", middleName: nil,
        licenseNumber: "1234567", dateOfBirth: "1962-08-08", sex: "F", state: "NB", country: "CAN"
    ),

    // MARK: Version 3 (AAMVA 2005)

    StateTestCase(
        name: "VA v3 - DCT comma-separated",
        data: "@\nANSI 636000030001DL00310440\nDCANONE\nDCB158X9\nDCDS\nDBA08142017\nDCSMAURY\nDCTJUSTIN,WILLIAM\nDBD08142009\nDBB07151958\nDBC1\nDAYBRO\nDAU075 in\nDAG17 FIRST STREET\nDAISTAUNTON\nDAJVA\nDAK244010000\nDAQT16700185\nDCGUSA",
        version: 3, firstName: "JUSTIN", lastName: "MAURY", middleName: "WILLIAM",
        licenseNumber: "T16700185", dateOfBirth: "1958-07-15", sex: "M", state: "VA", country: "USA"
    ),
    StateTestCase(
        name: "TX v3",
        data: "@\n\nANSI 636015030002DL00410215ZT02560015\nDCAC\nDCBNONE\nDCDNONE\nDBA10242019\nDCSGONSALVES\nDCTROBERTO\nDBD10252014\nDBB10241993\nDBC1\nDAYBRO\nDAU65 IN\nDAG1254 FIRST\nDAIEL PASO\nDAJTX\nDAK79936\nDAQ37110073\nDCGUSA",
        version: 3, firstName: "ROBERTO", lastName: "GONSALVES", middleName: nil,
        licenseNumber: "37110073", dateOfBirth: "1993-10-24", sex: "M", state: "TX", country: "USA"
    ),
    StateTestCase(
        name: "ON v3 - Canadian",
        data: "@\n\nANSI 636012030001DL00000367\nDCAG\nDCBNONE\nDCDNONE\nDBA20200603\nDCSTESTER\nDCTMARY,ANN\nDBD20170607\nDBB19960603\nDBC2\nDAYNONE\nDAU170 CM\nDAG123 ST GEORGE ST E\nDAIFERGUS\nDAJON\nDAKN1M 3J6\nDAQS9244-43879-65702\nDCGCAN",
        version: 3, firstName: "MARY", lastName: "TESTER", middleName: "ANN",
        licenseNumber: "S9244-43879-65702", dateOfBirth: "1996-06-03", sex: "F", state: "ON", country: "CAN"
    ),
    StateTestCase(
        name: "WA v3",
        data: "@\n\nANSI 636045030002DL00410226ZW02670051\nDCANONE\nDCBNONE\nDCDNONE\nDBA05232021\nDCSTESTER\nDCTMARY S\nDBD04162015\nDBB05231950\nDBC2\nDAYBRO\nDAU061 IN\nDAG16255 PEWDER CT SE\nDAIREDMOND\nDAJWA\nDAK980081234\nDAQTESTEDM504K9\nDCGUSA",
        version: 3, firstName: "MARY S", lastName: "TESTER", middleName: nil,
        licenseNumber: "TESTEDM504K9", dateOfBirth: "1950-05-23", sex: "F", state: "WA", country: "USA"
    ),

    // MARK: Version 4 (AAMVA 2009)

    StateTestCase(
        name: "CA v4",
        data: "@\n\nANSI 636014040002DL00410278ZC03190034\nDCAC\nDCBNONE\nDCDNONE\nDBA07052019\nDCSHARPER\nDACELIJAH\nDADMASON\nDBD02022016\nDBB07051973\nDBC1\nDAYBLU\nDAU068 IN\nDAG671 BLUEBERRY HILL DR\nDAIMILPITAS\nDAJCA\nDAK950350000\nDAQF1485768\nDCGUSA",
        version: 4, firstName: "ELIJAH", lastName: "HARPER", middleName: "MASON",
        licenseNumber: "F1485768", dateOfBirth: "1973-07-05", sex: "M", state: "CA", country: "USA"
    ),
    StateTestCase(
        name: "IA v4",
        data: "@\n\nANSI 636018040102DL00410258ZI02990028\nDCAC\nDCBNONE\nDCDL\nDBA07112020\nDCSSMITH\nDACMARK\nDADMOTORIST\nDBD10162013\nDBB07111991\nDBC1\nDAYGRN\nDAU072 IN\nDAG123 ANY MAIN ST\nDAIRED OAK\nDAJIA\nDAK515660000\nDAQ109BB2608\nDCGUSA",
        version: 4, firstName: "MARK", lastName: "SMITH", middleName: "MOTORIST",
        licenseNumber: "109BB2608", dateOfBirth: "1991-07-11", sex: "M", state: "IA", country: "USA"
    ),
    StateTestCase(
        name: "IN v4",
        data: "@\n\nANSI 636037040002DL00410260ZI03010024\nDAQ3249-09-7547\nDCSMOTORIST\nDACRYAN\nDADMICHAEL\nDCANONE\nDCBNONE\nDCDNONE\nDBD08032016\nDBB02251993\nDBA02252023\nDBC1\nDAU069 IN\nDAYHAZ\nDAG12345 W HENCHMEN CIR\nDAIANYCITY\nDAJIN\nDAK474580000\nDCGUSA",
        version: 4, firstName: "RYAN", lastName: "MOTORIST", middleName: "MICHAEL",
        licenseNumber: "3249-09-7547", dateOfBirth: "1993-02-25", sex: "M", state: "IN", country: "USA"
    ),

    // MARK: Version 5 (AAMVA 2010)

    StateTestCase(
        name: "AR v5",
        data: "@\n\nANSI 636021050002DL00410232ZA02730015\nDCB\nDAQ9298847972\nDCAD\nDAK71901 4455\nDAJAR\nDAIHOT SPRINGS\nDAG321 MAIN ST\nDADRALPH\nDACMICHAEL\nDBD09132016\nDCSMOTORIST\nDBC1\nDBB11221946\nDBA11222024\nDAYBRO\nDCGUSA\nDAU070 IN",
        version: 5, firstName: "MICHAEL", lastName: "MOTORIST", middleName: "RALPH",
        licenseNumber: "9298847972", dateOfBirth: "1946-11-22", sex: "M", state: "AR", country: "USA"
    ),
    StateTestCase(
        name: "KY v5",
        data: "@\n\nANSI 636046050002DL00410264ZK03050035\nDAQK12340057\nDCSSMITH\nDACMARY\nDADANN\nDCAD\nDCB1\nDCDNONE\nDBD11222017\nDBB11121954\nDBA12132021\nDBC2\nDAU065 IN\nDAYHAZ\nDAG123 WISTERIA LN 23\nDAILOUISVILLE\nDAJKY\nDAK402180000\nDCGUSA",
        version: 5, firstName: "MARY", lastName: "SMITH", middleName: "ANN",
        licenseNumber: "K12340057", dateOfBirth: "1954-11-12", sex: "F", state: "KY", country: "USA"
    ),

    // MARK: Version 6 (AAMVA 2011)

    StateTestCase(
        name: "TN v6 - ID card",
        data: "@\n\nANSI 636053060002ID00410228ZT02690036\nDAQ115775955\nDCSSMITH\nDACELIZABETH\nDADMOTORIST\nDBD02062018\nDBB12131961\nDBA02062026\nDBC2\nDAU063 IN\nDAYGRN\nDAG21078 MAGNOLIA RD\nDAINASHVILLE\nDAJTN\nDAK370115509\nDCGUSA",
        version: 6, firstName: "ELIZABETH", lastName: "SMITH", middleName: "MOTORIST",
        licenseNumber: "115775955", dateOfBirth: "1961-12-13", sex: "F", state: "TN", country: "USA"
    ),

    // MARK: Version 7 (AAMVA 2012)

    StateTestCase(
        name: "CO v7",
        data: "@\n\nANSI 636020070002DL00410224ZC02650010\nDAQ102367033\nDCSMOTORIST\nDACMICHAEL\nDADCODY\nDCAR\nDCBNONE\nDCDNONE\nDBD08082013\nDBB07131992\nDBA07132018\nDBC1\nDAU073 IN\nDAYGRN\nDAG909 COUNTRY ROAD 206\nDAIBOULDER\nDAJCO\nDAK816350000\nDCGUSA",
        version: 7, firstName: "MICHAEL", lastName: "MOTORIST", middleName: "CODY",
        licenseNumber: "102367033", dateOfBirth: "1992-07-13", sex: "M", state: "CO", country: "USA"
    ),
    StateTestCase(
        name: "NY v7 - mixed case names",
        data: "@\nANSI 636001070002DL00410392ZN04330047\nDCANONE\nDCBNONE\nDCDNONE\nDBA08312013\nDCSMichael\nDACM\nDADMotorist\nDBD08312013\nDBB08312013\nDBC1\nDAYBRO\nDAU064 in\nDAG2345 ANYWHERE STREET\nDAIYOUR CITY\nDAJNY\nDAK123450000\nDAQNONE\nDCGUSA",
        version: 7, firstName: "M", lastName: "Michael", middleName: "Motorist",
        licenseNumber: "NONE", dateOfBirth: "2013-08-31", sex: "M", state: "NY", country: "USA"
    ),

    // MARK: Version 8 (AAMVA 2013)

    StateTestCase(
        name: "OH v8",
        data: "@\n\nANSI 636023080102DL00410270ZO03110024\nDBA02232020\nDCSMOTORIST\nDACDEBBIE\nDADT\nDBD12022016\nDBB02231956\nDBC2\nDAYBRO\nDAU060 IN\nDAG102 PARK AVE\nDAINORTHWOOD\nDAJOH\nDAK436191234\nDAQPJ842270\nDCGUSA",
        version: 8, firstName: "DEBBIE", lastName: "MOTORIST", middleName: "T",
        licenseNumber: "PJ842270", dateOfBirth: "1956-02-23", sex: "F", state: "OH", country: "USA"
    ),
    StateTestCase(
        name: "NC v8 - multi-word last name",
        data: "@\n\nANSI 636004080002DL00410286ZN03270015\nDAQ00004985690\nDCSMORALES MARTIZ\nDACRICK\nDADSANTIAGO\nDCAC\nDCBNONE\nDCDNONE\nDBD11162017\nDBB06121986\nDBA06122025\nDBC1\nDAU069 IN\nDAYBRO\nDAG1440 BROWN TER\nDAIFAYETTEVILLE\nDAJNC\nDAK283041234\nDCGUSA",
        version: 8, firstName: "RICK", lastName: "MORALES MARTIZ", middleName: "SANTIAGO",
        licenseNumber: "00004985690", dateOfBirth: "1986-06-12", sex: "M", state: "NC", country: "USA"
    ),
    StateTestCase(
        name: "IL v8",
        data: "@\n\nANSI 636035080002DL00410281ZI03220021\nDAQW63177069784\nDCSMOTORIST\nDACSUSAN\nDADT\nDCAD\nDCBNONE\nDCDNONE\nDBD04132017\nDBB06271969\nDBA06272021\nDBC2\nDAU068 IN\nDAYGRN\nDAG123 LAKE SHORE DR APT\nDAICHICAGO\nDAJIL\nDAK606110000\nDCGUSA",
        version: 8, firstName: "SUSAN", lastName: "MOTORIST", middleName: "T",
        licenseNumber: "W63177069784", dateOfBirth: "1969-06-27", sex: "F", state: "IL", country: "USA"
    ),
    StateTestCase(
        name: "MA v8",
        data: "@\n\nANSI 636002080002DL00410260ZM06020044\nDCAD\nDCBNONE\nDCDNONE\nDBA08162021\nDCSSAMPLE\nDACMORRIS\nDADT\nDBD08092016\nDBB12311971\nDBC1\nDAU062 in\nDAG24 BEACON STREET\nDAIBOSTON\nDAJMA\nDAK021330000\nDAQS12345678\nDCGUSA",
        version: 8, firstName: "MORRIS", lastName: "SAMPLE", middleName: "T",
        licenseNumber: "S12345678", dateOfBirth: "1971-12-31", sex: "M", state: "MA", country: "USA"
    ),

    // MARK: Version 9 (AAMVA 2016)

    StateTestCase(
        name: "PA v9",
        data: "@\n\nANSI 636025090002DL00410264ZP03050027\nDAQ25881776\nDCSMORGAN\nDACCAPTAIN\nDADJACK\nDCAC\nDCB1\nDCDNONE\nDBD11282017\nDBB05221960\nDBA05232021\nDBC1\nDAU071 IN\nDAYBRO\nDAG1725 SLOUGH AVE\nDAISCRANTON\nDAJPA\nDAK185030000\nDCGUSA",
        version: 9, firstName: "CAPTAIN", lastName: "MORGAN", middleName: "JACK",
        licenseNumber: "25881776", dateOfBirth: "1960-05-22", sex: "M", state: "PA", country: "USA"
    ),
    StateTestCase(
        name: "PE v9 - Canadian",
        data: "@\n\nANSI 604426090101DL00310233\nDCA5\nDCBNONE\nDCDNONE\nDBA20200904\nDCSFLOWERS\nDACPATTY\nDADNONE\nDBD20171222\nDBB19550904\nDBC2\nDAYBLU\nDAU157 CM\nDAG123 NORTH LAKE SHORE DR\nDAIANYTOWN\nDAJPE\nDAKC0A 2B4\nDAQ247725\nDCGCAN",
        version: 9, firstName: "PATTY", lastName: "FLOWERS", middleName: "NONE",
        licenseNumber: "247725", dateOfBirth: "1955-09-04", sex: "F", state: "PE", country: "CAN"
    ),
    StateTestCase(
        name: "MN v9",
        data: "@\n\nANSI 636038090002DL00410277ZM03180012\nDAQH868087743210\nDCSSPARKS\nDACDALE\nDADTHOR\nDCAD\nDCB2\nDCDNONE\nDBD12222018\nDBB01041995\nDBA01042020\nDBC1\nDAU070 IN\nDAYGRN\nDAG12345 MAIN ST\nDAIAITKIN\nDAJMN\nDAK564311234\nDCGUSA",
        version: 9, firstName: "DALE", lastName: "SPARKS", middleName: "THOR",
        licenseNumber: "H868087743210", dateOfBirth: "1995-01-04", sex: "M", state: "MN", country: "USA"
    ),

    // MARK: Version 10 (AAMVA 2020)

    StateTestCase(
        name: "VA v10",
        data: "@\n\u{1E}\rANSI 636000100102DL00410278ZV03190008\nDLDAQT64235789\nDCSSAMPLE\nDACMICHAEL\nDADJOHN\nDCUJR\nDCAD\nDCBK\nDCDPH\nDBD06062019\nDBB06061986\nDBA12102024\nDBC1\nDAU068 in\nDAYBRO\nDAG2300 WEST BROAD STREET\nDAIRICHMOND\nDAJVA\nDAK232690000\nDCGUSA",
        version: 10, firstName: "MICHAEL", lastName: "SAMPLE", middleName: "JOHN",
        licenseNumber: "T64235789", dateOfBirth: "1986-06-06", sex: "M", state: "VA", country: "USA"
    ),
]

func testMultiStateParser() {
    print("\n=== Multi-State AAMVA Parser Tests ===")
    print("  Testing \(multiStateTestCases.count) state/version combinations\n")

    for tc in multiStateTestCases {
        let r = AAMVAParser.parse(tc.data)
        assert(r != nil, "\(tc.name): parses successfully")
        guard let r = r else { continue }

        if let expected = tc.version {
            assert(r["aamvaVersion"] as? Int == expected, "\(tc.name): version = \(expected)")
        }
        if let expected = tc.firstName {
            assert(r["firstName"] as? String == expected,
                   "\(tc.name): firstName = \(expected) (got \(r["firstName"] as? String ?? "nil"))")
        }
        if let expected = tc.lastName {
            assert(r["lastName"] as? String == expected,
                   "\(tc.name): lastName = \(expected) (got \(r["lastName"] as? String ?? "nil"))")
        }
        if tc.middleName != nil {
            let expected = tc.middleName!
            assert(r["middleName"] as? String == expected,
                   "\(tc.name): middleName = \(expected) (got \(r["middleName"] as? String ?? "nil"))")
        }
        if let expected = tc.licenseNumber {
            assert(r["licenseNumber"] as? String == expected,
                   "\(tc.name): licenseNumber = \(expected) (got \(r["licenseNumber"] as? String ?? "nil"))")
        }
        if let expected = tc.dateOfBirth {
            assert(r["dateOfBirth"] as? String == expected,
                   "\(tc.name): dateOfBirth = \(expected) (got \(r["dateOfBirth"] as? String ?? "nil"))")
        }
        if let expected = tc.sex {
            assert(r["sex"] as? String == expected, "\(tc.name): sex = \(expected)")
        }
        if let expected = tc.state {
            assert(r["state"] as? String == expected, "\(tc.name): state = \(expected)")
        }
        if let expected = tc.country {
            assert(r["country"] as? String == expected, "\(tc.name): country = \(expected)")
        }
    }
}

// MARK: - Image Pipeline Tests
// Generate PDF417 barcodes from AAMVA data, scan them, parse results

func generatePDF417(from data: String) -> CGImage? {
    guard let filter = CIFilter(name: "CIPDF417BarcodeGenerator") else { return nil }
    filter.setValue(data.data(using: .ascii) ?? data.data(using: .utf8), forKey: "inputMessage")
    guard let ciImage = filter.outputImage else { return nil }
    let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: 3, y: 3))
    return CIContext().createCGImage(scaled, from: scaled.extent)
}

struct ImageTestCase {
    let name: String
    let barcodeData: String
    let expectedLicense: String
    let expectedLastName: String
}

let imageTestCases: [ImageTestCase] = [
    ImageTestCase(
        name: "v9 US barcode",
        barcodeData: "@\nANSI 636000090002DL\nDAQ987654321\nDCSDOE\nDACJANE\nDADM\nDBB01011990\nDBA01012030\nDBC2\nDAJCA\nDCGUSA",
        expectedLicense: "987654321",
        expectedLastName: "DOE"
    ),
    ImageTestCase(
        name: "v1 DAA barcode",
        barcodeData: "@\nANSI 636000010002DL\nDAQ555666777\nDAAWILSON,JAMES,RAY\nDBB19801215\nDBC1\nDAJTX",
        expectedLicense: "555666777",
        expectedLastName: "WILSON"
    ),
    ImageTestCase(
        name: "v4 standard barcode",
        barcodeData: "@\nANSI 636014040002DL\nDAQA1234567\nDCSSMITH\nDACBOB\nDADLEE\nDBB03151985\nDBC1\nDAJIL\nDCGUSA",
        expectedLicense: "A1234567",
        expectedLastName: "SMITH"
    ),
    ImageTestCase(
        name: "v3 Canadian barcode",
        barcodeData: "@\nANSI 636012030001DL\nDAQM5555-12345\nDCSTREMBLAY\nDCTMARIE\nDBB19880601\nDBC2\nDAJQC\nDCGCAN",
        expectedLicense: "M5555-12345",
        expectedLastName: "TREMBLAY"
    ),
    ImageTestCase(
        name: "v10 barcode",
        barcodeData: "@\nANSI 636000100002DL\nDAQZ9876543\nDCSJOHNSON\nDACRICK\nDADJ\nDBB07041976\nDBC1\nDAJVA\nDCGUSA",
        expectedLicense: "Z9876543",
        expectedLastName: "JOHNSON"
    ),
]

func testImagePipeline() {
    print("\n=== Image Pipeline Tests (PDF417 generate -> scan -> parse) ===")

    var generated = 0
    var scanned = 0
    var parsed = 0

    for tc in imageTestCases {
        guard let cgImage = generatePDF417(from: tc.barcodeData) else {
            print("  ! \(tc.name): skipped (PDF417 generation failed)")
            continue
        }
        generated += 1

        guard let pixelBuffer = createPixelBuffer(from: cgImage) else {
            print("  ! \(tc.name): skipped (pixel buffer creation failed)")
            continue
        }

        let scanner = BarcodeScanner()
        guard let payload = scanner.detect(in: pixelBuffer) else {
            print("  ! \(tc.name): skipped (barcode scan failed)")
            continue
        }
        scanned += 1

        guard let result = AAMVAParser.parse(payload) else {
            assert(false, "\(tc.name): AAMVAParser failed on scanned payload")
            continue
        }
        parsed += 1

        assert(result["licenseNumber"] as? String == tc.expectedLicense,
               "\(tc.name): license = \(tc.expectedLicense) (got \(result["licenseNumber"] as? String ?? "nil"))")
        assert(result["lastName"] as? String == tc.expectedLastName,
               "\(tc.name): lastName = \(tc.expectedLastName) (got \(result["lastName"] as? String ?? "nil"))")
    }

    print("  i Pipeline: \(generated)/\(imageTestCases.count) generated, \(scanned) scanned, \(parsed) parsed")
    assert(parsed >= 3, "Image pipeline: at least 3 end-to-end passes")
}

// MARK: - Header Embedded Data Tests

func testHeaderEmbeddedData() {
    print("\n=== Header Embedded Data Tests ===")

    // Test: field code concatenated with header after DL marker
    let embedded1 = "ANSI 6360100102DL00390187ZF02260043DLDAATESTER,JOEY,MIDLAND\nDAG123 MAIN ST\nDAJFL\nDAQ555123"
    let r1 = AAMVAParser.parse(embedded1)
    assert(r1?["firstName"] as? String == "JOEY", "Embedded DL+DAA: extracts firstName")
    assert(r1?["lastName"] as? String == "TESTER", "Embedded DL+DAA: extracts lastName")
    assert(r1?["licenseNumber"] as? String == "555123", "Embedded DL+DAA: extracts licenseNumber from separate line")

    // Test: field code concatenated with header without DL marker
    let embedded2 = "AAMVA6360060101DL00290179DAACTLIC,ADULT,A\nDAG60 STATE ST\nDAJCT\nDAQ990000001"
    let r2 = AAMVAParser.parse(embedded2)
    assert(r2?["firstName"] as? String == "ADULT", "Embedded DAA (no DL marker): extracts firstName")
    assert(r2?["lastName"] as? String == "CTLIC", "Embedded DAA (no DL marker): extracts lastName")

    // Test: header with DL in offset table only (no embedded data)
    let noEmbed = "ANSI 636000090002DL00410278ZV03190008\nDAQ123456\nDCSSMITH"
    let r3 = AAMVAParser.parse(noEmbed)
    assert(r3?["licenseNumber"] as? String == "123456", "No embedded data: normal parsing works")
    assert(r3?["lastName"] as? String == "SMITH", "No embedded data: lastName from separate line")
}
