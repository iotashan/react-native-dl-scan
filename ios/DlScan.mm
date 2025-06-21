#import "DlScan.h"
#import "DlScan-Swift.h"

@implementation DlScan
RCT_EXPORT_MODULE()

- (void)scanLicense:(NSString *)barcodeData
           resolver:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject {
    @try {
        NSError *error = nil;
        NSDictionary *licenseData = [LicenseParser parse:barcodeData error:&error];
        
        if (error) {
            NSDictionary *errorDict = [ErrorTranslator translate:error];
            NSDictionary *result = @{
                @"success": @NO,
                @"error": errorDict
            };
            resolve(result);
        } else {
            NSDictionary *result = @{
                @"success": @YES,
                @"data": licenseData
            };
            resolve(result);
        }
    } @catch (NSException *exception) {
        NSDictionary *result = @{
            @"success": @NO,
            @"error": @{
                @"code": @"PARSING_FAILED",
                @"message": exception.reason ?: @"Unknown parsing error",
                @"userMessage": @"Unable to read the license barcode. Please try scanning again.",
                @"recoverable": @YES
            }
        };
        resolve(result);
    }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeDlScanSpecJSI>(params);
}

@end
