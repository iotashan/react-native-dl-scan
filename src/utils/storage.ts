import type { ScanMode } from '../types/license';

const STORAGE_KEYS = {
  SCAN_MODE: '@dl_scan_mode',
} as const;

/**
 * Storage interface to abstract the storage mechanism
 * This allows for easy switching between AsyncStorage, MMKV, or other storage solutions
 */
export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

let storageAdapter: StorageAdapter | null = null;

/**
 * Initialize the storage adapter
 * @param adapter The storage adapter to use (e.g., AsyncStorage)
 */
export function initializeStorage(adapter: StorageAdapter) {
  storageAdapter = adapter;
}

/**
 * Get the persisted scan mode
 */
export async function getPersistedScanMode(): Promise<ScanMode | null> {
  if (!storageAdapter) {
    console.warn(
      'Storage adapter not initialized. Call initializeStorage first.'
    );
    return null;
  }

  try {
    const savedMode = await storageAdapter.getItem(STORAGE_KEYS.SCAN_MODE);
    if (savedMode && ['auto', 'barcode', 'ocr'].includes(savedMode)) {
      return savedMode as ScanMode;
    }
  } catch (error) {
    console.error('Error loading persisted scan mode:', error);
  }
  return null;
}

/**
 * Save the scan mode preference
 */
export async function persistScanMode(mode: ScanMode): Promise<void> {
  if (!storageAdapter) {
    console.warn(
      'Storage adapter not initialized. Call initializeStorage first.'
    );
    return;
  }

  try {
    await storageAdapter.setItem(STORAGE_KEYS.SCAN_MODE, mode);
  } catch (error) {
    console.error('Error persisting scan mode:', error);
  }
}

/**
 * Clear the persisted scan mode
 */
export async function clearPersistedScanMode(): Promise<void> {
  if (!storageAdapter) {
    console.warn(
      'Storage adapter not initialized. Call initializeStorage first.'
    );
    return;
  }

  try {
    await storageAdapter.removeItem(STORAGE_KEYS.SCAN_MODE);
  } catch (error) {
    console.error('Error clearing persisted scan mode:', error);
  }
}

/**
 * In-memory storage adapter for testing or when no persistence is needed
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private storage = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.storage.get(key) || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }
}

// Initialize with in-memory storage by default
// Users can override this with AsyncStorage or other adapters
initializeStorage(new InMemoryStorageAdapter());
