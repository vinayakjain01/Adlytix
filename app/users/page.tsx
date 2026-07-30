'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, ShieldAlert } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { ClientsCard } from '@/components/admin/clients-card';
import { UsersTable } from '@/components/admin/users-table';
import { UserDialog } from '@/components/admin/user-dialog';
import { PasswordDialog } from '@/components/admin/password-dialog';
import { BUTTON_PRIMARY, FormError } from '@/components/ui/form-field';
import { useAuth } from '@/lib/auth-context';
import { track } from '@/lib/analytics/client';
import {
  createClient, createUser, listClients, listUsers, revokeUserSessions, setUserPassword,
  updateClient, updateUser,
  type AdminClient, type AdminUser, type ClientPatch, type UserDraft, type UserPatch,
} from '@/lib/admin';

export default function UsersPage() {
  const { user: signedIn, status: authStatus } = useAuth();
  const isAdmin = signedIn?.isPlatformAdmin === true;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [passwordFor, setPasswordFor] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      // Both lists are needed together: a user row shows its client's name, and
      // the create form cannot offer a client it has not loaded.
      const [nextUsers, nextClients] = await Promise.all([listUsers(), listClients()]);
      setUsers(nextUsers);
      setClients(nextClients);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load accounts.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Non-admins are never given data to load, so there is nothing to fetch and
    // nothing to flip — `loading` below derives that rather than setting state
    // from inside this effect.
    if (authStatus !== 'authenticated' || !isAdmin) return;
    // refresh() is async; its setState calls happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [authStatus, isAdmin, refresh]);

  const loading = isAdmin && authStatus === 'authenticated' && !loaded;

  // ── Mutations ───────────────────────────────────────────────────────────
  const handleCreate = useCallback(
    async (draft: UserDraft) => {
      const created = await createUser(draft);
      track('admin_user_created', {
        role: draft.role,
        status: draft.status,
        has_client: created.client !== null,
      });
      toast.success(`${created.email} created`);
      await refresh();
    },
    [refresh],
  );

  const handleUpdate = useCallback(
    async (id: string, patch: UserPatch) => {
      const updated = await updateUser(id, patch);
      track('admin_user_updated', {
        changed: Object.keys(patch),
        role: updated.role,
        status: updated.status,
      });
      toast.success(`${updated.email} updated`);
      await refresh();
    },
    [refresh],
  );

  /**
   * Runs a row action with its own busy state and error surface.
   *
   * Every one of these can fail for a reason the administrator needs to read —
   * the last-administrator guard, for instance — so a silent failure is not an
   * option.
   */
  const runRowAction = useCallback(
    async (user: AdminUser, action: () => Promise<unknown>, success: string) => {
      setBusyId(user.id);
      try {
        await action();
        toast.success(success);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'That action failed.');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const handleToggleSuspend = useCallback(
    (user: AdminUser) => {
      const suspending = user.status !== 'suspended';
      return runRowAction(
        user,
        async () => {
          const updated = await updateUser(user.id, {
            status: suspending ? 'suspended' : 'active',
          });
          track('admin_user_updated', {
            changed: ['status'],
            role: updated.role,
            status: updated.status,
          });
        },
        suspending ? `${user.email} suspended and signed out` : `${user.email} restored`,
      );
    },
    [runRowAction],
  );

  const handleRevoke = useCallback(
    (user: AdminUser) =>
      runRowAction(
        user,
        async () => {
          await revokeUserSessions(user.id);
          track('admin_user_sessions_revoked', {});
        },
        `${user.email} signed out everywhere`,
      ),
    [runRowAction],
  );

  const handleSetPassword = useCallback(
    async (id: string, password: string) => {
      await setUserPassword(id, password);
      track('admin_user_password_set', { revoked_sessions: true });
      toast.success('Password set — that account is now signed out everywhere');
      await refresh();
    },
    [refresh],
  );

  const handleCreateClient = useCallback(
    async (name: string, expiresAt: string | null) => {
      const created = await createClient(name, expiresAt);
      track('admin_client_created', { has_expiry: expiresAt !== null });
      toast.success(`${created.name} added`);
      await refresh();
    },
    [refresh],
  );

  const handleUpdateClient = useCallback(
    async (id: string, patch: ClientPatch) => {
      const updated = await updateClient(id, patch);
      track('admin_client_updated', {
        changed: Object.keys(patch),
        has_expiry: updated.subscriptionExpiresAt !== null,
      });
      toast.success(
        updated.subscriptionActive
          ? `${updated.name} subscription updated`
          : `${updated.name} subscription has lapsed — its users cannot sign in`,
      );
      await refresh();
    },
    [refresh],
  );

  const openCreate = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((user: AdminUser) => {
    setEditing(user);
    setDialogOpen(true);
  }, []);

  const header = useMemo(
    () => (
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Users &amp; access</h1>
          <p className="max-w-2xl text-[14px] leading-relaxed text-ink-secondary">
            Accounts exist only because you create them here — there is no signup. Each account sees
            one client&rsquo;s data, and access stops the moment you suspend it or its subscription
            lapses.
          </p>
        </div>
        {isAdmin && (
          <button type="button" onClick={openCreate} className={BUTTON_PRIMARY}>
            <Plus className="h-3.5 w-3.5" />
            New account
          </button>
        )}
      </header>
    ),
    [isAdmin, openCreate],
  );

  // A non-admin reaching this route is refused rather than shown an empty
  // screen. The API refuses them too — this only avoids a pointless request.
  if (authStatus === 'authenticated' && !isAdmin) {
    return (
      <AppShell>
        <div className="animate-fade-up">
          {header}
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">Administrators only</p>
            <p className="mx-auto max-w-md text-[13.5px] leading-relaxed text-ink-tertiary">
              Your account does not manage users. Ask a platform administrator if you need access
              changed.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="animate-fade-up">
        {header}

        {loadError && <FormError message={loadError} />}

        {loading ? (
          <div className="space-y-4">
            <div className="h-[170px] animate-shimmer rounded-card bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]" />
            <div className="h-[320px] animate-shimmer rounded-card bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]" />
          </div>
        ) : (
          <div className="space-y-4">
            <ClientsCard
              clients={clients}
              onCreate={handleCreateClient}
              onUpdate={handleUpdateClient}
            />
            <UsersTable
              users={users}
              currentUserId={signedIn?.id ?? null}
              onEdit={openEdit}
              onSetPassword={setPasswordFor}
              onToggleSuspend={handleToggleSuspend}
              onRevokeSessions={handleRevoke}
              busyId={busyId}
            />
          </div>
        )}
      </div>

      <UserDialog
        key={`user-dialog-${editing?.id ?? 'new'}-${dialogOpen}`}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        clients={clients}
        editing={editing}
        isSelf={editing?.id === signedIn?.id}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />

      <PasswordDialog
        key={`password-dialog-${passwordFor?.id ?? 'none'}`}
        user={passwordFor}
        onClose={() => setPasswordFor(null)}
        onSubmit={handleSetPassword}
      />
    </AppShell>
  );
}
