// useScannerInternals — single unconditional composition of the camera +
// permission + license-scanner hooks (Phase H Wave 1 foundation refactor).
//
// Extracted verbatim from the previous ScannerScreen so the runtime
// behavior is identical. review pair-review constraint: this hook MUST
// call its sub-hooks in a single, unconditional path so React's hook
// rules hold across shell switches (phone portrait / phone landscape /
// tablet). Permission gating happens at a level ABOVE this hook
// (PermissionGate), but the hooks themselves still run unconditionally —
// PermissionGate just chooses what to render based on the state we
// return here.

import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type CameraDevice,
} from 'react-native-vision-camera';
import * as Device from 'expo-device';
import { useLicenseScanner, type LicenseData } from 'react-native-dl-scan';
import { NitroModules } from 'react-native-nitro-modules';
import type { Phase } from '../components/ScannerScreen';

const Hybrid = NitroModules.createHybridObject<any>('DlScan');
const FIXTURE_SAMPLE =
  '@\nANSI 636014090002DL00410288ZC03290025DLDAQD12345678\n' +
  'DCSDOE\nDACJANE\nDBB01151990\nDBA01152030\nDBC2\nDAU064 IN\nDAYBLU\n';

export interface UseScannerInternalsArgs {
  mode: 'barcode' | 'ocr';
  phase: Phase;
  setPhase: (p: Phase) => void;
  onResult: (data: LicenseData) => void;
  showFixtureTweak: boolean;
}

export interface ScannerInternals {
  // Permission state — consumed by PermissionGate (no hooks owned there).
  status: ReturnType<typeof useCameraPermission>['status'];
  hasPermission: boolean;
  canRequestPermission: boolean;
  requestPermission: () => Promise<boolean>;
  // Camera device — also consumed by PermissionGate to surface the
  // "No back camera" prompt when null.
  device: CameraDevice | undefined;
  // Scanner hook surface — passed through to layouts.
  scanner: ReturnType<typeof useLicenseScanner>;
  // Fixture button visibility + runner.
  showFixture: boolean;
  runFixture: () => Promise<void>;
  // The live <Camera/> element. Pre-built here so layouts can drop it
  // into a Viewfinder without re-deriving zoom / outputs / device.
  cameraSlot: ReactNode;
}

export function useScannerInternals({
  mode,
  phase,
  setPhase,
  onResult,
  showFixtureTweak,
}: UseScannerInternalsArgs): ScannerInternals {
  const { hasPermission, requestPermission, canRequestPermission, status } =
    useCameraPermission();

  // Multi-cam virtual device so iOS can auto-swap to the ultra-wide
  // (min focus ~2cm) when the user gets close enough that the wide
  // camera's ~10cm min focus would blur the card. On Android (Pixel
  // etc.) this returns the closest virtual-or-wide device available.
  // Telephoto is intentionally excluded — its ~80cm min focus is
  // irrelevant for close ID scanning and slows session start.
  // review (2026-05-15): zoom must be pinned too; auto-macro
  // by focus-distance alone is unreliable across iPhone generations.
  const device = useCameraDevice('back', {
    physicalDevices: ['ultra-wide-angle', 'wide-angle'],
  });

  useEffect(() => {
    if (device == null) return;
    console.log(
      '[dl-scan/camera]',
      JSON.stringify({
        id: device.id,
        name: device.localizedName,
        isVirtual: device.isVirtualDevice,
        physicals: device.physicalDevices.map((p) => p.type),
        minZoom: device.minZoom,
        switchFactors: device.zoomLensSwitchFactors,
      })
    );
  }, [device]);

  // Camera zoom strategy (review pair-review round 2):
  //   iOS: 0.97 * switchOverFactor[0] — stays JUST below the UW→wide
  //   switch point so iOS keeps the ultra-wide active (the only iPhone
  //   lens that can focus at the 4-6" working distance for ID scans),
  //   while applying maximum digital crop on the UW (~2x at 0.97 vs
  //   0.5 minZoom) to recover frame coverage the wider FOV loses.
  //
  //   Android: 1.0 neutral. Pixel 6's main wide cam focuses fine at
  //   4-6"; biasing below switch-over forces the UW which has wider
  //   FOV → fewer DL pixels → YOLO confidence collapses (this is the
  //   regression we observed today). review round 2 said explicitly:
  //   "Pixel worked before; Android should probably start at 1.0."
  //
  //   Single-physical-device fallback: clamp to >= 1.0 so we never
  //   sub-zoom below neutral on devices without a virtual multi-cam.
  const cameraZoom = (() => {
    if (device == null) return 1;
    const firstSwitch = device.zoomLensSwitchFactors?.[0];
    if (Platform.OS === 'ios' && firstSwitch != null) {
      // Just below switchOverFactor[0] keeps ultra-wide active with
      // maximum digital crop. 0.97 gives noticeably more pixels per
      // DL character than 0.9 (review round 2 critique).
      return firstSwitch * 0.97;
    }
    if (
      Platform.OS === 'ios' &&
      device.physicalDevices.some(
        (d) => d.type === 'ultra-wide-angle' || d.type.includes('ultra')
      ) &&
      device.minZoom < 1
    ) {
      // Virtual multi-cam device with ultra-wide but no switchFactors
      // reported. Force zoom to 0.8 — stays on ultra-wide (min focus
      // ~2cm) with moderate digital crop. The wide lens at zoom=1.0
      // can't focus at the 4-6" working distance for DL scanning.
      return 0.8;
    }
    // Android + iOS single-cam + unknown: neutral zoom (= wide native).
    return Math.max(1, device.minZoom);
  })();

  const scanner = useLicenseScanner(mode);

  // Scanner hook is fresh on mount — App.tsx re-keys ScannerScreen on
  // every new scan session (scanSessionId), guaranteeing the hook's
  // licenseData/isScanning/resultCount all start at their defaults
  // without any chance of a stale passive-effect closure from the
  // previous session firing. round-6 review design: the previous
  // useLayoutEffect+ref-guard fix could not work because passive
  // effects close over pre-reset state.
  useEffect(() => {
    if (
      phase === 'scanning' &&
      scanner.licenseData != null &&
      !scanner.isScanning
    ) {
      onResult(scanner.licenseData);
      setPhase('captured');
    }
  }, [scanner.licenseData, scanner.isScanning, phase, setPhase, onResult]);

  // Conditional outputs — pause semantics per Round 2. While
  // we're not in the scanning phase, the camera stays mounted (so the
  // preview keeps the dim-camera look during pipeline + the
  // viewfinder doesn't flicker remount), but the frame processor
  // output array detaches → no MLKit decoding + no AAMVA parsing
  // firing in the background.
  const outputs = phase === 'scanning' ? [scanner.output] : [];

  const showFixture = showFixtureTweak && !Device.isDevice;
  const runFixture = async () => {
    try {
      const r = await Hybrid.parseBarcodeData(FIXTURE_SAMPLE);
      if (r != null) {
        onResult(r as LicenseData);
        setPhase('pipeline');
      }
    } catch {
      // Swallow — devs use the fixture button in sim/emu only; if
      // the parse fails they can see scanner.error elsewhere.
    }
  };

  // Build the camera element here so the layouts don't need to know
  // about device / zoom / outputs. When device is null we render
  // nothing — PermissionGate will surface the "No back camera" prompt
  // before this slot is ever consumed, but we still hand a stable
  // ReactNode (possibly null) back to keep the prop shape sound.
  const cameraSlot: ReactNode =
    device != null ? (
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={outputs}
        zoom={cameraZoom}
      />
    ) : null;

  return {
    status,
    hasPermission,
    canRequestPermission,
    requestPermission,
    device: device ?? undefined,
    scanner,
    showFixture,
    runFixture,
    cameraSlot,
  };
}
