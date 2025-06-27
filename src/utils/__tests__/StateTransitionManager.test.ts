import { StateTransitionManager } from '../StateTransitionManager';
import type { StateConfig, StateEvents } from '../StateTransitionManager';

describe('StateTransitionManager', () => {
  let manager: StateTransitionManager;
  let mockEvents: jest.Mocked<StateEvents>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockEvents = {
      onStateChange: jest.fn(),
      onModeSwitch: jest.fn(),
      onProgressUpdate: jest.fn(),
    };

    const config: StateConfig = {
      maxBarcodeAttempts: 5,
      barcodeTimeoutMs: 3000,
      maxFallbackProcessingTimeMs: 4000,
      enableAutoFallback: true,
    };

    manager = new StateTransitionManager(config, mockEvents);
  });

  afterEach(() => {
    // Cleanup to prevent memory leaks
    manager.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Timer Cleanup', () => {
    it('should clear transition timer when switching modes multiple times', () => {
      // First switch to OCR
      manager.switchMode('ocr', 'test reason 1');

      // Verify fallback_transition state
      expect(mockEvents.onStateChange).toHaveBeenCalledWith(
        'idle',
        'fallback_transition'
      );

      // Switch again before timer fires - should clear previous timer
      manager.switchMode('barcode', 'test reason 2');

      // Advance time to when the first timer would have fired
      jest.advanceTimersByTime(100);

      // Should not have transitioned to 'ocr' because timer was cleared
      expect(mockEvents.onStateChange).not.toHaveBeenCalledWith(
        'fallback_transition',
        'ocr'
      );
      expect(mockEvents.onStateChange).toHaveBeenCalledWith(
        'fallback_transition',
        'barcode'
      );
    });

    it('should clear transition timer on reset', () => {
      // Switch to OCR to start a timer
      manager.switchMode('ocr', 'test reason');

      // Reset before timer fires
      manager.reset();

      // Advance time
      jest.advanceTimersByTime(100);

      // Should not have transitioned to 'ocr' because timer was cleared
      expect(mockEvents.onStateChange).not.toHaveBeenCalledWith(
        'fallback_transition',
        'ocr'
      );
    });

    it('should clear transition timer on destroy', () => {
      // Switch to OCR to start a timer
      manager.switchMode('ocr', 'test reason');

      // Destroy before timer fires
      manager.destroy();

      // Advance time
      jest.advanceTimersByTime(100);

      // Should not have transitioned to 'ocr' because timer was cleared
      expect(mockEvents.onStateChange).not.toHaveBeenCalledWith(
        'fallback_transition',
        'ocr'
      );
    });

    it('should properly complete transition when timer is allowed to fire', () => {
      // Switch to OCR
      manager.switchMode('ocr', 'test reason');

      // Verify initial state change
      expect(mockEvents.onStateChange).toHaveBeenCalledWith(
        'idle',
        'fallback_transition'
      );

      // Let timer fire
      jest.advanceTimersByTime(100);

      // Should have transitioned to 'ocr'
      expect(mockEvents.onStateChange).toHaveBeenCalledWith(
        'fallback_transition',
        'ocr'
      );
    });

    it('should handle multiple rapid destroy calls without errors', () => {
      // Switch to OCR to create a timer
      manager.switchMode('ocr', 'test reason');

      // Multiple destroy calls should not throw
      expect(() => {
        manager.destroy();
        manager.destroy();
        manager.destroy();
      }).not.toThrow();
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not accumulate timers with repeated mode switches', () => {
      // Perform many mode switches
      for (let i = 0; i < 100; i++) {
        manager.switchMode('ocr', `test reason ${i}`);
        // Switch back before timer fires
        manager.switchMode('barcode', `test reason ${i}`);
      }

      // Advance time to ensure no lingering timers fire
      jest.advanceTimersByTime(10000);

      // Count how many times state changed to 'ocr'
      const ocrTransitions = mockEvents.onStateChange.mock.calls.filter(
        (call) => call[1] === 'ocr'
      ).length;

      // Should be 0 because we always switched away before timer fired
      expect(ocrTransitions).toBe(0);
    });

    it('should clean up all resources on destroy', () => {
      const originalSetTimeout = global.setTimeout;
      const activeTimers = new Set<NodeJS.Timeout>();

      // Track all setTimeout calls
      global.setTimeout = jest.fn((callback, delay) => {
        const timer = originalSetTimeout(callback, delay);
        activeTimers.add(timer);
        return timer;
      }) as any;

      // Create a new manager with our tracked setTimeout
      const trackedManager = new StateTransitionManager({
        maxBarcodeAttempts: 5,
        barcodeTimeoutMs: 3000,
        maxFallbackProcessingTimeMs: 4000,
        enableAutoFallback: true,
      });

      // Trigger timer creation
      trackedManager.switchMode('ocr', 'test');

      // Should have created one timer
      expect(activeTimers.size).toBe(1);

      // Destroy should clear the timer
      trackedManager.destroy();

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    });
  });
});
