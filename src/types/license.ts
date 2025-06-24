export interface LicenseData {
  // Personal Information
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;

  // Dates
  dateOfBirth?: Date;
  issueDate?: Date;
  expirationDate?: Date;

  // Physical Description
  sex?: 'M' | 'F';
  eyeColor?: string;
  hairColor?: string;
  height?: string;
  weight?: string;

  // Address
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };

  // License Information
  licenseNumber?: string;
  licenseClass?: string;
  restrictions?: string;
  endorsements?: string;

  // Metadata
  issuerIdentificationNumber?: string;
  documentDiscriminator?: string;

  // Flags
  isOrganDonor?: boolean;
  isVeteran?: boolean;
  isRealID?: boolean;

  // Raw data for debugging
  allFields?: Record<string, string>;
}

export interface ScanError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}

export interface LicenseResult {
  success: boolean;
  data?: LicenseData;
  error?: ScanError;
  processingTime?: number;
}

export interface OCRTextObservation {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type ScanMode = 'auto' | 'barcode' | 'ocr';

export type ScanningState =
  | 'idle'
  | 'barcode'
  | 'ocr'
  | 'fallback_transition'
  | 'completed'
  | 'failed';

export interface FallbackConfig {
  barcodeTimeoutMs: number;
  ocrTimeoutMs: number;
  maxBarcodeAttempts: number;
  maxFallbackProcessingTimeMs: number;
  enableQualityAssessment: boolean;
  enableFallback?: boolean;
  confidenceThreshold?: number;
}

export interface ScanProgress {
  state: ScanningState;
  mode: ScanMode;
  startTime: number;
  barcodeAttempts: number;
  timeElapsed: number;
  message?: string;
  // UI state information
  progressPercentage?: number;
  showCancelButton?: boolean;
  animationState?: 'idle' | 'entering' | 'exiting';
  accessibilityAnnouncement?: string;
  isTransitioning?: boolean;
  estimatedTimeRemaining?: number;
}

export interface PerformanceMetrics {
  // High-resolution timing breakdowns
  totalProcessingTime: number;
  barcodeAttemptTime?: number;
  ocrProcessingTime?: number;
  modeTransitionTime?: number;

  // Detailed timing breakdowns
  barcodePreparationTime?: number;
  barcodeDecodingTime?: number;
  ocrPreprocessingTime?: number;
  ocrTextExtractionTime?: number;
  ocrParsingTime?: number;

  // Neural Engine optimization metrics
  neuralEngineUtilization?: number; // Percentage
  gpuProcessingTime?: number;
  cpuProcessingTime?: number;

  // Memory profiling
  initialMemoryUsageMB: number;
  peakMemoryUsageMB: number;
  finalMemoryUsageMB: number;
  memoryDeltaMB: number;
  memoryAllocations?: number;
  memoryDeallocations?: number;

  // CPU/GPU utilization
  peakCpuUtilization?: number; // Percentage
  averageCpuUtilization?: number; // Percentage
  peakGpuUtilization?: number; // Percentage
  averageGpuUtilization?: number; // Percentage

  // Frame processing metrics
  framesProcessed?: number;
  framesDropped?: number;
  frameProcessingRate?: number; // FPS

  // Performance targets validation
  meetsOcrTarget: boolean; // <2 seconds
  meetsFallbackTarget: boolean; // <4 seconds
  meetsMemoryTarget: boolean; // <50MB increase
  meetsCpuTarget: boolean; // <60% peak usage
}

export interface PerformanceAlert {
  type: 'warning' | 'critical';
  category: 'timeout' | 'memory' | 'performance' | 'transition' | 'cpu' | 'gpu';
  message: string;
  timestamp: number;
  threshold: number;
  actualValue: number;
  metrics?: Record<string, any>;
}

export interface PerformanceBenchmark {
  testName: string;
  device: string;
  timestamp: number;
  iterations: number;
  results: PerformanceMetrics[];
  summary: {
    mean: PerformanceMetrics;
    median: PerformanceMetrics;
    p95: PerformanceMetrics;
    p99: PerformanceMetrics;
  };
  regressionDetected?: boolean;
  baselineComparison?: {
    improvement: boolean;
    percentageChange: number;
    significantChange: boolean;
  };
}

export interface ScanMetrics {
  totalProcessingTime: number;
  barcodeAttemptTime?: number;
  ocrProcessingTime?: number;
  modeTransitionTime?: number;
  fallbackTriggered: boolean;
  fallbackReason?: 'timeout' | 'failure' | 'quality' | 'manual';
  finalMode: ScanMode;
  success: boolean;

  // Performance metrics
  barcodeAttempts?: number;
  ocrAttempts?: number;
  retryAttempts?: number;
  peakMemoryUsageMB?: number;
  averageMemoryUsageMB?: number;
  frameQualityScore?: number;
  confidenceScore?: number;
  performanceRating?: 'excellent' | 'good' | 'acceptable' | 'poor' | 'critical';
  bottlenecks?: string[];
  recommendations?: string[];

  // Enhanced performance tracking
  detailedPerformance?: PerformanceMetrics;
  performanceAlerts?: PerformanceAlert[];
  benchmarkData?: Partial<PerformanceBenchmark>;
}
