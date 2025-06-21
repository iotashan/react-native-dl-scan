#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>

@interface DlScanFrameProcessorPlugin : FrameProcessorPlugin
@end

@implementation DlScanFrameProcessorPlugin

- (id)callback:(Frame*)frame withArguments:(NSDictionary*)arguments {
    // This will be implemented in the next task (T02_S02) for actual PDF417 scanning
    // For now, we're just setting up the plugin structure
    
    // Return a placeholder response
    return @{
        @"frameWidth": @(frame.width),
        @"frameHeight": @(frame.height),
        @"status": @"ready"
    };
}

VISION_EXPORT_FRAME_PROCESSOR(DlScanFrameProcessorPlugin, scanLicense)

@end