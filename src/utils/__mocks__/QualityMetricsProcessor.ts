/**
 * Mock for QualityMetricsProcessor
 * Provides a test-friendly implementation with spy capabilities
 */

// Removed unused imports - types are not used in mock implementation

export const mockQualityMetricsProcessor = {
  processQualityMetrics: jest.fn().mockReturnValue(false),
  assessQuality: jest.fn().mockReturnValue(true),
  getQualityScore: jest.fn().mockReturnValue(0.85),
  getRecentMetrics: jest.fn().mockReturnValue([]),
  shouldRecommendModeSwitch: jest.fn().mockReturnValue(false),
  getRecommendedMode: jest.fn().mockReturnValue('auto'),
  reset: jest.fn(),
  cleanup: jest.fn(),
};

export class QualityMetricsProcessor {
  constructor(_config: any, _events?: any) {
    Object.assign(this, mockQualityMetricsProcessor);
  }

  // Ensure all methods are available
  processQualityMetrics = mockQualityMetricsProcessor.processQualityMetrics;
  assessQuality = mockQualityMetricsProcessor.assessQuality;
  getQualityScore = mockQualityMetricsProcessor.getQualityScore;
  getRecentMetrics = mockQualityMetricsProcessor.getRecentMetrics;
  shouldRecommendModeSwitch =
    mockQualityMetricsProcessor.shouldRecommendModeSwitch;
  getRecommendedMode = mockQualityMetricsProcessor.getRecommendedMode;
  reset = mockQualityMetricsProcessor.reset;
  cleanup = mockQualityMetricsProcessor.cleanup;
}
