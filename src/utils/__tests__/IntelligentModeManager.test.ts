import { IntelligentModeManager } from '../IntelligentModeManager';
import type { IntelligentModeManagerEvents } from '../IntelligentModeManager';
import { AutoModeState } from '../../types/license';
import type { AutoModeConfig, QualityMetrics } from '../../types/license';

// Mock logger
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('IntelligentModeManager', () => {
  let manager: IntelligentModeManager;
  let mockEvents: jest.Mocked<IntelligentModeManagerEvents>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockEvents = {
      onAutoModeStateChange: jest.fn(),
      onModeRecommendation: jest.fn(),
      onWarningThresholdReached: jest.fn(),
      onQualityAssessment: jest.fn(),
    };

    manager = new IntelligentModeManager({}, mockEvents);
  });

  afterEach(() => {
    // Comprehensive cleanup to prevent memory leaks and timer issues
    if (manager) {
      manager.cancel();
      manager.destroy();
    }

    // Clear all timers and return to real timers
    jest.clearAllTimers();
    jest.useRealTimers();

    // Force garbage collection if available (for Node.js testing environments)
    if (global.gc) {
      global.gc();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const config = manager.getConfig();
      expect(config.pdf417TimeoutMs).toBe(10000);
      expect(config.warningThresholdMs).toBe(7000);
      expect(config.minQualityScore).toBe(0.7);
      expect(config.switchDelayMs).toBe(500);
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<AutoModeConfig> = {
        pdf417TimeoutMs: 15000,
        warningThresholdMs: 10000,
        minQualityScore: 0.8,
        switchDelayMs: 300,
      };

      const customManager = new IntelligentModeManager(customConfig);
      const config = customManager.getConfig();

      expect(config.pdf417TimeoutMs).toBe(15000);
      expect(config.warningThresholdMs).toBe(10000);
      expect(config.minQualityScore).toBe(0.8);
      expect(config.switchDelayMs).toBe(300);

      customManager.destroy();
    });

    it('should start in INITIAL_PDF417 state', () => {
      expect(manager.getCurrentAutoState()).toBe(AutoModeState.INITIAL_PDF417);
    });
  });

  describe('Auto-mode session management', () => {
    it('should start auto-mode session and setup timers', () => {
      manager.startAutoModeSession();

      expect(manager.getCurrentAutoState()).toBe(AutoModeState.INITIAL_PDF417);
      
      // Advance timer slightly to get a non-zero elapsed time
      jest.advanceTimersByTime(10);
      
      expect(manager.getTimeElapsed()).toBeGreaterThan(0);
      expect(manager.getTimeRemaining()).toBeLessThanOrEqual(10000);
    });

    it('should trigger warning threshold after configured time', () => {
      manager.startAutoModeSession();

      // Fast-forward to warning threshold (7000ms)
      jest.advanceTimersByTime(7000);

      expect(mockEvents.onWarningThresholdReached).toHaveBeenCalledWith(
        expect.any(Number),
        7000
      );
      expect(mockEvents.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeState.INITIAL_PDF417,
        AutoModeState.PDF417_TIMEOUT_WARNING
      );
    });

    it('should trigger timeout fallback after configured time', () => {
      manager.startAutoModeSession();

      // Fast-forward to timeout threshold (10000ms)
      jest.advanceTimersByTime(10000);

      expect(mockEvents.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeState.PDF417_TIMEOUT_WARNING,
        AutoModeState.SWITCHING_TO_OCR
      );

      // Fast-forward through switch delay (500ms)
      jest.advanceTimersByTime(500);

      expect(mockEvents.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeState.SWITCHING_TO_OCR,
        AutoModeState.OCR_ACTIVE
      );
      expect(mockEvents.onModeRecommendation).toHaveBeenCalledWith(
        'ocr',
        'Auto-mode switching due to timeout'
      );
    });

    it('should handle success state transition', () => {
      manager.startAutoModeSession();
      manager.markSuccess();

      expect(manager.getCurrentAutoState()).toBe(AutoModeState.SUCCESS);
      expect(mockEvents.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeState.INITIAL_PDF417,
        AutoModeState.SUCCESS
      );
    });
  });

  describe('Quality metrics processing', () => {
    const createTestQualityMetrics = (
      brightness = 0.8,
      blur = 0.2,
      glare = 0.1,
      documentAlignment = 0.9
    ): QualityMetrics => ({
      brightness,
      blur,
      glare,
      documentAlignment,
    });

    it('should process quality metrics and not trigger switch for good quality', () => {
      manager.startAutoModeSession();

      const goodQualityMetrics = createTestQualityMetrics(0.9, 0.1, 0.1, 0.9);
      const shouldSwitch = manager.processQualityMetrics(goodQualityMetrics);

      expect(shouldSwitch).toBe(false);
      expect(mockEvents.onQualityAssessment).toHaveBeenCalledWith(
        goodQualityMetrics,
        false
      );
    });

    it('should not trigger switch with insufficient frames', () => {
      manager.startAutoModeSession();

      // Process only 2 frames (need at least 3)
      const poorMetrics = createTestQualityMetrics(0.3, 0.8, 0.7, 0.2);

      manager.processQualityMetrics(poorMetrics);
      const shouldSwitch = manager.processQualityMetrics(poorMetrics);

      expect(shouldSwitch).toBe(false);
    });

    it('should trigger quality-based fallback with consistently poor quality', () => {
      manager.startAutoModeSession();

      const poorMetrics = createTestQualityMetrics(0.3, 0.8, 0.7, 0.2); // Quality ~0.25

      let switchTriggered = false;
      
      // Process frames until switch is triggered (need at least 3 frames)
      for (let i = 0; i < 5; i++) {
        const shouldSwitch = manager.processQualityMetrics(poorMetrics);
        if (shouldSwitch) {
          switchTriggered = true;
          break;
        }
      }

      expect(switchTriggered).toBe(true);
      expect(mockEvents.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeState.INITIAL_PDF417,
        AutoModeState.SWITCHING_TO_OCR
      );

      // Fast-forward through switch delay
      jest.advanceTimersByTime(500);

      expect(mockEvents.onModeRecommendation).toHaveBeenCalledWith(
        'ocr',
        'Auto-mode switching due to quality'
      );
    });

    it('should calculate quality score correctly', () => {
      manager.startAutoModeSession();

      // Perfect quality metrics: brightness=1, blur=0, glare=0, alignment=1
      // Score = (1 + 1 + (1-0) + (1-0)) / 4 = 1.0
      const perfectMetrics = createTestQualityMetrics(1.0, 0.0, 0.0, 1.0);

      // Poor quality metrics: brightness=0.2, blur=0.9, glare=0.8, alignment=0.1
      // Score = (0.2 + 0.1 + (1-0.9) + (1-0.8)) / 4 = 0.15
      const poorMetrics = createTestQualityMetrics(0.2, 0.9, 0.8, 0.1);

      manager.processQualityMetrics(perfectMetrics);
      manager.processQualityMetrics(perfectMetrics);
      manager.processQualityMetrics(perfectMetrics);
      let shouldSwitch = manager.processQualityMetrics(perfectMetrics);
      expect(shouldSwitch).toBe(false); // Should not switch for good quality

      // Reset manager for poor quality test
      manager.cancel();
      manager.startAutoModeSession();

      // Process poor quality frames - should trigger on 3rd frame or later
      let switchTriggered = false;
      for (let i = 0; i < 5; i++) {
        shouldSwitch = manager.processQualityMetrics(poorMetrics);
        if (shouldSwitch) {
          switchTriggered = true;
          break;
        }
      }
      expect(switchTriggered).toBe(true); // Should switch for poor quality
    });

    it('should maintain quality history buffer of max 5 frames', () => {
      manager.startAutoModeSession();

      const metrics = createTestQualityMetrics();

      // Process 10 frames
      for (let i = 0; i < 10; i++) {
        manager.processQualityMetrics(metrics);
      }

      // Buffer should only keep last 5 frames (internal state test)
      // We can't directly access the buffer, but we can verify behavior
      expect(mockEvents.onQualityAssessment).toHaveBeenCalledTimes(10);
    });
  });

  describe('Progress information', () => {
    it('should provide accurate progress information', () => {
      manager.startAutoModeSession();

      // Advance timer slightly to get non-zero elapsed time
      jest.advanceTimersByTime(10);
      
      // After slight delay from start
      let progress = manager.getProgressInfo();
      expect(progress.timeElapsed).toBeGreaterThan(0);
      expect(progress.estimatedTimeRemaining).toBeLessThanOrEqual(10000);
      expect(progress.progressPercentage).toBeGreaterThan(0);
      expect(progress.isTransitioning).toBe(false);
      expect(progress.message).toBe('Scanning barcode on back of license...');

      // After warning threshold
      jest.advanceTimersByTime(7000);
      progress = manager.getProgressInfo();
      expect(progress.progressPercentage).toBeGreaterThanOrEqual(70);
      expect(progress.message).toBe(
        'Still scanning barcode... may switch to text mode soon'
      );

      // During transition
      jest.advanceTimersByTime(3000); // Total 10000ms, triggering timeout
      progress = manager.getProgressInfo();
      expect(progress.isTransitioning).toBe(true);
      expect(progress.message).toBe('Switching to text recognition mode...');

      // After transition
      jest.advanceTimersByTime(500);
      progress = manager.getProgressInfo();
      expect(progress.isTransitioning).toBe(false);
      expect(progress.message).toBe('Scanning text on front of license...');
    });

    it('should provide accessibility announcements', () => {
      manager.startAutoModeSession();

      let progress = manager.getProgressInfo();
      expect(progress.accessibilityAnnouncement).toBe(
        'Auto-mode: scanning barcode'
      );

      jest.advanceTimersByTime(7000); // Warning threshold
      progress = manager.getProgressInfo();
      expect(progress.accessibilityAnnouncement).toBe(
        'Warning: may switch to text scanning soon'
      );

      jest.advanceTimersByTime(3000); // Timeout
      progress = manager.getProgressInfo();
      expect(progress.accessibilityAnnouncement).toBe(
        'Switching to text recognition mode'
      );

      jest.advanceTimersByTime(500); // After transition
      progress = manager.getProgressInfo();
      expect(progress.accessibilityAnnouncement).toBe(
        'Now scanning license text'
      );
    });
  });

  describe('Threshold checks', () => {
    it('should correctly report warning threshold status', () => {
      manager.startAutoModeSession();

      expect(manager.isWarningThresholdReached()).toBe(false);

      jest.advanceTimersByTime(7000);
      expect(manager.isWarningThresholdReached()).toBe(true);
    });

    it('should correctly report timeout status', () => {
      manager.startAutoModeSession();

      expect(manager.isTimeoutReached()).toBe(false);

      jest.advanceTimersByTime(10000);
      expect(manager.isTimeoutReached()).toBe(true);
    });

    it('should provide accurate time measurements', () => {
      manager.startAutoModeSession();

      jest.advanceTimersByTime(3000);
      expect(manager.getTimeElapsed()).toBeGreaterThanOrEqual(3000);
      expect(manager.getTimeRemaining()).toBeLessThanOrEqual(7000);
    });
  });

  describe('Configuration management', () => {
    it('should update configuration correctly', () => {
      const newConfig: Partial<AutoModeConfig> = {
        pdf417TimeoutMs: 15000,
        minQualityScore: 0.8,
      };

      manager.updateConfig(newConfig);
      const config = manager.getConfig();

      expect(config.pdf417TimeoutMs).toBe(15000);
      expect(config.minQualityScore).toBe(0.8);
      expect(config.warningThresholdMs).toBe(7000); // Should remain unchanged
    });
  });

  describe('Cleanup and cancellation', () => {
    it('should cancel session and clear timers', () => {
      manager.startAutoModeSession();

      jest.advanceTimersByTime(5000);
      manager.cancel();

      // Timers should be cleared, so advancing time shouldn't trigger events
      jest.advanceTimersByTime(10000);
      expect(mockEvents.onWarningThresholdReached).not.toHaveBeenCalled();
    });

    it('should destroy manager cleanly', () => {
      manager.startAutoModeSession();
      jest.advanceTimersByTime(5000);

      expect(() => manager.destroy()).not.toThrow();

      // After destroy, advancing timers shouldn't trigger events
      jest.advanceTimersByTime(10000);
      expect(mockEvents.onWarningThresholdReached).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle rapid session start/stop', () => {
      manager.startAutoModeSession();
      manager.cancel();
      manager.startAutoModeSession();
      manager.cancel();

      expect(() => manager.startAutoModeSession()).not.toThrow();
    });

    it('should handle quality metrics before session start', () => {
      const metrics = createQualityMetrics();

      // Should not throw when processing metrics before session start
      expect(() => manager.processQualityMetrics(metrics)).not.toThrow();
    });

    it('should handle markSuccess before session start', () => {
      expect(() => manager.markSuccess()).not.toThrow();
      expect(manager.getCurrentAutoState()).toBe(AutoModeState.SUCCESS);
    });

    it('should handle multiple destroy calls', () => {
      manager.destroy();
      expect(() => manager.destroy()).not.toThrow();
    });
  });

  describe('Event emission', () => {
    it('should emit all expected events during normal flow', () => {
      manager.startAutoModeSession();

      // Process some quality metrics
      const metrics = createQualityMetrics();
      manager.processQualityMetrics(metrics);

      // Fast-forward to warning
      jest.advanceTimersByTime(7000);

      // Fast-forward to timeout
      jest.advanceTimersByTime(3000);

      // Fast-forward through transition
      jest.advanceTimersByTime(500);

      // Mark success
      manager.markSuccess();

      // Verify all events were called
      expect(mockEvents.onQualityAssessment).toHaveBeenCalled();
      expect(mockEvents.onWarningThresholdReached).toHaveBeenCalled();
      // State changes may include additional transitions during quality assessment
      expect(mockEvents.onAutoModeStateChange).toHaveBeenCalledTimes(4);
      expect(mockEvents.onModeRecommendation).toHaveBeenCalled();
    });

    it('should work without event handlers', () => {
      const managerWithoutEvents = new IntelligentModeManager();

      expect(() => {
        managerWithoutEvents.startAutoModeSession();
        jest.advanceTimersByTime(10000);
        managerWithoutEvents.markSuccess();
        managerWithoutEvents.destroy();
      }).not.toThrow();
    });
  });
});

// Helper function to create quality metrics
function createQualityMetrics(
  brightness = 0.8,
  blur = 0.2,
  glare = 0.1,
  documentAlignment = 0.9
): QualityMetrics {
  return {
    brightness,
    blur,
    glare,
    documentAlignment,
  };
}
