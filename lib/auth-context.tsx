'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import {
  fetchSession, login as loginRequest, logout as logoutRequest,
  logoutEverywhere as logoutEverywhereRequest, type SessionUser,
} from './auth';
import { track } from './analytics/client';
import { ApiError } from './http';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: SessionUser | null;
  status: AuthStatus;
  signIn: (email: string, password: string, remember: boolean) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  /** Re-reads the session; used after anything that could change access. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // The cookie is httpOnly, so the only way to know whether a session exists
  // is to ask the API. Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await fetchSession();
      if (cancelled) return;
      setUser(session);
      setStatus(session ? 'authenticated' : 'unauthenticated');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sign-in is the one flow where both outcomes are worth measuring, so the
  // events live here rather than in the screen: any future caller of signIn
  // gets the same tracking without duplicating it.
  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    track('login_submitted', { remember });
    const startedAt = Date.now();
    try {
      const session = await loginRequest(email, password, remember);
      setUser(session);
      setStatus('authenticated');
      track('login_succeeded', {
        remember,
        role: session.role,
        status: session.status,
        is_platform_admin: session.isPlatformAdmin,
        had_previous_login: session.lastLoginAt !== null,
        duration_ms: Date.now() - startedAt,
      });
      return session;
    } catch (err) {
      // The message is the API's operator-facing reason ("Subscription
      // expired"), which is exactly what makes failed logins diagnosable. The
      // email is deliberately not sent.
      track('login_failed', {
        reason: err instanceof Error ? err.message : 'Unknown error',
        status_code: err instanceof ApiError ? err.status : null,
        duration_ms: Date.now() - startedAt,
      });
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    // Emitted before the reset in AnalyticsProvider drops attribution, so the
    // event still belongs to the operator who signed out.
    track('logout', { scope: 'this_device' });
    try {
      await logoutRequest();
    } finally {
      // Clear locally even if the request failed — the intent was to leave.
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const signOutEverywhere = useCallback(async () => {
    track('logout', { scope: 'all_devices' });
    try {
      await logoutEverywhereRequest();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const refresh = useCallback(async () => {
    const session = await fetchSession();
    // A refresh that finds no session where one was expected means the session
    // expired or was revoked server-side — worth distinguishing from a logout.
    if (!session && status === 'authenticated') {
      track('session_invalidated', { reason: 'session no longer valid' });
    }
    setUser(session);
    setStatus(session ? 'authenticated' : 'unauthenticated');
  }, [status]);

  const value = useMemo(
    () => ({ user, status, signIn, signOut, signOutEverywhere, refresh }),
    [user, status, signIn, signOut, signOutEverywhere, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
