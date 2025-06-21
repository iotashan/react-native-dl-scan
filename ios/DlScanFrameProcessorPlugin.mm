#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>
#import "DlScan-Swift.h"

@interface DlScanFrameProcessorPlugin : FrameProcessorPlugin
@property (nonatomic, strong) PDF417Detector *detector;
@property (nonatomic, strong) LicenseParser *parser;
@property (nonatomic, strong) NSDate *lastDetectionTime;
@end

@implementation DlScanFrameProcessorPlugin

- (instancetype)initWithProxy:(VisionCameraProxyHolder*)proxy 
                  withOptions:(NSDictionary* _Nullable)options {
    self = [super initWithProxy:proxy withOptions:options];
    if (self) {
        _detector = [[PDF417Detector alloc] init];
        _parser = [[LicenseParser alloc] init];
        _lastDetectionTime = nil;
    }
    return self;
}

- (id)callback:(Frame*)frame withArguments:(NSDictionary*)arguments {
    // Implement frame rate limiting (process max 10 frames per second)
    NSDate *now = [NSDate date];
    if (_lastDetectionTime && [now timeIntervalSinceDate:_lastDetectionTime] < 0.1) {
        return nil; // Skip this frame
    }
    
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
        @"data": parseResult[@"data"],
        @"frameInfo": @{
            @"width": @(frame.width),
            @"height": @(frame.height),
            @"timestamp": @([now timeIntervalSince1970] * 1000) // milliseconds
        }
    };
}

VISION_EXPORT_FRAME_PROCESSOR(DlScanFrameProcessorPlugin, scanLicense)

@end