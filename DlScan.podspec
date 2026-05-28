# === COCOAPODS COMPAT SHIM ===
# Primary distribution for this library is Swift Package Manager (Package.swift).
# This podspec exists for consumers on `pod install` workflows through the
# CocoaPods Trunk sunset on 2026-12-02. It will be removed in a follow-up
# release once the Nitro Modules and Vision Camera v5 ecosystems publish
# complete SPM packages and consumer adoption has migrated.

require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DlScan"
  s.module_name  = 'DlScan'
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # iOS 16 floor: the bundled DlScanFieldDetector.mlmodelc uses the
  # ML Program (mlprogram) Core ML format which requires iOS 16+ to load.
  s.platforms    = { :ios => "16.0" }
  s.source       = { :git => "https://github.com/iotashan/react-native-dl-scan.git", :tag => "#{s.version}" }

  # Hand-written iOS + C++ sources. Nitro-generated glue is appended below by
  # `add_nitrogen_files(s)`, which also partitions public/private headers so
  # the Cxx-Umbrella never ends up in the auto-generated DlScan-umbrella.h
  # (otherwise Swift module emission tries to read DlScan-Swift.h before it
  # has been generated — chicken-and-egg).
  s.source_files = 'ios/**/*.{h,m,mm,swift}',
                   'cpp/*.{cpp,hpp}',
                   'cpp/aamva/*.{cpp,hpp}',
                   'cpp/mrz/*.{cpp,hpp}',
                   'cpp/ocr/*.{cpp,hpp}',
                   'cpp/yolo/*.{cpp,hpp}',
                   'cpp/errors/*.{cpp,hpp}'
  # Expose the cpp/ headers in the auto-generated DlScan-umbrella.h so the
  # `dlscan::LicenseData` C++ namespace (defined in cpp/license_data.hpp)
  # becomes reachable from HybridDlScanIOS.swift via -import-underlying-module
  # + the Cxx-interop mode set by add_nitrogen_files below.
  s.public_header_files = 'cpp/**/*.hpp'
  s.private_header_files = "ios/**/*.h"

  # Compiled Core ML model — packaged as a resource bundle. CocoaPods
  # expands resource_bundles with include_dirs:true, preserving the .mlmodelc
  # package-directory semantics that a flat s.resources glob would break.
  # Loaded at runtime by HybridDlScanIOS via Bundle for(class:).
  s.resource_bundles = {
    'DlScan' => ['ios/Resources/DlScanFieldDetector.mlmodelc']
  }

  # CoreML framework is required to load and run the bundled .mlmodelc at
  # runtime; Vision is required for VNCoreMLModel + VNDetectDocumentSegmentation;
  # CoreVideo for CVPixelBuffer manipulation.
  s.frameworks   = ["Vision", "CoreML", "CoreVideo"]
  s.swift_version = "5.9"

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
    # Lets cpp/aamva/*.{hpp,cpp} resolve `mrz/mrz_parser.hpp` and
    # `license_data.hpp` the same way the C++ test build (CMake) does.
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/cpp"',
    # Enable Swift <-> C++ interop so HybridDlScanIOS.swift can reach
    # `dlscan::LicenseData` / `dlscan::parse_aamva`. add_nitrogen_files
    # only sets SWIFT_OBJC_INTEROP_MODE=objcxx, which is ObjC++-bridge
    # only — the direct C++ namespace import requires this extra flag.
    'OTHER_SWIFT_FLAGS' => '-cxx-interoperability-mode=default'
  }

  # Nitro autolinking — appends generated source files, sets correct
  # public/private header partitions, and merges in the Cxx-interop pod
  # xcconfig (SWIFT_OBJC_INTEROP_MODE, SWIFT_INSTALL_OBJC_HEADER=NO,
  # DEFINES_MODULE=YES, etc.). Mirrors the pattern used by react-native-nitro-image.
  load 'nitrogen/generated/ios/DlScan+autolinking.rb'
  add_nitrogen_files(s)

  # VisionCamera — Pod-path consumers; SPM consumers resolve VC via their host package manifest
  s.dependency "VisionCamera"

  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
