import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIdleLogout } from './useIdleLogout';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useIdleLogout', () => {
  test('ruft onIdle nach Ablauf der Inaktivitätsdauer', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout(1, onIdle)); // 1 Minute
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test('Aktivität setzt den Timer zurück', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout(1, onIdle));
    vi.advanceTimersByTime(50_000);
    window.dispatchEvent(new Event('keydown')); // Aktivität → reset
    vi.advanceTimersByTime(50_000);             // insgesamt 100s, aber seit reset nur 50s
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);             // jetzt 60s seit reset
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test('deaktiviert (0) → kein Timer, kein onIdle', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout(0, onIdle));
    vi.advanceTimersByTime(10 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  test('räumt Listener + Timer beim Unmount auf', () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleLogout(1, onIdle));
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
