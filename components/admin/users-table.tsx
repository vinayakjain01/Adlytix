'use client';

import { useMemo, useState } from 'react';
import {
  KeyRound, LogOut, Pencil, Search, ShieldCheck, UserCheck, UserX,
} from 'lucide-react';
import { BUTTON_GHOST, FIELD_CLASS } from '@/components/ui/form-field';
import { accessNote, ROLES, type AdminUser } from '@/lib/admin';
import type { UserStatus } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface UsersTableProps {
  users: AdminUser[];
  currentUserId: string | null;
  onEdit: (user: AdminUser) => void;
  onSetPassword: (user: AdminUser) => void;
  onToggleSuspend: (user: AdminUser) => void;
  onRevokeSessions: (user: AdminUser) => void;
  busyId: string | null;
}

const STATUS_STYLE: Record<UserStatus, string> = {
  active: 'bg-ok-tint text-ok',
  invited: 'bg-warn-tint text-warn',
  suspended: 'bg-bad-tint text-bad-soft',
  expired: 'bg-bad-tint text-bad-soft',
};

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

export function UsersTable({
  users, currentUserId, onEdit, onSetPassword, onToggleSuspend, onRevokeSessions, busyId,
}: UsersTableProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) =>
        user.email.toLowerCase().includes(term) ||
        user.name.toLowerCase().includes(term) ||
        (user.client?.name ?? '').toLowerCase().includes(term),
    );
  }, [users, query]);

  const blocked = users.filter((user) => accessNote(user) !== null).length;

  return (
    <section className="rounded-card border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[14.5px] font-semibold text-ink">Accounts</h2>
          <span className="text-[12px] text-ink-faint">
            {users.length}
            {blocked > 0 && <> · {blocked} cannot sign in</>}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email, name or client"
            aria-label="Search accounts"
            className={cn(FIELD_CLASS, 'h-9 w-[260px] pl-9 text-[13px]')}
          />
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead>
            <tr className="border-b border-line-subtle text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint">
              <th className="px-5 py-2.5">ACCOUNT</th>
              <th className="px-3 py-2.5">CLIENT</th>
              <th className="px-3 py-2.5">ROLE</th>
              <th className="px-3 py-2.5">STATUS</th>
              <th className="px-3 py-2.5">LAST SIGN-IN</th>
              <th className="px-5 py-2.5 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-[13px] text-ink-tertiary">
                  {users.length === 0
                    ? 'No accounts yet.'
                    : `No account matches “${query.trim()}”.`}
                </td>
              </tr>
            )}

            {filtered.map((user) => {
              const isSelf = user.id === currentUserId;
              const note = accessNote(user);
              const busy = busyId === user.id;
              const suspended = user.status === 'suspended';
              // An expired subscription is a client-level problem; toggling the
              // user's status would not fix it, so the control is disabled and
              // the note points at the real cause.
              const expired = user.status === 'expired';

              return (
                <tr
                  key={user.id}
                  className={cn(
                    'border-b border-line-subtle/60 text-[13px] transition-colors last:border-0',
                    busy ? 'opacity-50' : 'hover:bg-panel-raised/40',
                  )}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-ink">{user.email}</span>
                      {user.isPlatformAdmin && (
                        <span title="Platform administrator" className="inline-flex">
                          <ShieldCheck className="h-3.5 w-3.5 text-brand-300" aria-label="Platform administrator" />
                        </span>
                      )}
                      {isSelf && (
                        <span className="rounded-chip bg-brand-tint px-1.5 py-0.5 text-[10.5px] font-medium text-brand-100">
                          you
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-faint">
                      {user.name || 'No name'} · added {relative(user.createdAt)}
                    </p>
                  </td>

                  <td className="px-3 py-3 text-ink-body">
                    {user.client ? user.client.name : <span className="text-ink-faint">Platform</span>}
                  </td>

                  <td className="px-3 py-3 text-ink-body">
                    {ROLES.find((r) => r.value === user.role)?.label ?? user.role}
                  </td>

                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        'rounded-chip px-2 py-0.5 text-[11.5px] font-medium capitalize',
                        STATUS_STYLE[user.status as UserStatus],
                      )}
                    >
                      {user.status}
                    </span>
                    {note && <p className="mt-1 max-w-[190px] text-[11.5px] leading-snug text-ink-faint">{note}</p>}
                  </td>

                  <td className="px-3 py-3 text-ink-muted">{relative(user.lastLoginAt)}</td>

                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(user)}
                        disabled={busy}
                        title="Edit account"
                        aria-label={`Edit ${user.email}`}
                        className={cn(BUTTON_GHOST, 'h-8 px-2.5')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetPassword(user)}
                        disabled={busy}
                        title="Set a new password"
                        aria-label={`Set password for ${user.email}`}
                        className={cn(BUTTON_GHOST, 'h-8 px-2.5')}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRevokeSessions(user)}
                        disabled={busy}
                        title="Sign out of all devices"
                        aria-label={`Sign ${user.email} out everywhere`}
                        className={cn(BUTTON_GHOST, 'h-8 px-2.5')}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleSuspend(user)}
                        disabled={busy || isSelf || expired}
                        title={
                          isSelf
                            ? 'You cannot suspend your own account'
                            : expired
                              ? 'Extend the client subscription instead'
                              : suspended
                                ? 'Restore access'
                                : 'Suspend'
                        }
                        aria-label={`${suspended ? 'Restore' : 'Suspend'} ${user.email}`}
                        className={cn(
                          BUTTON_GHOST,
                          'h-8 px-2.5',
                          suspended ? 'text-ok' : 'text-bad-soft',
                        )}
                      >
                        {suspended ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
