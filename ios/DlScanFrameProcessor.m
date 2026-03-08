#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>
#import "DlScan-Swift.h"

@interface DlScanFrameProcessorPlugin : FrameProcessorPlugin
@property (nonatomic, strong) BarcodeScanner *barcodeScanner;
@property (nonatomic, strong) OCRScanner *ocrScanner;
@property (nonatomic, strong) NSDate *lastBarcodeTime;
@property (nonatomic, strong) NSDate *lastOCRTime;
@end

@implementation DlScanFrameProcessorPlugin

- (instancetype)initWithProxy:(VisionCameraProxyHolder*)proxy
                  withOptions:(NSDictionary* _Nullable)options {
    self = [super initWithProxy:proxy withOptions:options];
    if (self) {
        _barcodeScanner = [[BarcodeScanner alloc] init];
        _ocrScanner = [[OCRScanner alloc] init];
    }
    return self;
}

- (id)callback:(Frame*)frame withArguments:(NSDictionary*)arguments {
    NSDate *now = [NSDate date];
    NSString *mode = arguments[@"mode"] ?: @"barcode";

    CVPixelBufferRef pixelBuffer = [frame pixelBuffer];
    if (!pixelBuffer) {
        return nil;
    }

    if ([mode isEqualToString:@"ocr"]) {
        // Rate limit OCR to 2 fps
        if (_lastOCRTime && [now timeIntervalSinceDate:_lastOCRTime] < 0.5) {
            return nil;
        }
        _lastOCRTime = now;

        NSArray<NSString *> *lines = [_ocrScanner recognizeIn:pixelBuffer];
        if (!lines) {
            return nil;
        }

        NSDictionary *data = [OCRFieldParser parseFieldsFrom:lines];
        if (!data) {
            return nil;
        }

        return @{
            @"success": @YES,
            @"mode": @"ocr",
            @"data": data
        };
    } else {
        // Rate limit barcode to 10 fps
        if (_lastBarcodeTime && [now timeIntervalSinceDate:_lastBarcodeTime] < 0.1) {
            return nil;
        }
        _lastBarcodeTime = now;

        NSString *barcodePayload = [_barcodeScanner detectIn:pixelBuffer];
        if (!barcodePayload) {
            return nil;
        }

        NSDictionary *data = [AAMVAParser parse:barcodePayload];
        if (!data) {
            return @{
                @"success": @NO,
                @"mode": @"barcode",
                @"error": @"Failed to parse AAMVA data from barcode"
            };
        }

        return @{
            @"success": @YES,
            @"mode": @"barcode",
            @"data": data
        };
    }
}

VISION_EXPORT_FRAME_PROCESSOR(DlScanFrameProcessorPlugin, scanLicense)

@end
