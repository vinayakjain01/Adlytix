'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A UI preference persisted in localStorage, read without an effect.
 *
 * The obvious approach — default in `useState`, then read localStorage in an
 * effect — needs a state update during mount, and reading the store during
 * render instead would make the server markup and the client's first render
 * disagree. `useSyncExternalStore` exists for exactly this: it hydrates from
 * `getServerSnapshot` and switches to the live value afterwards, so there is no
 * mismatch and no effect.
 *
 * localStorage is the single source of truth, so a change in another tab is
 * picked up here too.
 */

/** Same-tab writes don't fire `storage`, so subscribers are notified directly. */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private browsing and blocked storage both throw rather than return null.
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be saved is not worth failing the interaction.
  }
  notify();
}

/**
 * Reads a stored preference through `parse`, falling back to `fallback` when it
 * is absent or unrecognised — which is also what the server render sees.
 */
export function useStoredPreference<T>(
  key: string,
  parse: (raw: string | null) => T | null,
  fallback: T,
): [T, (value: T, serialise: (value: T) => string) => void] {
  const getSnapshot = useCallback(() => parse(readPreference(key)) ?? fallback, [key, parse, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T, serialise: (value: T) => string) => writePreference(key, serialise(next)),
    [key],
  );

  return [value, set];
}
