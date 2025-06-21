#import "DlScan.h"

@implementation DlScan
RCT_EXPORT_MODULE()

- (void)scanLicense:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject {
    // Placeholder implementation - will be replaced with actual DLParser-Swift integration
    NSDictionary *result = @{
        @"success": @NO,
        @"error": @{
            @"code": @"NOT_IMPLEMENTED",
            @"message": @"License scanning not yet implemented",
            @"userMessage": @"This feature is coming soon",
            @"recoverable": @YES
        }
    };
    
    resolve(result);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeDlScanSpecJSI>(params);
}

@end
