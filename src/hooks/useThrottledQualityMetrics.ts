import { useState, useCallback, useRef } from 'react';

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
 * Throttled quality metrics hook to maintain 60fps performance
 * Updates quality metrics at maximum 10 times per second as specified in task
 */
export const useThrottledQualityMetrics = () => {
  const [metrics, setMetrics] = useState<RealTimeQualityMetrics | undefined>();
  const lastUpdateTime = useRef<number>(0);
  const throttleDelay = 100; // 100ms = 10fps max

  const updateMetrics = useCallback(
    (newMetrics: RealTimeQualityMetrics) => {
      const now = Date.now();
      if (now - lastUpdateTime.current >= throttleDelay) {
        setMetrics(newMetrics);
        lastUpdateTime.current = now;
      }
    },
    [throttleDelay]
  );

  return {
    metrics,
    updateMetrics,
    setMetrics: updateMetrics,
  };
};
