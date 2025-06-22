#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>
#import "DlScan-Swift.h"

@interface DlScanFrameProcessorPlugin : FrameProcessorPlugin
@property (nonatomic, strong) PDF417Detector *detector;
@property (nonatomic, strong) OCRTextDetector *ocrDetector;
@property (nonatomic, strong) DocumentDetector *documentDetector;
@property (nonatomic, strong) LicenseParser *parser;
@property (nonatomic, strong) NSDate *lastDetectionTime;
@property (nonatomic, strong) NSDate *lastOCRTime;
@property (nonatomic, strong) NSDate *lastDocumentDetectionTime;
@end

@implementation DlScanFrameProcessorPlugin

- (instancetype)initWithProxy:(VisionCameraProxyHolder*)proxy 
                  withOptions:(NSDictionary* _Nullable)options {
    self = [super initWithProxy:proxy withOptions:options];
    if (self) {
        _detector = [[PDF417Detector alloc] init];
        _ocrDetector = [[OCRTextDetector alloc] init];
        _documentDetector = [[DocumentDetector alloc] init];
        _parser = [[LicenseParser alloc] init];
        _lastDetectionTime = nil;
        _lastOCRTime = nil;
        _lastDocumentDetectionTime = nil;
    }
    return self;
}

- (id)callback:(Frame*)frame withArguments:(NSDictionary*)arguments {
    NSDate *now = [NSDate date];
    
    // Get scanning mode from arguments (default to 'barcode')
    NSString *mode = arguments[@"mode"] ?: @"barcode";
    
    // Get the pixel buffer from the frame
    CVPixelBufferRef pixelBuffer = [frame pixelBuffer];
    if (!pixelBuffer) {
        return @{
            @"success": @NO,
            @"error": @{
                @"code": @"NO_PIXEL_BUFFER",
                @"message": @"Frame has no pixel buffer"
            }
        };
    }
    
    if ([mode isEqualToString:@"document"]) {
        // Document detection mode - process at moderate frequency (max 5 frames per second)
        if (_lastDocumentDetectionTime && [now timeIntervalSinceDate:_lastDocumentDetectionTime] < 0.2) {
            return nil; // Skip this frame
        }
        
        // Detect document boundaries
        NSDictionary *documentResult = [_documentDetector detectDocumentIn:pixelBuffer];
        
        // Check for document detection errors
        NSError *documentError = [_documentDetector getLastError];
        if (documentError) {
            // Use ErrorTranslator to get proper document detection error details
            NSDictionary *errorDetails = [ErrorTranslator translate:documentError];
            return @{
                @"success": @NO,
                @"error": errorDetails
            };
        }
        
        // If no document found, return with specific error
        if (!documentResult) {
            NSDictionary *noDocumentError = [ErrorTranslator createDocumentDetectionError:@"detection_failed"];
            return @{
                @"success": @NO,
                @"error": noDocumentError
            };
        }
        
        // Update last document detection time
        _lastDocumentDetectionTime = now;
        
        // Return document detection result
        return @{
            @"success": @YES,
            @"mode": @"document",
            @"documentData": documentResult,
            @"frameInfo": @{
                @"width": @(frame.width),
                @"height": @(frame.height),
                @"timestamp": @([now timeIntervalSince1970] * 1000), // milliseconds
                @"processingTime": @([_documentDetector getLastProcessingTime] * 1000) // milliseconds
            }
        };
    } else if ([mode isEqualToString:@"ocr"]) {
        // OCR mode - process at lower frequency (max 2 frames per second)
        if (_lastOCRTime && [now timeIntervalSinceDate:_lastOCRTime] < 0.5) {
            return nil; // Skip this frame
        }
        
        // Detect text using enhanced OCR with quality assessment
        NSDictionary *ocrResult = [_ocrDetector detectTextIn:pixelBuffer];
        
        // Check for OCR errors first
        NSError *ocrError = [_ocrDetector getLastError];
        if (ocrError) {
            // Use ErrorTranslator to get proper OCR error details
            NSDictionary *errorDetails = [ErrorTranslator translate:ocrError];
            return @{
                @"success": @NO,
                @"error": errorDetails
            };
        }
        
        // If no result returned, return with specific error
        if (!ocrResult) {
            NSDictionary *noTextError = [ErrorTranslator createOCRError:@"no_text"];
            return @{
                @"success": @NO,
                @"error": noTextError
            };
        }
        
        // Check if OCR result contains error (quality assessment failure)
        NSNumber *success = ocrResult[@"success"];
        if (success && ![success boolValue]) {
            // OCR failed due to quality issues - return the detailed error
            return @{
                @"success": @NO,
                @"error": ocrResult[@"error"],
                @"qualityAssessment": ocrResult[@"qualityAssessment"] ?: @{}
            };
        }
        
        // Update last OCR time
        _lastOCRTime = now;
        
        // Return enhanced OCR result with quality metrics
        NSMutableDictionary *result = [@{
            @"success": @YES,
            @"mode": @"ocr",
            @"ocrData": ocrResult,
            @"frameInfo": @{
                @"width": @(frame.width),
                @"height": @(frame.height),
                @"timestamp": @([now timeIntervalSince1970] * 1000), // milliseconds
                @"processingTime": @([_ocrDetector getLastProcessingTime] * 1000) // milliseconds
            }
        } mutableCopy];
        
        // Include quality assessment data if available
        if (ocrResult[@"qualityAssessment"]) {
            result[@"qualityAssessment"] = ocrResult[@"qualityAssessment"];
        }
        
        return result;
    } else {
        // Barcode mode - existing implementation
        // Implement frame rate limiting (process max 10 frames per second)
        if (_lastDetectionTime && [now timeIntervalSinceDate:_lastDetectionTime] < 0.1) {
            return nil; // Skip this frame
        }
        
        // Detect PDF417 barcode
        NSString *barcodeData = [_detector detectPDF417In:pixelBuffer];
        
        // Check for detection errors
        NSError *detectionError = [_detector getLastError];
        if (detectionError) {
            return @{
                @"success": @NO,
                @"error": @{
                    @"code": @"DETECTION_ERROR",
                    @"message": detectionError.localizedDescription
                }
            };
        }
        
        // If no barcode found, return nil (don't report as error)
        if (!barcodeData) {
            return nil;
        }
        
        // Update last detection time
        _lastDetectionTime = now;
        
        // Parse the barcode data using existing LicenseParser
        NSDictionary *parseResult = [_parser parseLicenseData:barcodeData];
        
        // Check if parsing was successful
        BOOL success = [parseResult[@"success"] boolValue];
        if (!success) {
            return @{
                @"success": @NO,
                @"error": parseResult[@"error"]
            };
        }
        
        // Return successful result
        return @{
            @"success": @YES,
            @"mode": @"barcode",
            @"data": parseResult[@"data"],
            @"frameInfo": @{
                @"width": @(frame.width),
                @"height": @(frame.height),
                @"timestamp": @([now timeIntervalSince1970] * 1000) // milliseconds
            }
        };
    }
}

VISION_EXPORT_FRAME_PROCESSOR(DlScanFrameProcessorPlugin, scanLicense)

@end