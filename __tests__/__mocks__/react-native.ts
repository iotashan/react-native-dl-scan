// Minimal react-native stub for Jest (Node environment).
// Only surfaces what the tested code paths actually use.
export const Platform = {
  OS: 'ios',
  select: (obj: Record<string, unknown>) => obj.ios,
};
export const NativeModules = {};
