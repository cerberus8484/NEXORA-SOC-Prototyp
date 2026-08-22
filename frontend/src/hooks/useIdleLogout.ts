import { useEffect } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'touchstart'] as const;

/**
 * Loggt nach `timeoutMinutes` Inaktivität aus (clientseitiger Inaktivitäts-Timeout).
 * 0 oder negativ → deaktiviert (kein Timer, keine Listener).
 *
 * `onIdle` sollte stabil sein (useCallback), sonst wird der Effekt bei jedem
 * Render neu aufgesetzt.
 */
export function useIdleLogout(timeoutMinutes: number, onIdle: () => void): void {
  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;
    const ms = timeoutMinutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, ms);
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, reset, { passive: true });
    }
    reset();

    return () => {
      clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, reset);
    };
  }, [timeoutMinutes, onIdle]);
}
