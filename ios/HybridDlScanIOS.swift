import Foundation
import NitroModules
import DlScanCxx
import CxxStdlib

/// Swift implementation of the DlScan Nitro HybridObject.
///
/// Parses AAMVA-encoded PDF417 barcode strings by delegating directly to the
/// C++ core (dlscan::parse_aamva) so the same logic executes on the iOS
/// production path. The 66 GoogleTest cases cover this same C++ code.
///
/// Registration is handled automatically by the auto-generated
/// DlScanAutolinking.mm (loaded via +load on first class access).
/// Host apps do NOT need to call any registration function manually —
/// CocoaPods autolinking handles it through pod_target_xcconfig.
class HybridDlScanIOS: HybridDlScanSpec {

  // MARK: - HybridDlScanSpec

  func parseBarcodeData(barcodeData: String) throws -> Promise<Variant_NullType_LicenseDataSpec> {
    return Promise.parallel {
      // Delegate to the C++ core — dlscan::parse_aamva returns
      // std::optional<dlscan::LicenseData>. Optional(fromCxx:) bridges
      // std::optional<T> → Swift Optional<T> (Swift 5.9+ C++ interop).
      let cppBarcode = std.string(barcodeData)
      let cppResult = dlscan.parse_aamva(cppBarcode)
      guard let cppData = Optional(fromCxx: cppResult) else {
        return Variant_NullType_LicenseDataSpec.first(.null)
      }
      let spec = HybridDlScanIOS.toLicenseDataSpec(cppData)
      return Variant_NullType_LicenseDataSpec.second(spec)
    }
  }

  // MARK: - Private helpers

  /// Bridge a C++ std::optional<std::string> to Swift String?.
  /// Uses the Nitro bridge helpers from DlScan-Swift-Cxx-Bridge.hpp for
  /// consistency with Nitrogen's own generated accessor pattern.
  private static func optStr(
    _ opt: margelo.nitro.dlscan.bridge.swift.std__optional_std__string_
  ) -> String? {
    typealias B = margelo.nitro.dlscan.bridge.swift
    guard B.has_value_std__optional_std__string_(opt) else { return nil }
    return String(B.get_std__optional_std__string_(opt))
  }

  /// Convert a C++ dlscan::LicenseData struct to the Nitro-generated LicenseDataSpec.
  ///
  /// Field types in dlscan::LicenseData (cpp/license_data.hpp):
  ///   - All string fields are std::optional<std::string>
  ///   - `sex` is std::optional<std::string> with values "M"/"F"/"X"
  ///   - `aamvaVersion` is std::optional<int>
  ///
  /// The Nitro LicenseDataSpec maps those to:
  ///   - String fields → String? (via bridge helpers)
  ///   - `sex` → Sex? (Nitro-generated enum; Sex(fromString:) does the conversion)
  ///   - `aamvaVersion` → Double? (TS number maps to C++ double in Nitro)
  private static func toLicenseDataSpec(_ ld: dlscan.LicenseData) -> LicenseDataSpec {
    // sex: std::optional<std::string> ("M"/"F"/"X") → Sex?
    let sexStr: String? = optStr(ld.sex)
    let sexValue: Sex? = sexStr.flatMap { Sex(fromString: $0) }

    // aamvaVersion: std::optional<int> → Double?
    // Optional(fromCxx:) bridges std::optional<int> → Swift Int?, then
    // convert to Double (Nitro maps TS `number` to C++ double).
    let versionValue: Double? = Optional(fromCxx: ld.aamvaVersion).map { Double($0) }

    return LicenseDataSpec(
      firstName:      optStr(ld.firstName),
      lastName:       optStr(ld.lastName),
      middleName:     optStr(ld.middleName),
      dateOfBirth:    optStr(ld.dateOfBirth),
      expirationDate: optStr(ld.expirationDate),
      issueDate:      optStr(ld.issueDate),
      licenseNumber:  optStr(ld.licenseNumber),
      street:         optStr(ld.street),
      city:           optStr(ld.city),
      state:          optStr(ld.state),
      postalCode:     optStr(ld.postalCode),
      country:        optStr(ld.country),
      sex:            sexValue,
      eyeColor:       optStr(ld.eyeColor),
      height:         optStr(ld.height),
      vehicleClass:   optStr(ld.vehicleClass),
      restrictions:   optStr(ld.restrictions),
      endorsements:   optStr(ld.endorsements),
      aamvaVersion:   versionValue
    )
  }
}
