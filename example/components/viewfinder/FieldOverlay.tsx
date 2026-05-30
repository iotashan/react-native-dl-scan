import { View, Text, StyleSheet } from 'react-native';
import type { LicenseData } from 'react-native-dl-scan';

interface FieldPosition {
  key: keyof LicenseData;
  label: string;
  u: number;
  v: number;
}

const FIELD_POSITIONS: FieldPosition[] = [
  { key: 'licenseNumber', label: 'DLN', u: 0.25, v: 0.12 },
  { key: 'lastName', label: '', u: 0.05, v: 0.28 },
  { key: 'firstName', label: '', u: 0.05, v: 0.36 },
  { key: 'street', label: '', u: 0.05, v: 0.5 },
  { key: 'city', label: '', u: 0.05, v: 0.58 },
  { key: 'dateOfBirth', label: 'DOB', u: 0.05, v: 0.78 },
  { key: 'sex', label: 'SEX', u: 0.05, v: 0.86 },
  { key: 'height', label: 'HGT', u: 0.25, v: 0.78 },
  { key: 'eyeColor', label: 'EYES', u: 0.25, v: 0.86 },
  { key: 'hairColor', label: 'HAIR', u: 0.4, v: 0.86 },
  { key: 'weight', label: 'WGT', u: 0.4, v: 0.78 },
  { key: 'vehicleClass', label: 'CLASS', u: 0.72, v: 0.12 },
  { key: 'expirationDate', label: 'EXP', u: 0.05, v: 0.94 },
  { key: 'issueDate', label: 'ISS', u: 0.3, v: 0.94 },
];

interface FieldOverlayProps {
  data: LicenseData | null;
  /** 8 floats: 4 corner xy pairs in VIEW pixel space (already
   *  crop-transformed). Order: TL, TR, BR, BL. */
  viewCorners: number[];
}

function bilinear(
  u: number,
  v: number,
  corners: number[]
): { x: number; y: number } {
  const [tlx, tly, trx, try_, brx, bry, blx, bly] = corners;
  return {
    x:
      (1 - u) * (1 - v) * tlx +
      u * (1 - v) * trx +
      u * v * brx +
      (1 - u) * v * blx,
    y:
      (1 - u) * (1 - v) * tly +
      u * (1 - v) * try_ +
      u * v * bry +
      (1 - u) * v * bly,
  };
}

export function FieldOverlay({ data, viewCorners }: FieldOverlayProps) {
  if (!data || viewCorners.length !== 8) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {FIELD_POSITIONS.map((fp) => {
        const value = data[fp.key];
        if (value == null || value === '') return null;
        const displayVal =
          typeof value === 'string'
            ? value.length > 20
              ? value.slice(0, 20) + '…'
              : value
            : String(value);

        const pos = bilinear(fp.u, fp.v, viewCorners);

        return (
          <View key={fp.key} style={[styles.chip, { left: pos.x, top: pos.y }]}>
            {fp.label ? <Text style={styles.label}>{fp.label} </Text> : null}
            <Text style={styles.value} numberOfLines={1}>
              {displayVal}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 160,
  },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  value: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
