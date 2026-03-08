#import "DlScan.h"
#import "DlScan-Swift.h"

@implementation DlScan

RCT_EXPORT_MODULE()

RCT_EXPORT_METHOD(parseBarcodeData:(NSString *)barcodeData
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSDictionary *result = [AAMVAParser parse:barcodeData];
    if (result) {
        resolve(result);
    } else {
        reject(@"PARSE_ERROR", @"Failed to parse AAMVA barcode data", nil);
    }
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeDlScanSpecJSI>(params);
}
#endif

@end
