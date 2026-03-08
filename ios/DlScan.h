#ifdef RCT_NEW_ARCH_ENABLED
#import <DlScanSpec/DlScanSpec.h>

@interface DlScan : NSObject <NativeDlScanSpec>
@end
#else
#import <React/RCTBridgeModule.h>

@interface DlScan : NSObject <RCTBridgeModule>
@end
#endif
