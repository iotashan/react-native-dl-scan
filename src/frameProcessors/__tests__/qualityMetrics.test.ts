import {
  calculateQualityMetrics,
  convertLegacyMetrics,
  shouldAnalyzeFrame,
  getCachedQualityMetrics,
  setCachedQualityMetrics,
} from '../qualityMetrics';

// Mock frame object
const mockFrame = {
  width: 1920,
  height: 1080,
  bytesPerRow: 7680,
  planarCount: 1,
  toString: () => '[Frame 1920x1080]',
} as any;

describe('qualityMetrics', () => {
  describe('calculateQualityMetrics', () => {
    it('should return valid quality metrics structure', () => {
      const metrics = calculateQualityMetrics(mockFrame);

      expect(metrics).toHaveProperty('blur');
      expect(metrics.blur).toHaveProperty('value');
      expect(metrics.blur).toHaveProperty('status');
      expect(typeof metrics.blur.value).toBe('number');
      expect(['good', 'warning', 'poor']).toContain(metrics.blur.status);

      expect(metrics).toHaveProperty('lighting');
      expect(metrics.lighting).toHaveProperty('brightness');
      expect(metrics.lighting).toHaveProperty('uniformity');
      expect(metrics.lighting).toHaveProperty('status');
      expect(typeof metrics.lighting.brightness).toBe('number');
      expect(typeof metrics.lighting.uniformity).toBe('number');
      expect(['good', 'warning', 'poor']).toContain(metrics.lighting.status);

      expect(metrics).toHaveProperty('positioning');
      expect(metrics.positioning).toHaveProperty('documentDetected');
      expect(metrics.positioning).toHaveProperty('alignment');
      expect(metrics.positioning).toHaveProperty('distance');
      expect(metrics.positioning).toHaveProperty('status');
      expect(typeof metrics.positioning.documentDetected).toBe('boolean');
      expect(typeof metrics.positioning.alignment).toBe('number');
      expect(['too_close', 'optimal', 'too_far']).toContain(
        metrics.positioning.distance
      );
      expect(['good', 'warning', 'poor']).toContain(metrics.positioning.status);

      expect(metrics).toHaveProperty('overall');
      expect(metrics.overall).toHaveProperty('score');
      expect(metrics.overall).toHaveProperty('readyToScan');
      expect(typeof metrics.overall.score).toBe('number');
      expect(typeof metrics.overall.readyToScan).toBe('boolean');
    });

    it('should return values in expected ranges', () => {
      const metrics = calculateQualityMetrics(mockFrame);

      expect(metrics.blur.value).toBeGreaterThanOrEqual(0);
      expect(metrics.blur.value).toBeLessThanOrEqual(1);

      expect(metrics.lighting.brightness).toBeGreaterThanOrEqual(0);
      expect(metrics.lighting.brightness).toBeLessThanOrEqual(1);

      expect(metrics.lighting.uniformity).toBeGreaterThanOrEqual(0);
      expect(metrics.lighting.uniformity).toBeLessThanOrEqual(1);

      expect(metrics.positioning.alignment).toBeGreaterThanOrEqual(0);
      expect(metrics.positioning.alignment).toBeLessThanOrEqual(1);

      expect(metrics.overall.score).toBeGreaterThanOrEqual(0);
      expect(metrics.overall.score).toBeLessThanOrEqual(1);
    });

    it('should set readyToScan to false when no document detected', () => {
      // Run multiple times to check consistency when documentDetected is false
      for (let i = 0; i < 10; i++) {
        const metrics = calculateQualityMetrics(mockFrame);
        if (!metrics.positioning.documentDetected) {
          expect(metrics.overall.readyToScan).toBe(false);
        }
      }
    });
  });

  describe('convertLegacyMetrics', () => {
    it('should convert legacy metrics to new format', () => {
      const legacyMetrics = {
        blur: 0.3,
        lighting: 0.7,
        positioning: 0.8,
        overall: 'good' as const,
      };

      const converted = convertLegacyMetrics(legacyMetrics);

      expect(converted.blur.value).toBe(0.3);
      expect(converted.blur.status).toBe('warning'); // 0.3 should be warning
      expect(converted.lighting.brightness).toBe(0.7);
      expect(converted.lighting.status).toBe('good'); // 0.7 should be good
      expect(converted.positioning.alignment).toBe(0.8);
      expect(converted.positioning.status).toBe('good'); // 0.8 should be good
      expect(converted.overall.readyToScan).toBe(true); // 'good' should be true
    });

    it('should handle poor quality legacy metrics', () => {
      const poorLegacyMetrics = {
        blur: 0.8,
        lighting: 0.2,
        positioning: 0.3,
        overall: 'poor' as const,
      };

      const converted = convertLegacyMetrics(poorLegacyMetrics);

      expect(converted.blur.status).toBe('poor');
      expect(converted.lighting.status).toBe('poor');
      expect(converted.positioning.status).toBe('warning');
      expect(converted.overall.readyToScan).toBe(false);
    });

    it('should estimate uniformity from brightness', () => {
      const legacyMetrics = {
        blur: 0.2,
        lighting: 0.8,
        positioning: 0.7,
        overall: 'good' as const,
      };

      const converted = convertLegacyMetrics(legacyMetrics);

      // Uniformity should be estimated as brightness * 0.9
      expect(converted.lighting.uniformity).toBeCloseTo(0.72, 10);
    });

    it('should set document detected based on positioning', () => {
      const highPositioning = {
        blur: 0.2,
        lighting: 0.7,
        positioning: 0.8,
        overall: 'good' as const,
      };

      const lowPositioning = {
        blur: 0.2,
        lighting: 0.7,
        positioning: 0.2,
        overall: 'poor' as const,
      };

      const convertedHigh = convertLegacyMetrics(highPositioning);
      const convertedLow = convertLegacyMetrics(lowPositioning);

      expect(convertedHigh.positioning.documentDetected).toBe(true);
      expect(convertedLow.positioning.documentDetected).toBe(false);
    });

    it('should determine distance based on positioning value', () => {
      const optimalPositioning = {
        blur: 0.2,
        lighting: 0.7,
        positioning: 0.9,
        overall: 'good' as const,
      };

      const farPositioning = {
        blur: 0.2,
        lighting: 0.7,
        positioning: 0.6,
        overall: 'fair' as const,
      };

      const closePositioning = {
        blur: 0.2,
        lighting: 0.7,
        positioning: 0.3,
        overall: 'poor' as const,
      };

      expect(
        convertLegacyMetrics(optimalPositioning).positioning.distance
      ).toBe('optimal');
      expect(convertLegacyMetrics(farPositioning).positioning.distance).toBe(
        'too_far'
      );
      expect(convertLegacyMetrics(closePositioning).positioning.distance).toBe(
        'too_close'
      );
    });
  });

  describe('shouldAnalyzeFrame', () => {
    it('should return true for frame 0', () => {
      expect(shouldAnalyzeFrame(0, 10)).toBe(true);
    });

    it('should return true for every 3rd frame at 10fps target', () => {
      // At 30fps camera, to get 10fps analysis, analyze every 3rd frame
      expect(shouldAnalyzeFrame(0, 10)).toBe(true);
      expect(shouldAnalyzeFrame(1, 10)).toBe(false);
      expect(shouldAnalyzeFrame(2, 10)).toBe(false);
      expect(shouldAnalyzeFrame(3, 10)).toBe(true);
      expect(shouldAnalyzeFrame(4, 10)).toBe(false);
      expect(shouldAnalyzeFrame(5, 10)).toBe(false);
      expect(shouldAnalyzeFrame(6, 10)).toBe(true);
    });

    it('should handle different target FPS', () => {
      // At 5fps target, analyze every 6th frame
      expect(shouldAnalyzeFrame(0, 5)).toBe(true);
      expect(shouldAnalyzeFrame(6, 5)).toBe(true);
      expect(shouldAnalyzeFrame(12, 5)).toBe(true);

      // At 15fps target, analyze every 2nd frame
      expect(shouldAnalyzeFrame(0, 15)).toBe(true);
      expect(shouldAnalyzeFrame(2, 15)).toBe(true);
      expect(shouldAnalyzeFrame(4, 15)).toBe(true);
    });

    it('should use default 10fps when no target specified', () => {
      expect(shouldAnalyzeFrame(0)).toBe(true);
      expect(shouldAnalyzeFrame(3)).toBe(true);
      expect(shouldAnalyzeFrame(6)).toBe(true);
    });
  });

  describe('Quality metrics caching', () => {
    beforeEach(() => {
      // Clear any existing cache
      getCachedQualityMetrics('clear-cache');
    });

    it('should cache and retrieve quality metrics', () => {
      const mockMetrics = {
        blur: { value: 0.2, status: 'good' as const },
        lighting: { brightness: 0.8, uniformity: 0.9, status: 'good' as const },
        positioning: {
          documentDetected: true,
          alignment: 0.85,
          distance: 'optimal' as const,
          status: 'good' as const,
        },
        overall: { score: 0.85, readyToScan: true },
      };

      setCachedQualityMetrics('test-frame-1', mockMetrics);
      const retrieved = getCachedQualityMetrics('test-frame-1');

      expect(retrieved).toEqual(mockMetrics);
    });

    it('should return null for non-existent cache entries', () => {
      const retrieved = getCachedQualityMetrics('non-existent-frame');
      expect(retrieved).toBeNull();
    });

    it('should return null for expired cache entries', () => {
      const mockMetrics = {
        blur: { value: 0.2, status: 'good' as const },
        lighting: { brightness: 0.8, uniformity: 0.9, status: 'good' as const },
        positioning: {
          documentDetected: true,
          alignment: 0.85,
          distance: 'optimal' as const,
          status: 'good' as const,
        },
        overall: { score: 0.85, readyToScan: true },
      };

      setCachedQualityMetrics('test-frame-2', mockMetrics);

      // Mock old timestamp by setting maxAge to 0
      const retrieved = getCachedQualityMetrics('test-frame-2', 0);
      expect(retrieved).toBeNull();
    });

    it('should limit cache size', () => {
      const mockMetrics = {
        blur: { value: 0.2, status: 'good' as const },
        lighting: { brightness: 0.8, uniformity: 0.9, status: 'good' as const },
        positioning: {
          documentDetected: true,
          alignment: 0.85,
          distance: 'optimal' as const,
          status: 'good' as const,
        },
        overall: { score: 0.85, readyToScan: true },
      };

      // Add more than 10 entries to test cleanup
      for (let i = 0; i < 15; i++) {
        setCachedQualityMetrics(`test-frame-${i}`, mockMetrics);
      }

      // First entries should be cleaned up
      const firstEntry = getCachedQualityMetrics('test-frame-0');
      const lastEntry = getCachedQualityMetrics('test-frame-14');

      expect(firstEntry).toBeNull();
      expect(lastEntry).toEqual(mockMetrics);
    });
  });
});
