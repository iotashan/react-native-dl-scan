// Mock for src/utils/QualityMetricsProcessor.ts
class MockQualityMetricsProcessor {
  constructor(config, events) {
    this.config = config;
    this.events = events;
    this.qualityBuffer = [];
    this.lastAssessmentTime = 0;
  }

  processQualityMetrics(metrics) {
    const now = Date.now();
    this.lastAssessmentTime = now;

    // Simple quality assessment
    const overallScore = 0.8; // Good default for tests
    const shouldSwitch = overallScore < this.config.minQualityThreshold;

    // Emit assessment event
    this.events?.onQualityAssessment(metrics, shouldSwitch);

    return shouldSwitch;
  }

  addToBuffer(entry) {
    this.qualityBuffer.push(entry);
    if (this.qualityBuffer.length > this.config.bufferSize) {
      this.qualityBuffer.shift();
    }
  }

  calculateOverallScore(metrics) {
    // Simple calculation for tests
    return 0.8;
  }

  shouldSwitchMode(metrics, score) {
    return score < this.config.minQualityThreshold;
  }

  getBufferSize() {
    return this.qualityBuffer.length;
  }

  getTimeSinceLastAssessment() {
    return this.lastAssessmentTime > 0
      ? Date.now() - this.lastAssessmentTime
      : 0;
  }

  reset() {
    this.qualityBuffer = [];
    this.lastAssessmentTime = 0;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

module.exports = {
  QualityMetricsProcessor: MockQualityMetricsProcessor,
};
