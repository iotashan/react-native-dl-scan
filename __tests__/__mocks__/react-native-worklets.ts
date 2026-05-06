// Minimal react-native-worklets stub for Jest.
export const runOnJS =
  <T extends unknown[]>(fn: (...args: T) => void) =>
  (...args: T) =>
    fn(...args);
export const createSynchronizable = () => ({ value: null });
export const useSharedValue = <T>(v: T) => ({ value: v });
export const useRunOnJS = (fn: (...args: unknown[]) => unknown) => fn;
