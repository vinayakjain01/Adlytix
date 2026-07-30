import { apiFetch, apiJson, postJson } from './http';
import type { SessionUser, UserRole, UserStatus } from './auth';

/**
 * The admin API — clients and user accounts.
 *
 * Mirrors backend/auth.py exactly. Everything here requires a platform admin
 * session; the API enforces that, and the screen only hides what would fail.
 */

/** Stored status. `expired` is derived by the API and never sent back to it. */
export type SettableStatus = 'active' | 'invited' | 'suspended';

export const ROLES: { value: UserRole; label: string; blurb: string }[] = [
  { value: 'admin', label: 'Administrator', blurb: 'Your team. Manages clients and accounts, belongs to no client.' },
  { value: 'owner', label: 'Owner', blurb: "Full access to their client's data." },
  { value: 'analyst', label: 'Analyst', blurb: 'Uploads, merges and analyses.' },
  { value: 'viewer', label: 'Viewer', blurb: 'Reads dashboards only.' },
];

export const STATUSES: { value: SettableStatus; label: string; blurb: string }[] = [
  { value: 'active', label: 'Active', blurb: 'Can sign in now.' },
  { value: 'invited', label: 'Invited', blurb: 'Created but not yet allowed in.' },
  { value: 'suspended', label: 'Suspended', blurb: 'Blocked, and signed out immediately.' },
];

export interface AdminClient {
  id: string;
  name: string;
  subscriptionExpiresAt: string | null;
  subscriptionActive: boolean;
  userCount: number;
  createdAt: string;
}

export interface AdminUser extends SessionUser {
  createdAt: string;
  mustChangePassword: boolean;
}

export interface UserDraft {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  status: SettableStatus;
  clientId: string | null;
}

/** Only the keys present are changed — see the PATCH semantics in auth.py. */
export interface UserPatch {
  name?: string;
  role?: UserRole;
  status?: SettableStatus;
  clientId?: string | null;
}

export interface ClientPatch {
  name?: string;
  /** Explicit null clears the expiry, meaning perpetual access. */
  subscriptionExpiresAt?: string | null;
}

export const PASSWORD_MIN_LENGTH = 12;

export function listUsers() {
  return apiJson<AdminUser[]>('/api/auth/users');
}

export function listClients() {
  return apiJson<AdminClient[]>('/api/auth/clients');
}

export function createUser(draft: UserDraft) {
  return postJson<AdminUser>('/api/auth/users', {
    email: draft.email.trim(),
    password: draft.password,
    name: draft.name.trim(),
    role: draft.role,
    status: draft.status,
    // Admins are platform-level; sending a client for one is rejected.
    clientId: draft.role === 'admin' ? null : draft.clientId,
  });
}

export function updateUser(id: string, patch: UserPatch) {
  return patchJson<AdminUser>(`/api/auth/users/${id}`, patch);
}

export function setUserPassword(id: string, password: string) {
  return apiFetch(`/api/auth/users/${id}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export function revokeUserSessions(id: string) {
  return apiFetch(`/api/auth/users/${id}/revoke-sessions`, { method: 'POST' });
}

export function createClient(name: string, subscriptionExpiresAt: string | null) {
  return postJson<AdminClient>('/api/auth/clients', { name: name.trim(), subscriptionExpiresAt });
}

export function updateClient(id: string, patch: ClientPatch) {
  return patchJson<AdminClient>(`/api/auth/clients/${id}`, patch);
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Why an account cannot sign in, or null when it can.
 *
 * Duplicates no logic: the API already returns the derived status, including
 * `expired`. This only turns it into a sentence.
 */
export function accessNote(user: AdminUser): string | null {
  switch (user.status as UserStatus) {
    case 'suspended':
      return 'Suspended — cannot sign in.';
    case 'invited':
      return 'Not activated yet — cannot sign in.';
    case 'expired':
      return `Subscription lapsed${user.client ? ` for ${user.client.name}` : ''} — cannot sign in.`;
    default:
      return null;
  }
}

/** Days until a client's subscription lapses; null when there is no expiry. */
export function daysUntilExpiry(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}
