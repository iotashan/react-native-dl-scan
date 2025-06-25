import type { Frame } from 'react-native-vision-camera';

interface RealTimeQualityMetrics {
  blur: {
    value: number; // 0-1, lower is better
    status: 'good' | 'warning' | 'poor';
  };
  lighting: {
    brightness: number; // 0-1
    uniformity: number; // 0-1
    status: 'good' | 'warning' | 'poor';
  };
  positioning: {
    documentDetected: boolean;
    alignment: number; // 0-1
    distance: 'too_close' | 'optimal' | 'too_far';
    status: 'good' | 'warning' | 'poor';
  };
  overall: {
    score: number; // 0-1
    readyToScan: boolean;
  };
}

/**
 * Calculate quality metrics from camera frame
 * This is a TypeScript implementation that would call native implementations
 * for performance-critical calculations
 */
export function calculateQualityMetrics(_frame: Frame): RealTimeQualityMetrics {
  'worklet';

  // Note: In a real implementation, these would be native calculations
  // using iOS Vision Framework and Core Image filters for efficiency
  // The frame parameter would be used for actual image analysis

  // Simulate blur calculation (would use Laplacian variance in native)
  const blurValue = Math.random() * 0.5; // Simulated blur (0-0.5 for demo)
  const blurStatus =
    blurValue < 0.15 ? 'good' : blurValue < 0.3 ? 'warning' : 'poor';

  // Simulate lighting calculation (would use histogram analysis in native)
  const brightness = 0.4 + Math.random() * 0.4; // Simulated brightness (0.4-0.8)
  const uniformity = 0.6 + Math.random() * 0.3; // Simulated uniformity (0.6-0.9)
  const lightingStatus =
    brightness > 0.6 && uniformity > 0.7
      ? 'good'
      : brightness > 0.4 && uniformity > 0.5
        ? 'warning'
        : 'poor';

  // Simulate document detection and positioning
  const documentDetected = Math.random() > 0.3; // 70% chance detected
  const alignment = Math.random(); // Random alignment (0-1)

  // Determine distance based on frame analysis (simulated)
  const distanceRandom = Math.random();
  const distance =
    distanceRandom < 0.2
      ? 'too_close'
      : distanceRandom > 0.8
        ? 'too_far'
        : 'optimal';

  const positioningStatus =
    documentDetected && alignment > 0.7 && distance === 'optimal'
      ? 'good'
      : documentDetected && alignment > 0.4
        ? 'warning'
        : 'poor';

  // Calculate overall score
  const overallScore = documentDetected
    ? (1 - blurValue + brightness + alignment) / 3
    : 0.2;

  const readyToScan =
    overallScore > 0.7 &&
    blurStatus === 'good' &&
    lightingStatus !== 'poor' &&
    positioningStatus === 'good';

  return {
    blur: {
      value: blurValue,
      status: blurStatus,
    },
    lighting: {
      brightness,
      uniformity,
      status: lightingStatus,
    },
    positioning: {
      documentDetected,
      alignment,
      distance,
      status: positioningStatus,
    },
    overall: {
      score: overallScore,
      readyToScan,
    },
  };
}

/**
 * Convert legacy quality metrics to new interface
 * For backward compatibility with existing code
 */
export function convertLegacyMetrics(legacy: {
  blur: number;
  lighting: number;
  positioning: number;
  overall: 'good' | 'fair' | 'poor';
}): RealTimeQualityMetrics {
  'worklet';

  return {
    blur: {
      value: legacy.blur,
      status:
        legacy.blur < 0.3 ? 'good' : legacy.blur < 0.6 ? 'warning' : 'poor',
    },
    lighting: {
      brightness: legacy.lighting,
      uniformity: legacy.lighting * 0.9, // Estimate uniformity
      status:
        legacy.lighting > 0.6
          ? 'good'
          : legacy.lighting > 0.3
            ? 'warning'
            : 'poor',
    },
    positioning: {
      documentDetected: legacy.positioning > 0.3,
      alignment: legacy.positioning,
      distance:
        legacy.positioning > 0.8
          ? 'optimal'
          : legacy.positioning > 0.5
            ? 'too_far'
            : 'too_close',
      status:
        legacy.positioning > 0.7
          ? 'good'
          : legacy.positioning > 0.4
            ? 'warning'
            : 'poor',
    },
    overall: {
      score: (legacy.lighting + legacy.positioning + (1 - legacy.blur)) / 3,
      readyToScan: legacy.overall === 'good',
    },
  };
}

/**
 * Smart sampling - analyze every Nth frame for performance
 * Returns true if this frame should be analyzed
 */
export function shouldAnalyzeFrame(
  frameCount: number,
  targetFPS: number = 10
): boolean {
  'worklet';

  // Assuming 30fps camera, analyze every 3rd frame to get ~10fps quality assessment
  const skipFrames = Math.floor(30 / targetFPS);
  return frameCount % skipFrames === 0;
}

/**
 * Cache results to reduce redundant calculations
 * In a real implementation, this would use more sophisticated caching
 */
const qualityCache = new Map<
  string,
  { metrics: RealTimeQualityMetrics; timestamp: number }
>();

export function getCachedQualityMetrics(
  frameId: string,
  maxAge: number = 100
): RealTimeQualityMetrics | null {
  'worklet';

  const cached = qualityCache.get(frameId);
  if (cached && Date.now() - cached.timestamp < maxAge) {
    return cached.metrics;
  }
  return null;
}

export function setCachedQualityMetrics(
  frameId: string,
  metrics: RealTimeQualityMetrics
): void {
  'worklet';

  qualityCache.set(frameId, {
    metrics,
    timestamp: Date.now(),
  });

  // Clean old entries (simple cleanup)
  if (qualityCache.size > 10) {
    const firstKey = qualityCache.keys().next().value;
    if (firstKey !== undefined) {
      qualityCache.delete(firstKey);
    }
  }
}
