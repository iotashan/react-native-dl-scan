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

  s.source_files = 'ios/**/*.{h,m,mm,swift}', 'cpp/**/*.{cpp,hpp,h}'
  s.private_header_files = "ios/**/*.h"

  s.frameworks   = ["Vision", "CoreVideo"]
  s.swift_version = "5.9"

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++'
  }

  # VisionCamera — Pod-path consumers; SPM consumers resolve VC via their host package manifest
  s.dependency "VisionCamera"

  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
