'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  captureError, identifyUser, initAnalytics, resetAnalytics, setAnalyticsScreen, track,
} from '@/lib/analytics/client';
import { screenFor } from '@/lib/analytics/screens';

/**
 * Wires analytics to the app lifecycle:
 *   - starts PostHog once
 *   - captures a pageview per route, with a screen label
 *   - measures time on each screen and reports it on leave
 *   - identifies the operator once a session is known, and resets on sign-out
 *   - reports uncaught errors and unhandled promise rejections
 *
 * Renders nothing and never throws: analytics failing must not take the app
 * down with it.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const { user, status } = useAuth();

  // Time-on-page bookkeeping. Refs, not state, so measuring never re-renders.
  // Seeded at 0 rather than Date.now(): reading the clock during render is
  // impure, and the pageview effect below sets it before anything reads it.
  const enteredAt = useRef<number>(0);
  const trackedPath = useRef<string | null>(null);
  const seenPaths = useRef<Set<string>>(new Set());
  const identified = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  // ── Pageview + time on page ───────────────────────────────────────────────
  useEffect(() => {
    if (!pathname) return;

    const previous = trackedPath.current;
    const now = Date.now();

    // Close out the screen being left before opening the new one.
    if (previous && previous !== pathname) {
      setAnalyticsScreen(screenFor(previous));
      track('page_time_spent', {
        path: previous,
        seconds: Math.round((now - enteredAt.current) / 1000),
        exited_app: false,
      });
    }

    if (previous === pathname) return;

    setAnalyticsScreen(screenFor(pathname));
    const isFirstView = !seenPaths.current.has(pathname);
    seenPaths.current.add(pathname);
    trackedPath.current = pathname;
    enteredAt.current = now;

    track('page_viewed', { path: pathname, is_first_view: isFirstView });
  }, [pathname]);

  // ── Time on page when the tab itself goes away ────────────────────────────
  useEffect(() => {
    // `pagehide` fires on tab close, navigation away, and mobile backgrounding,
    // where `beforeunload` is unreliable. `visibilitychange` is not used because
    // a tab switch is not the same as leaving the screen.
    const flush = () => {
      const path = trackedPath.current;
      // enteredAt is 0 until the first pageview effect runs; measuring from it
      // would report a duration counted from the epoch.
      if (!path || enteredAt.current === 0) return;
      track('page_time_spent', {
        path,
        seconds: Math.round((Date.now() - enteredAt.current) / 1000),
        exited_app: true,
      });
      // Reset so a restored page doesn't double-count the same dwell.
      enteredAt.current = Date.now();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // ── Identity ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'authenticated' && user) {
      // Guard against re-identifying on every session refresh.
      if (identified.current !== user.id) {
        identifyUser(user);
        identified.current = user.id;
      }
      return;
    }
    if (status === 'unauthenticated' && identified.current) {
      resetAnalytics();
      identified.current = null;
    }
  }, [status, user]);

  // ── Uncaught errors ───────────────────────────────────────────────────────
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      captureError(event.error ?? event.message, {
        source: 'window',
        message: event.message,
        endpoint: null,
        status_code: null,
        component: null,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      captureError(event.reason, {
        source: 'promise',
        endpoint: null,
        status_code: null,
        component: null,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
