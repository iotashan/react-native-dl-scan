// PermissionGate — pure presentational permission/device gate (Phase H
// Wave 1 foundation refactor).
//
// Receives camera permission + device state as props (from
// `useScannerInternals`) and either renders one of the four
// PermissionPrompt cases or its `children` if all clear.
//
// IMPORTANT (pair review constraint): this component MUST NOT
// call any hook that touches the camera, scanner, or device:
//
//   - NO `useCameraPermission()`
//   - NO `useCameraDevice()`
//   - NO `useLicenseScanner()`
//
// Holding any of those here would create a second runtime owner of
// scanner state, fighting with `useScannerInternals` for native
// camera handles and producing duplicate effect closures. The gate
// is pure presentation; ALL scanner-touching hooks live in
// `useScannerInternals`.
//
// Lifted verbatim from the previous ScannerScreen branches — same
// titles, copy, CTA labels, and styling — so this is a no-behavior-
// change refactor for phone portrait.

import type { ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native';
import type { CameraDevice } from 'react-native-vision-camera';
import { useTokens } from '../theme/useTokens';

type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | string;

export interface PermissionGateProps {
  status: PermissionStatus;
  hasPermission: boolean;
  canRequestPermission: boolean;
  requestPermission: () => Promise<boolean> | void;
  device: CameraDevice | undefined;
  t: ReturnType<typeof useTokens>['t'];
  children: ReactNode;
}

export function PermissionGate({
  status,
  hasPermission,
  canRequestPermission,
  requestPermission,
  device,
  t,
  children,
}: PermissionGateProps) {
  if (status === 'restricted') {
    return (
      <PermissionPrompt
        t={t}
        title="Camera restricted"
        body="Parental controls or a device policy block camera access for this app. The administrator needs to allow it."
        cta="Open settings"
        onCta={() => Linking.openSettings()}
      />
    );
  }
  if (!hasPermission && canRequestPermission) {
    return (
      <PermissionPrompt
        t={t}
        title="Camera access"
        body="The scanner needs the camera to read a license barcode or its front side. The app does not record video or send pixels off-device."
        cta="Allow camera"
        onCta={() => {
          requestPermission();
        }}
      />
    );
  }
  if (!hasPermission) {
    return (
      <PermissionPrompt
        t={t}
        title="Camera access denied"
        body="Open Settings, find this app, and turn Camera on — when you come back the screen will refresh automatically."
        cta="Open settings"
        onCta={() => Linking.openSettings()}
      />
    );
  }
  if (device == null) {
    return (
      <PermissionPrompt
        t={t}
        title="No back camera"
        body="The emulator may need a virtual webcam configured. AVD Manager → edit device → Camera → Back: VirtualScene or Webcam0."
        cta={null}
      />
    );
  }
  return <>{children}</>;
}

function PermissionPrompt({
  t,
  title,
  body,
  cta,
  onCta,
}: {
  t: ReturnType<typeof useTokens>['t'];
  title: string;
  body: string;
  cta: string | null;
  onCta?: () => void;
}) {
  return (
    <View style={styles.permissionHost}>
      <Text style={[styles.permissionTitle, { color: t.ink }]}>{title}</Text>
      <Text style={[styles.permissionBody, { color: t.ink2 }]}>{body}</Text>
      {cta != null && (
        <Pressable
          onPress={onCta}
          style={[styles.permissionCta, { backgroundColor: t.ink }]}
        >
          <Text style={[styles.permissionCtaLabel, { color: t.bg }]}>
            {cta}
          </Text>
        </Pressable>
      )}
      <ActivityIndicator color={t.ink3} style={{ marginTop: 12 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  permissionHost: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  permissionTitle: { fontSize: 20, fontWeight: '700' },
  permissionBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  permissionCta: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permissionCtaLabel: { fontSize: 15, fontWeight: '600' },
});
