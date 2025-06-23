import type { ScanMode } from '../types/license';

/**
 * Configuration for scan mode behavior
 */
export interface ScanModeConfig {
  mode: ScanMode;
  frameProcessorConfig?: FrameProcessorConfig;
  timeoutMs?: number;
  maxAttempts?: number;
  autoSwitchEnabled?: boolean;
  autoSwitchThreshold?: number;
}

/**
 * Frame processor configuration
 */
export interface FrameProcessorConfig {
  enableBarcode?: boolean;
  enableOCR?: boolean;
  confidenceThreshold?: number;
  qualityThreshold?: number;
}

/**
 * Mode-specific UI configuration
 */
export interface ModeUIConfig {
  instructionText: string;
  frameColor?: string;
  showTorch?: boolean;
  torchAutoThreshold?: number;
}

/**
 * Mode transition configuration
 */
export interface ModeTransitionConfig {
  animationDuration?: number;
  showTransitionMessage?: boolean;
  transitionMessage?: string;
}

export const DEFAULT_MODE_CONFIGS: Record<ScanMode, Partial<ScanModeConfig>> = {
  auto: {
    timeoutMs: 10000,
    maxAttempts: 50,
    autoSwitchEnabled: true,
    autoSwitchThreshold: 50,
  },
  barcode: {
    timeoutMs: 30000,
    maxAttempts: 100,
    autoSwitchEnabled: false,
  },
  ocr: {
    timeoutMs: 15000,
    maxAttempts: 30,
    autoSwitchEnabled: false,
  },
};

export const MODE_UI_CONFIGS: Record<ScanMode, ModeUIConfig> = {
  auto: {
    instructionText: 'Position your license within the frame',
    frameColor: 'white',
    showTorch: true,
    torchAutoThreshold: 50,
  },
  barcode: {
    instructionText: 'Position the barcode within the frame',
    frameColor: '#00FF00',
    showTorch: true,
    torchAutoThreshold: 50,
  },
  ocr: {
    instructionText: 'Position the front of your license within the frame',
    frameColor: '#0080FF',
    showTorch: false,
  },
};
