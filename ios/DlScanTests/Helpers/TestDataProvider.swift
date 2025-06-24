import Foundation
import UIKit

/// Provides test data for unit tests
class TestDataProvider {
    
    // MARK: - PDF417 Test Data
    
    /// Returns valid PDF417 barcode data for testing
    static func validPDF417Data() -> String {
        // Example AAMVA compliant barcode data
        return "@\n\u001e\rANSI 636014040002DL00410278ZC03190008DLDAQD12345678\nDCSSAMPLE\nDDEN\nDACMICHAEL\nDDFN\nDADJAMES\nDDGN\nDCUJR\nDCAD\nDCBK\nDCDPH\nDBD06061986\nDBB06061986\nDBA12102024\nDBC1\nDAU068 in\nDAYBRO\nDAG2300 WEST BROAD STREET\nDAIRICHMOND\nDAJVA\nDAK232690000 \nDCF2424244747474786102204\nDCGUSA\nDCK123456789\nDDAF\nDDB06062008\nDDC06062009\nDDD1\rZCZCA\nZCB\nZCC\nZCD\nZCE\r"
    }
    
    /// Returns invalid PDF417 data for error testing
    static func invalidPDF417Data() -> String {
        return "INVALID_BARCODE_DATA_12345"
    }
    
    /// Returns partially corrupted PDF417 data
    static func corruptedPDF417Data() -> String {
        return "@\n\u001e\rANSI 636014040002DL00410278ZC03190008DLDAQD12345678\nDCS\nDDEN\nDAC\nDDFN\nDAD"
    }
    
    // MARK: - OCR Test Images
    
    /// Returns a sample driver's license front image for OCR testing
    static func sampleLicenseFrontImage() -> UIImage? {
        // Create a test image with text
        let size = CGSize(width: 800, height: 500)
        UIGraphicsBeginImageContextWithOptions(size, true, 0)
        
        // Draw background
        UIColor.white.setFill()
        UIRectFill(CGRect(origin: .zero, size: size))
        
        // Draw text elements
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 24),
            .foregroundColor: UIColor.black
        ]
        
        "DRIVER LICENSE".draw(at: CGPoint(x: 50, y: 50), withAttributes: attributes)
        "JOHN DOE".draw(at: CGPoint(x: 50, y: 100), withAttributes: attributes)
        "123 MAIN ST".draw(at: CGPoint(x: 50, y: 150), withAttributes: attributes)
        "DLN: D123456789".draw(at: CGPoint(x: 50, y: 200), withAttributes: attributes)
        "DOB: 01/01/1990".draw(at: CGPoint(x: 50, y: 250), withAttributes: attributes)
        "EXP: 01/01/2025".draw(at: CGPoint(x: 50, y: 300), withAttributes: attributes)
        
        let image = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        
        return image
    }
    
    /// Returns a blurry image for quality testing
    static func blurryLicenseImage() -> UIImage? {
        guard let clearImage = sampleLicenseFrontImage() else { return nil }
        
        // Apply blur filter
        let context = CIContext(options: nil)
        let inputImage = CIImage(image: clearImage)
        
        let filter = CIFilter(name: "CIGaussianBlur")
        filter?.setValue(inputImage, forKey: kCIInputImageKey)
        filter?.setValue(10.0, forKey: kCIInputRadiusKey)
        
        guard let outputImage = filter?.outputImage,
              let cgImage = context.createCGImage(outputImage, from: outputImage.extent) else {
            return nil
        }
        
        return UIImage(cgImage: cgImage)
    }
    
    // MARK: - Expected Results
    
    /// Returns expected parsed data for validation
    static func expectedParsedData() -> [String: String] {
        return [
            "firstName": "MICHAEL",
            "middleName": "JAMES",
            "lastName": "SAMPLE",
            "suffix": "JR",
            "documentNumber": "D12345678",
            "dateOfBirth": "06/06/1986",
            "dateOfExpiry": "12/10/2024",
            "address": "2300 WEST BROAD STREET",
            "city": "RICHMOND",
            "state": "VA",
            "postalCode": "23269"
        ]
    }
    
    // MARK: - OCR Test Text
    
    /// Returns sample OCR text output for testing
    static func sampleOCRText() -> String {
        return """
        DRIVER LICENSE
        VIRGINIA
        
        SAMPLE
        MICHAEL JAMES JR
        
        DLN D123456789
        DOB 06/06/1986
        
        2300 WEST BROAD STREET
        RICHMOND, VA 23269
        
        CLASS D
        END NONE
        RST NONE
        
        EXP 12/10/2024
        """
    }
    
    /// Returns OCR text with common errors
    static func ocrTextWithErrors() -> String {
        return """
        DR1VER L1CENSE
        VIRG1N1A
        
        5AMPLE
        M1CHAEL JAME5 JR
        
        DLN D12E456789
        D0B O6/06/l986
        
        23OO WE5T BR0AD 5TREET
        R1CHM0ND, VA 2E269
        """
    }
}

// MARK: - Mock Helpers

/// Mock camera frame for testing
class MockCameraFrame {
    let pixelBuffer: CVPixelBuffer
    
    init(width: Int = 1920, height: Int = 1080) {
        var pixelBuffer: CVPixelBuffer?
        let attrs = [kCVPixelBufferCGImageCompatibilityKey: kCFBooleanTrue,
                     kCVPixelBufferCGBitmapContextCompatibilityKey: kCFBooleanTrue] as CFDictionary
        
        CVPixelBufferCreate(kCFAllocatorDefault,
                           width,
                           height,
                           kCVPixelFormatType_32BGRA,
                           attrs,
                           &pixelBuffer)
        
        self.pixelBuffer = pixelBuffer!
    }
}