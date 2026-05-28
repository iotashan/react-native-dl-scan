# Security Policy

## Supported versions

Only the latest minor release receives security updates.

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No (never publicly released) |

## Reporting a vulnerability

If you discover a security issue, please report it privately. **Do not open a
public GitHub issue for security problems.**

Email: **shan@iotashan.com**

Please include:

- A description of the issue
- Steps to reproduce, or a proof-of-concept
- Affected version(s)
- Whether the issue is already public anywhere

You should receive an acknowledgement within seven days. From there:

- For confirmed issues, a fix and coordinated disclosure timeline will be
  discussed with you.
- Resolution timing depends on severity. Critical issues (remote code
  execution, data exfiltration via the library) take priority over
  configuration or documentation issues.

When the fix ships, you will be credited in the release notes unless you
prefer to remain anonymous.

## What we consider in scope

- Code execution triggered by malicious camera input or PDF417 payloads
- Memory safety issues in the C++ AAMVA parser or shared core
- Unintended data leakage from the library — log files, exception messages,
  cached files written to non-app-private locations
- Network calls from the library. **The library does not make network
  requests.** Any network activity originating from `react-native-dl-scan`
  itself is a bug; please report it.
- Supply-chain compromise of bundled model files or vendored native deps

## What is out of scope

- Misuse by consuming apps. Consuming apps are responsible for:
  - Declaring camera usage (`NSCameraUsageDescription` on iOS, runtime
    permission flow on Android)
  - Implementing their own privacy policy and consent flows
  - Securing license data after the library returns it (storage, transmission,
    retention)
- Issues in peer dependencies (Vision Camera, Nitro Modules, ML Kit, etc.).
  Report those to their upstream projects.
- The example app. It is a demo; do not rely on it as a security boundary.

## Hardening guidance for consumers

A few defaults worth knowing:

- All processing is on-device. The library never sends pixels or parsed fields
  off the device.
- Card images saved by the scanner (when enabled) are written to the app's
  private container. Delete them when no longer needed.
- License data returned by the scanner contains personally identifiable
  information. Treat it accordingly: do not log it, do not include it in
  crash reports, and surface it only on screens the user explicitly visits.
