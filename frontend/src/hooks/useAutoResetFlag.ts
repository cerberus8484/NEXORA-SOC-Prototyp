import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Returns [flag, trigger].
 * trigger() sets flag to true and resets it to false after `ms` milliseconds.
 * The timer is cleared on unmount and when trigger() is called again before
 * the previous delay has elapsed.
 */
export function useAutoResetFlag(ms: number): [boolean, () => void] {
  const [flag, setFlag] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const trigger = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
    }
    setFlag(true);
    timerRef.current = setTimeout(() => {
      setFlag(false);
      timerRef.current = undefined;
    }, ms);
  }, [ms]);

  return [flag, trigger];
}
