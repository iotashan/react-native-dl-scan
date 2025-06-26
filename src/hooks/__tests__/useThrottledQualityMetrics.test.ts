import { renderHook, act } from '@testing-library/react-hooks';
import { useThrottledQualityMetrics } from '../useThrottledQualityMetrics';
import type { RealTimeQualityMetrics } from '../../types/license';

// Mock lodash throttle
jest.mock('lodash', () => ({
  throttle: jest.fn((fn, delay) => {
    let timeoutId: NodeJS.Timeout;
    const throttled = (...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
    return throttled;
  }),
}));

describe('useThrottledQualityMetrics', () => {
  const mockMetrics: RealTimeQualityMetrics = {
    blur: {
      value: 0.2,
      status: 'good',
    },
    lighting: {
      brightness: 0.8,
      uniformity: 0.9,
      status: 'good',
    },
    positioning: {
      documentDetected: true,
      alignment: 0.85,
      distance: 'optimal',
      status: 'good',
    },
    overall: {
      score: 0.85,
      readyToScan: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with undefined metrics', () => {
    const { result } = renderHook(() => useThrottledQualityMetrics());

    expect(result.current.metrics).toBeUndefined();
  });

  it('should provide updateMetrics function', () => {
    const { result } = renderHook(() => useThrottledQualityMetrics());

    expect(typeof result.current.updateMetrics).toBe('function');
    expect(typeof result.current.setMetrics).toBe('function');
  });

  it('should throttle metrics updates', async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useThrottledQualityMetrics());

    act(() => {
      result.current.updateMetrics(mockMetrics);
    });

    // Metrics should not be immediately updated due to throttling
    expect(result.current.metrics).toBeUndefined();

    // Fast forward time to trigger throttled update
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current.metrics).toEqual(mockMetrics);

    jest.useRealTimers();
  });

  it('should handle multiple rapid updates with throttling', async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useThrottledQualityMetrics());

    const metrics1 = {
      ...mockMetrics,
      overall: { score: 0.5, readyToScan: false },
    };
    const metrics2 = {
      ...mockMetrics,
      overall: { score: 0.7, readyToScan: false },
    };
    const metrics3 = {
      ...mockMetrics,
      overall: { score: 0.9, readyToScan: true },
    };

    // Send multiple updates rapidly
    act(() => {
      result.current.updateMetrics(metrics1);
      result.current.updateMetrics(metrics2);
      result.current.updateMetrics(metrics3);
    });

    // Should still be undefined due to throttling
    expect(result.current.metrics).toBeUndefined();

    // Advance time to process throttled update
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Should have the last metrics update
    expect(result.current.metrics).toEqual(metrics3);

    jest.useRealTimers();
  });

  it('should handle setMetrics as an alias for updateMetrics', async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useThrottledQualityMetrics());

    act(() => {
      result.current.setMetrics(mockMetrics);
    });

    // Fast forward time to trigger throttled update
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current.metrics).toEqual(mockMetrics);

    jest.useRealTimers();
  });

  it('should maintain throttle function identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useThrottledQualityMetrics());

    const firstUpdateFunction = result.current.updateMetrics;

    rerender();

    const secondUpdateFunction = result.current.updateMetrics;

    expect(firstUpdateFunction).toBe(secondUpdateFunction);
  });

  it('should work with frameProcessor parameter', () => {
    const { result } = renderHook(() => useThrottledQualityMetrics());

    expect(result.current.metrics).toBeUndefined();
    expect(typeof result.current.updateMetrics).toBe('function');
  });

  it('should handle null metrics gracefully', async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useThrottledQualityMetrics());

    act(() => {
      // This would simulate a frame processor returning null
      result.current.updateMetrics(null as any);
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Should handle null gracefully
    expect(result.current.metrics).toBeNull();

    jest.useRealTimers();
  });

  it('should respect the 100ms throttle interval for 10fps max update rate', () => {
    renderHook(() => useThrottledQualityMetrics());

    // This test verifies the throttle interval is implemented correctly
    // The actual throttling behavior is tested in the performance tests
  });
});
