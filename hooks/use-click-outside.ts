'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover when the pointer lands outside `ref`, or on Escape.
 * Shared by the header's month and currency pickers.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    function handlePointerDown(event: MouseEvent) {
      const el = ref.current;
      if (el && !el.contains(event.target as Node)) onOutside();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onOutside();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, onOutside, enabled]);
}
