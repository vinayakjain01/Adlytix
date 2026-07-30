'use client';

import { useEffect, useRef } from 'react';

/**
 * Runs `onSettle` once a value has stopped changing for `delay` ms.
 *
 * Used for analytics on inputs that change per keystroke — a search box and the
 * filter value fields. Tracking those directly would send one event per
 * character, which is both useless to read and a needless cost.
 *
 * The initial value is never reported: mounting a screen is not an interaction,
 * and `page_viewed` already covers arriving there.
 */
export function useSettledValue<T>(value: T, onSettle: (value: T) => void, delay = 600): void {
  const firstRun = useRef(true);
  // Held in a ref so an inline callback doesn't restart the timer every render.
  const callback = useRef(onSettle);

  // Synced in an effect rather than assigned during render: writing to a ref
  // while rendering is impure, and React may discard that render. Declared
  // before the timer effect so it has already run when the timer is armed.
  useEffect(() => {
    callback.current = onSettle;
  }, [onSettle]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => callback.current(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
}
