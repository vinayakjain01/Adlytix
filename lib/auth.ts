import { apiFetch, apiJson, postJson } from './http';

export type UserRole = 'admin' | 'owner' | 'analyst' | 'viewer';
/** `expired` is derived server-side from the client's subscription date. */
export type UserStatus = 'active' | 'invited' | 'suspended' | 'expired';

export interface SessionClient {
  id: string;
  name: string;
  subscriptionExpiresAt: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  isPlatformAdmin: boolean;
  /** Null for platform administrators, who belong to no client. */
  client: SessionClient | null;
  lastLoginAt: string | null;
}

export function login(email: string, password: string, remember: boolean) {
  return postJson<SessionUser>('/api/auth/login', { email, password, remember });
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function logoutEverywhere() {
  return apiFetch('/api/auth/logout-everywhere', { method: 'POST' });
}

/**
 * Restores a session from the cookie. Returns null when there is no valid
 * session — a signed-out visitor is a normal state, not an error.
 */
export async function fetchSession(): Promise<SessionUser | null> {
  try {
    return await apiJson<SessionUser>('/api/auth/me');
  } catch {
    return null;
  }
}

export function roleLabel(role: UserRole): string {
  return { admin: 'Administrator', owner: 'Owner', analyst: 'Analyst', viewer: 'Viewer' }[role];
}

export function initialsOf(user: Pick<SessionUser, 'name' | 'email'>): string {
  const source = user.name.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Days until the subscription lapses, or null when there is no expiry. */
export function daysUntilExpiry(client: SessionClient | null, now = new Date()): number | null {
  if (!client?.subscriptionExpiresAt) return null;
  const expires = new Date(client.subscriptionExpiresAt);
  if (Number.isNaN(expires.getTime())) return null;
  return Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
}
