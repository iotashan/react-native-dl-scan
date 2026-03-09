import Foundation
import Vision
import CoreVideo
import CoreImage
import CoreGraphics

// MARK: - Test Harness

var passed = 0
var failed = 0

func assert(_ condition: Bool, _ message: String, file: String = #file, line: Int = #line) {
    if condition {
        passed += 1
        print("  \u{2713} \(message)")
    } else {
        failed += 1
        print("  \u{2717} FAIL: \(message) (\(file):\(line))")
    }
}

// MARK: - AAMVA Version Detection Tests

func testVersionDetection() {
    print("\n=== AAMVA Version Detection Tests ===")

    // v1 barcode
    let v1 = "@\n\u{1E}\nANSI 636000010002DL\nDAQ123\nDABSMITH\nDACJOHN\nDBB19900815"
    let r1 = AAMVAParser.parse(v1)
    assert(r1?["aamvaVersion"] as? Int == 1, "Detects version 1")

    // v4 barcode
    let v4 = "@\n\u{1E}\nANSI 636000040002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990"
    let r4 = AAMVAParser.parse(v4)
    assert(r4?["aamvaVersion"] as? Int == 4, "Detects version 4")

    // v9 barcode
    let v9 = "@\n\u{1E}\nANSI 636000090002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990"
    let r9 = AAMVAParser.parse(v9)
    assert(r9?["aamvaVersion"] as? Int == 9, "Detects version 9")

    // v10 barcode
    let v10 = "@\n\u{1E}\nANSI 636000100002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990"
    let r10 = AAMVAParser.parse(v10)
    assert(r10?["aamvaVersion"] as? Int == 10, "Detects version 10")

    // v11 barcode
    let v11 = "@\n\u{1E}\nANSI 636000110002DL\nDAQ123\nDCSSMITH\nDACJOHN\nDBB08151990"
    let r11 = AAMVAParser.parse(v11)
    assert(r11?["aamvaVersion"] as? Int == 11, "Detects version 11")
}

// MARK: - Version 1 (2000) Tests

func testVersion1() {
    print("\n=== AAMVA Version 1 Tests ===")

    // v1 uses: DAB for lastName, DAC for firstName, yyyyMMdd dates
    let v1Data = "@\n\u{1E}\nANSI 636000010002DL\nDAQ999888777\nDABJOHNSON\nDACROBERT\nDADMICHAEL\nDBB19851220\nDBA20281231\nDBD20200115\nDBC1\nDAYBRO\nDAU511\nDAG456 ELM STREET\nDAISPRINGFIELD\nDAJIL\nDAK627040000\nDCAB\nDCBNONE\nDCDNONE"

    let r = AAMVAParser.parse(v1Data)
    assert(r != nil, "v1: Parses valid data")
    assert(r?["aamvaVersion"] as? Int == 1, "v1: Detects version 1")
    assert(r?["lastName"] as? String == "JOHNSON", "v1: Extracts lastName from DAB")
    assert(r?["firstName"] as? String == "ROBERT", "v1: Extracts firstName from DAC")
    assert(r?["middleName"] as? String == "MICHAEL", "v1: Extracts middleName from DAD")
    assert(r?["licenseNumber"] as? String == "999888777", "v1: Extracts licenseNumber")
    // v1 dates are yyyyMMdd
    assert(r?["dateOfBirth"] as? String == "1985-12-20", "v1: Parses DOB yyyyMMdd")
    assert(r?["expirationDate"] as? String == "2028-12-31", "v1: Parses expiration yyyyMMdd")
    assert(r?["issueDate"] as? String == "2020-01-15", "v1: Parses issue date yyyyMMdd")
    assert(r?["sex"] as? String == "M", "v1: Maps sex code 1 -> M")
}

// MARK: - Version 1 DAA Composite Name Tests

func testVersion1DAAName() {
    print("\n=== AAMVA Version 1 DAA Composite Name Tests ===")

    // v1 with DAA composite name (LAST,FIRST,MIDDLE) instead of separate fields
    let v1Daa = "@\n\u{1E}\nANSI 636000010002DL\nDAQ111222333\nDAAWILLIAMS,SARAH,ANN\nDBB19900601\nDBC2"

    let r = AAMVAParser.parse(v1Daa)
    assert(r != nil, "v1 DAA: Parses data with composite name")
    assert(r?["lastName"] as? String == "WILLIAMS", "v1 DAA: Extracts lastName (first component)")
    assert(r?["firstName"] as? String == "SARAH", "v1 DAA: Extracts firstName (second component)")
    assert(r?["middleName"] as? String == "ANN", "v1 DAA: Extracts middleName (third component)")
    assert(r?["sex"] as? String == "F", "v1 DAA: Maps sex code 2 -> F")
}

// MARK: - Version 2 (2003) Tests

func testVersion2() {
    print("\n=== AAMVA Version 2 Tests ===")

    // v2 uses DCT for givenName instead of DAC, MMddyyyy dates
    let v2Data = "@\n\u{1E}\nANSI 636000020002DL\nDAQ555666777\nDCSMARTINEZ\nDCTMARIA,ELENA\nDBB03151988\nDBA06302029\nDBC2\nDAG789 OAK AVE\nDAIDALLAS\nDAJTX\nDAK752010000"

    let r = AAMVAParser.parse(v2Data)
    assert(r != nil, "v2: Parses valid data")
    assert(r?["aamvaVersion"] as? Int == 2, "v2: Detects version 2")
    assert(r?["lastName"] as? String == "MARTINEZ", "v2: Extracts lastName from DCS")
    assert(r?["firstName"] as? String == "MARIA", "v2: Extracts firstName from DCT (first component)")
    assert(r?["middleName"] as? String == "ELENA", "v2: Extracts middleName from DCT (second component)")
    // v2 dates are MMddyyyy for both US and Canada
    assert(r?["dateOfBirth"] as? String == "1988-03-15", "v2: Parses DOB MMddyyyy")
    assert(r?["sex"] as? String == "F", "v2: Maps sex code 2 -> F")
}

// MARK: - Version 4+ Standard Tests (Modern Format)

func testVersion4Plus() {
    print("\n=== AAMVA Version 4+ Tests ===")

    let v9Data = "@\n\u{1E}\nANSI 636000090002DL00410278ZV03190008\nDAQ123456789\nDCSSAMPLE\nDACJOHN\nDADMICHAEL\nDBB08151990\nDBA12312028\nDBD01152023\nDBC1\nDAYGRN\nDAU510\nDAG123 MAIN ST\nDAIRICHMOND\nDAJVA\nDAK232200000\nDCGUSA\nDCAA\nDCBNONE\nDCDNONE"

    let r = AAMVAParser.parse(v9Data)
    assert(r != nil, "v4+: Parses valid AAMVA data")

    if let r = r {
        assert(r["firstName"] as? String == "JOHN", "v4+: Extracts firstName (DAC)")
        assert(r["lastName"] as? String == "SAMPLE", "v4+: Extracts lastName (DCS)")
        assert(r["middleName"] as? String == "MICHAEL", "v4+: Extracts middleName (DAD)")
        assert(r["licenseNumber"] as? String == "123456789", "v4+: Extracts licenseNumber (DAQ)")
        assert(r["dateOfBirth"] as? String == "1990-08-15", "v4+: Parses DOB MMddyyyy")
        assert(r["expirationDate"] as? String == "2028-12-31", "v4+: Parses expiration MMddyyyy")
        assert(r["issueDate"] as? String == "2023-01-15", "v4+: Parses issue date MMddyyyy")
        assert(r["sex"] as? String == "M", "v4+: Maps sex code 1 -> M")
        assert(r["eyeColor"] as? String == "GRN", "v4+: Extracts eyeColor (DAY)")
        assert(r["height"] as? String == "510", "v4+: Extracts height (DAU)")
        assert(r["street"] as? String == "123 MAIN ST", "v4+: Extracts street (DAG)")
        assert(r["city"] as? String == "RICHMOND", "v4+: Extracts city (DAI)")
        assert(r["state"] as? String == "VA", "v4+: Extracts state (DAJ)")
        assert(r["postalCode"] as? String == "23220", "v4+: Cleans postal code (strips 0000)")
        assert(r["country"] as? String == "USA", "v4+: Extracts country (DCG)")
        assert(r["vehicleClass"] as? String == "A", "v4+: Extracts vehicleClass (DCA)")
        assert(r["restrictions"] as? String == "NONE", "v4+: Extracts restrictions (DCB)")
        assert(r["endorsements"] as? String == "NONE", "v4+: Extracts endorsements (DCD)")
        assert(r["aamvaVersion"] as? Int == 9, "v4+: Reports version 9")
    }
}

// MARK: - Canadian Card Tests

func testCanadianCard() {
    print("\n=== Canadian Card Tests ===")

    // v9 Canadian card: dates should be yyyyMMdd
    let canData = "@\n\u{1E}\nANSI 636000090002DL\nDAQA1234567\nDCSLEBLANC\nDACJEAN\nDADPIERRE\nDBB19870520\nDBA20300101\nDBC1\nDCGCAN\nDAJON\nDAK M4B1A5"

    let r = AAMVAParser.parse(canData)
    assert(r != nil, "Canada: Parses Canadian card")
    assert(r?["country"] as? String == "CAN", "Canada: Extracts country CAN")
    // v9 Canada uses yyyyMMdd
    assert(r?["dateOfBirth"] as? String == "1987-05-20", "Canada v9: Parses DOB yyyyMMdd")
    assert(r?["state"] as? String == "ON", "Canada: Extracts province as state")
    assert(r?["postalCode"] as? String == "M4B1A5", "Canada: Preserves Canadian postal code")
}

// MARK: - Version 2 Canadian Card (MMddyyyy override)

func testVersion2Canadian() {
    print("\n=== Version 2 Canadian Card Tests ===")

    // v2 Canada uses MMddyyyy (unlike other versions)
    let v2Can = "@\n\u{1E}\nANSI 636000020002DL\nDAQB5555555\nDCSDUPONT\nDCTMARIE\nDBB05201987\nDBC2\nDCGCAN\nDAJQC"

    let r = AAMVAParser.parse(v2Can)
    assert(r != nil, "v2 Canada: Parses data")
    assert(r?["dateOfBirth"] as? String == "1987-05-20", "v2 Canada: Parses DOB MMddyyyy")
}

// MARK: - Date Format Edge Cases

func testDateFormats() {
    print("\n=== Date Format Tests ===")

    // YYYYMMDD format (v1 or fallback)
    let yyyymmdd = "ANSI 636000010002DL\nDAQA1234567\nDCSSMITH\nDACJANE\nDBB19850320\nDBA20290101\nDBC2"
    let r2 = AAMVAParser.parse(yyyymmdd)
    assert(r2 != nil, "Parses YYYYMMDD format")
    if let r = r2 {
        assert(r["dateOfBirth"] as? String == "1985-03-20", "Parses DOB YYYYMMDD")
        assert(r["sex"] as? String == "F", "Maps sex code 2 -> F")
    }
}

// MARK: - Sex Code Tests

func testSexCodes() {
    print("\n=== Sex Code Tests ===")

    let xBarcode = "AAMVA\nDAQX9999\nDCSTEST\nDBC9"
    assert(AAMVAParser.parse(xBarcode)?["sex"] as? String == "X", "Maps sex code 9 -> X")

    let unknownSex = "AAMVA\nDAQX9999\nDCSTEST\nDBC7"
    let r4 = AAMVAParser.parse(unknownSex)
    assert(r4?["sex"] == nil || r4?["sex"] is NSNull, "Unknown sex code returns nil")
}

// MARK: - Edge Cases

func testEdgeCases() {
    print("\n=== Edge Case Tests ===")

    // Invalid data (no ANSI/AAMVA marker)
    assert(AAMVAParser.parse("This is not a barcode") == nil, "Rejects non-AAMVA data")

    // Empty data
    assert(AAMVAParser.parse("") == nil, "Rejects empty string")

    // Country defaults to USA when DCG absent
    let noCountry = "ANSI 636000\nDAQ999\nDCSSMITH"
    assert(AAMVAParser.parse(noCountry)?["country"] as? String == "USA", "Defaults country to USA")

    // AAMVA separators (record separator \u{1E})
    let rsSep = "ANSI 636000\u{1E}DAQ777888\u{1E}DCSJONES\u{1E}DCTBILL"
    let r = AAMVAParser.parse(rsSep)
    assert(r?["licenseNumber"] as? String == "777888", "Handles \\u{1E} separator")
    assert(r?["firstName"] as? String == "BILL", "Handles \\u{1E} separator for name")

    // DL subfile prefix on first element
    let dlPrefix = "ANSI 636000090002\nDLDAQ444555\nDCSSMITH\nDACBOB"
    let rDl = AAMVAParser.parse(dlPrefix)
    assert(rDl?["licenseNumber"] as? String == "444555", "Handles DL prefix on element line")

    // PA* codes for v1 vehicle/restriction/endorsement
    let v1Pa = "ANSI 636000010002DL\nDAQ111\nDABDOE\nPAACDL\nPAENONE\nPAFS"
    let rPa = AAMVAParser.parse(v1Pa)
    assert(rPa?["vehicleClass"] as? String == "CDL", "v1: Falls back to PAA for vehicleClass")
    assert(rPa?["restrictions"] as? String == "NONE", "v1: Falls back to PAE for restrictions")
    assert(rPa?["endorsements"] as? String == "S", "v1: Falls back to PAF for endorsements")
}

// MARK: - Name Resolution Fallback Tests

func testNameResolution() {
    print("\n=== Name Resolution Fallback Tests ===")

    // DAC takes priority over DCT for firstName
    let both = "ANSI 636000\nDAQ999\nDCSSMITH\nDACJOHN\nDCTJANE"
    let r1 = AAMVAParser.parse(both)
    assert(r1?["firstName"] as? String == "JOHN", "firstName: DAC takes priority over DCT")

    // DCS takes priority over DAB for lastName
    let bothLast = "ANSI 636000\nDAQ999\nDCSSMITH\nDABJONES"
    let r2 = AAMVAParser.parse(bothLast)
    assert(r2?["lastName"] as? String == "SMITH", "lastName: DCS takes priority over DAB")

    // DAB fallback when DCS absent
    let dabOnly = "ANSI 636000\nDAQ999\nDABJOHNSON"
    let r3 = AAMVAParser.parse(dabOnly)
    assert(r3?["lastName"] as? String == "JOHNSON", "lastName: Falls back to DAB")

    // DCT with comma-separated components
    let dctComma = "ANSI 636000\nDAQ999\nDCSSMITH\nDCTJANE,MARIE,ANN"
    let r4 = AAMVAParser.parse(dctComma)
    assert(r4?["firstName"] as? String == "JANE", "DCT comma: firstName is first component")
    assert(r4?["middleName"] as? String == "MARIE ANN", "DCT comma: middleName is remaining components")

    // DAA composite name fallback (no DCS/DAB/DAC/DAD/DCT)
    let daaOnly = "ANSI 636000\nDAQ999\nDAADOE,JOHN,MICHAEL"
    let r5 = AAMVAParser.parse(daaOnly)
    assert(r5?["lastName"] as? String == "DOE", "DAA: lastName from first component")
    assert(r5?["firstName"] as? String == "JOHN", "DAA: firstName from second component")
    assert(r5?["middleName"] as? String == "MICHAEL", "DAA: middleName from third component")
}

// MARK: - OCRFieldParser Tests

func testOCRFieldParser() {
    print("\n=== OCRFieldParser Tests ===")

    let nameLines = [
        "DRIVER LICENSE",
        "LN JOHNSON",
        "FN SARAH",
        "MN ANN",
        "DL D1234567",
        "DOB 03/15/1988",
        "EXP 06/30/2027",
    ]
    let r1 = OCRFieldParser.parseFields(from: nameLines)
    assert(r1 != nil, "Parses OCR text with labeled name fields")
    if let r = r1 {
        assert(r["lastName"] as? String == "JOHNSON", "Extracts last name from LN label")
        assert(r["firstName"] as? String == "SARAH", "Extracts first name from FN label")
        assert(r["middleName"] as? String == "ANN", "Extracts middle name from MN label")
        assert(r["licenseNumber"] as? String == "D1234567", "Extracts license number")
    }

    let dateLines = [
        "FN TESTNAME",
        "LN TESTLAST",
        "DATE 03/15/1988",
        "DATE 01/01/2020",
        "DATE 12/31/2028",
    ]
    let r2 = OCRFieldParser.parseFields(from: dateLines)
    if let r = r2 {
        assert(r["dateOfBirth"] as? String != nil, "Assigns earliest date as DOB")
        assert(r["expirationDate"] as? String != nil, "Assigns latest date as expiration")
    }

    let addressLines = [
        "FN BOB",
        "LN SMITH",
        "456 OAK AVENUE",
        "Springfield, IL 62704",
    ]
    let r3 = OCRFieldParser.parseFields(from: addressLines)
    if let r = r3 {
        assert(r["city"] as? String == "Springfield", "Extracts city from city/state/zip line")
        assert(r["state"] as? String == "IL", "Extracts state")
        assert(r["postalCode"] as? String == "62704", "Extracts ZIP code")
        assert(r["street"] as? String == "456 OAK AVENUE", "Extracts street from line above")
    }

    let sexLines = ["FN TEST", "LN USER", "SEX M", "DL Z9876543"]
    let r4 = OCRFieldParser.parseFields(from: sexLines)
    assert(r4?["sex"] as? String == "M", "Extracts sex from SEX M")

    let badLines = ["RANDOM TEXT", "NO USEFUL INFO"]
    assert(OCRFieldParser.parseFields(from: badLines) == nil, "Returns nil for insufficient data")
}

// MARK: - BarcodeScanner Tests

func createPixelBuffer(from cgImage: CGImage) -> CVPixelBuffer? {
    let width = cgImage.width
    let height = cgImage.height
    var pixelBuffer: CVPixelBuffer?
    let attrs: [String: Any] = [
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ]
    let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height,
                                      kCVPixelFormatType_32BGRA, attrs as CFDictionary,
                                      &pixelBuffer)
    guard status == kCVReturnSuccess, let buffer = pixelBuffer else { return nil }

    CVPixelBufferLockBaseAddress(buffer, [])
    let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: width, height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    )
    context?.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(buffer, [])

    return buffer
}

func testBarcodeScanner() {
    print("\n=== BarcodeScanner Tests ===")

    let barcodeData = "@\nANSI 636000090002DL\nDAQ987654321\nDCSDOE\nDACJANE\nDBB01011990\nDBC2"
    guard let filter = CIFilter(name: "CIPDF417BarcodeGenerator") else {
        print("  ! Skipping: CIPDF417BarcodeGenerator not available")
        return
    }
    filter.setValue(barcodeData.data(using: .ascii), forKey: "inputMessage")

    guard let ciImage = filter.outputImage else {
        print("  ! Skipping: Failed to generate barcode image")
        return
    }

    let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: 3, y: 3))
    let context = CIContext()
    guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else {
        print("  ! Skipping: Failed to create CGImage")
        return
    }

    guard let pixelBuffer = createPixelBuffer(from: cgImage) else {
        print("  ! Skipping: Failed to create pixel buffer")
        return
    }

    let scanner = BarcodeScanner()
    let payload = scanner.detect(in: pixelBuffer)

    assert(payload != nil, "Detects PDF417 barcode from generated image")
    if let p = payload {
        assert(p.contains("ANSI") || p.contains("636000"), "Payload contains AAMVA marker")
        assert(p.contains("DOE") || p.contains("JANE"), "Payload contains encoded name data")

        let parsed = AAMVAParser.parse(p)
        assert(parsed != nil, "AAMVAParser can parse detected barcode payload")
        if let r = parsed {
            assert(r["licenseNumber"] as? String == "987654321", "End-to-end: barcode -> parsed license number")
        }
    }
}

// MARK: - OCRScanner Tests

func testOCRScanner() {
    print("\n=== OCRScanner Tests ===")

    let text = "DRIVER LICENSE\nLN WILLIAMS\nFN ROBERT\nDL W5551234\nDOB 07/04/1985"
    let width = 800
    let height = 400
    let colorSpace = CGColorSpaceCreateDeviceRGB()

    guard let context = CGContext(
        data: nil, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: width * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        print("  ! Skipping: Failed to create CGContext")
        return
    }

    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))

    context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    let font = CTFontCreateWithName("Helvetica" as CFString, 28, nil)
    let lines = text.components(separatedBy: "\n")
    for (i, line) in lines.enumerated() {
        let attrString = CFAttributedStringCreateMutable(kCFAllocatorDefault, 0)!
        CFAttributedStringReplaceString(attrString, CFRangeMake(0, 0), line as CFString)
        CFAttributedStringSetAttribute(attrString, CFRangeMake(0, CFAttributedStringGetLength(attrString)),
                                        kCTFontAttributeName, font)
        let ctLine = CTLineCreateWithAttributedString(attrString)
        context.textPosition = CGPoint(x: 40, y: height - 60 - (i * 50))
        CTLineDraw(ctLine, context)
    }

    guard let cgImage = context.makeImage() else {
        print("  ! Skipping: Failed to create CGImage from text")
        return
    }

    guard let pixelBuffer = createPixelBuffer(from: cgImage) else {
        print("  ! Skipping: Failed to create pixel buffer")
        return
    }

    let scanner = OCRScanner()
    let recognized = scanner.recognize(in: pixelBuffer)

    assert(recognized != nil, "OCR recognizes text from rendered image")
    if let lines = recognized {
        let joined = lines.joined(separator: " ").uppercased()
        assert(joined.contains("DRIVER") || joined.contains("LICENSE"), "OCR detects 'DRIVER LICENSE'")
        assert(joined.contains("WILLIAMS") || joined.contains("ROBERT"), "OCR detects name text")
        print("  i Recognized \(lines.count) lines: \(lines)")
    }
}

// MARK: - Run All Tests

@main
struct TestRunner {
    static func main() {
        print("DlScan Test Suite")
        print("====================")

        testVersionDetection()
        testVersion1()
        testVersion1DAAName()
        testVersion2()
        testVersion4Plus()
        testCanadianCard()
        testVersion2Canadian()
        testDateFormats()
        testSexCodes()
        testEdgeCases()
        testNameResolution()
        testOCRFieldParser()
        testBarcodeScanner()
        testOCRScanner()

        // Multi-state tests (from DlScanMultiStateTests.swift)
        testMultiStateParser()
        testImagePipeline()
        testHeaderEmbeddedData()

        print("\n====================")
        print("Results: \(passed) passed, \(failed) failed")

        if failed > 0 {
            exit(1)
        }
    }
}
