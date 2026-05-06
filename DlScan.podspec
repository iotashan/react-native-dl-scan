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

  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://github.com/iotashan/react-native-dl-scan.git", :tag => "#{s.version}" }

  s.source_files = 'ios/**/*.{h,m,mm,swift}',
                   'cpp/*.hpp',
                   'cpp/aamva/*.{cpp,hpp}',
                   'cpp/ocr/*.{cpp,hpp}',
                   'cpp/errors/*.{cpp,hpp}',
                   # Nitro-generated glue files (Obj-C++ registration + C++ Swift bridge)
                   'nitrogen/generated/ios/**/*.{h,hpp,c,cpp,mm}',
                   'nitrogen/generated/ios/swift/*.swift',
                   'nitrogen/generated/shared/**/*.{h,hpp,c,cpp}'
  s.private_header_files = "ios/**/*.h"

  s.frameworks   = ["Vision", "CoreVideo"]
  s.swift_version = "5.9"

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    # Enable bidirectional Swift <-> C++ interop (Swift 5.9 / Xcode 16+)
    'OTHER_SWIFT_FLAGS' => '-cxx-interoperability-mode=default',
    # Enables modular headers (required by NitroModules codegen)
    'DEFINES_MODULE' => 'YES',
    # Disable auto-generated ObjC header for Swift (static linkage on Xcode 16+ breaks here)
    'SWIFT_INSTALL_OBJC_HEADER' => 'NO',
    # Swift <-> ObjC++ interop mode (required to call generated Obj-C++ from Swift)
    'SWIFT_OBJC_INTEROP_MODE' => 'objcxx'
  }

  # Nitro Modules — required by HybridDlScanIOS.swift and the generated bridge files
  s.dependency "NitroModules"

  # VisionCamera — Pod-path consumers; SPM consumers resolve VC via their host package manifest
  s.dependency "VisionCamera"

  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
