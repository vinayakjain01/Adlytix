'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import {
  BUTTON_GHOST, BUTTON_PRIMARY, Field, FIELD_CLASS, FormError,
} from '@/components/ui/form-field';
import {
  PASSWORD_MIN_LENGTH, ROLES, STATUSES,
  type AdminClient, type AdminUser, type SettableStatus, type UserDraft, type UserPatch,
} from '@/lib/admin';
import type { UserRole } from '@/lib/auth';

interface UserDialogProps {
  open: boolean;
  onClose: () => void;
  clients: AdminClient[];
  /** Null creates a new account; a user edits that account. */
  editing: AdminUser | null;
  /** True when `editing` is the signed-in administrator. */
  isSelf: boolean;
  onCreate: (draft: UserDraft) => Promise<void>;
  onUpdate: (id: string, patch: UserPatch) => Promise<void>;
}

/**
 * Create and edit share one dialog because they share every field but two:
  * a new account needs a password, and an existing one cannot change its email.
 * Splitting them would duplicate the role/client rules, which is exactly where
 * a divergence would be dangerous.
 */
export function UserDialog({
  open, onClose, clients, editing, isSelf, onCreate, onUpdate,
}: UserDialogProps) {
  const isEdit = editing !== null;

  // Initialised straight from the target account. The parent gives this
  // component a `key` that changes per dialog opening, so React remounts it and
  // these initial values are re-read — which is why no reset effect is needed.
  const [email, setEmail] = useState(editing?.email ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(editing?.name ?? '');
  const [role, setRole] = useState<UserRole>((editing?.role as UserRole) ?? 'viewer');
  const [status, setStatus] = useState<SettableStatus>(
    // `expired` is derived, never stored — an expired account is stored as
    // active, so that is what the control should show.
    editing && editing.status !== 'expired' ? (editing.status as SettableStatus) : 'active',
  );
  const [clientId, setClientId] = useState<string>(editing?.client?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdminRole = role === 'admin';

  const activeClients = useMemo(
    () => clients.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  const problems = useMemo(() => {
    const issues: Record<string, string> = {};
    if (!isEdit) {
      if (!email.trim()) issues.email = 'An email is required.';
      if (password.length > 0 && password.length < PASSWORD_MIN_LENGTH) {
        issues.password = `At least ${PASSWORD_MIN_LENGTH} characters.`;
      }
      if (!password) issues.password = `At least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (!isAdminRole && !clientId) issues.clientId = 'Choose the client this user belongs to.';
    return issues;
  }, [isEdit, email, password, isAdminRole, clientId]);

  const canSubmit = Object.keys(problems).length === 0 && !saving;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit && editing) {
        const patch: UserPatch = { name: name.trim() };
        // Role and status are omitted entirely for the signed-in admin: the API
        // refuses those changes, and sending them would surface a confusing
        // error on an otherwise valid name edit.
        if (!isSelf) {
          patch.role = role;
          patch.status = status;
          patch.clientId = isAdminRole ? null : clientId;
        }
        await onUpdate(editing.id, patch);
      } else {
        await onCreate({
          email, password, name, role, status,
          clientId: isAdminRole ? null : clientId,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this account.');
    } finally {
      setSaving(false);
    }
  }

  const roleMeta = ROLES.find((r) => r.value === role);
  const statusMeta = STATUSES.find((s) => s.value === status);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit account' : 'New account'}
      description={
        isEdit
          ? 'Changes take effect on this user’s next request — no sign-out needed.'
          : 'There is no self-signup. Accounts exist only because you create them here.'
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_GHOST}>
            Cancel
          </button>
          <button type="submit" form="user-dialog-form" disabled={!canSubmit} className={BUTTON_PRIMARY}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="user-dialog-form" onSubmit={submit} noValidate>
        {error && <FormError message={error} />}

        <Field
          label="Email"
          htmlFor="user-email"
          error={problems.email}
          hint={
            isEdit
              ? 'The email cannot be changed. Create a new account instead.'
              : 'Must be a real domain — .local and .test addresses cannot sign in.'
          }
        >
          <input
            id="user-email"
            type="email"
            autoComplete="off"
            value={email}
            disabled={isEdit}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="person@company.com"
            className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:text-ink-muted`}
          />
        </Field>

        <Field label="Name" htmlFor="user-name">
          <input
            id="user-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional"
            className={FIELD_CLASS}
          />
        </Field>

        {!isEdit && (
          <Field
            label="Password"
            htmlFor="user-password"
            error={problems.password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Share it with the user directly — there is no reset email yet.`}
          >
            <input
              id="user-password"
              type="text"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Set an initial password"
              className={FIELD_CLASS}
            />
          </Field>
        )}

        <Field label="Role" htmlFor="user-role" hint={isSelf ? 'You cannot change your own role.' : roleMeta?.blurb}>
          <select
            id="user-role"
            value={role}
            disabled={isSelf}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:text-ink-muted`}
          >
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Client"
          htmlFor="user-client"
          error={problems.clientId}
          hint={
            isAdminRole
              ? 'Administrators are platform-level and belong to no client.'
              : 'This account can only ever see this client’s data.'
          }
        >
          <select
            id="user-client"
            value={isAdminRole ? '' : clientId}
            disabled={isAdminRole || isSelf}
            onChange={(event) => setClientId(event.target.value)}
            className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:text-ink-muted`}
          >
            <option value="">{isAdminRole ? 'Not applicable' : 'Choose a client…'}</option>
            {activeClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
                {client.subscriptionActive ? '' : ' — subscription lapsed'}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Status"
          htmlFor="user-status"
          className="mb-0"
          hint={isSelf ? 'You cannot change your own status.' : statusMeta?.blurb}
        >
          <select
            id="user-status"
            value={status}
            disabled={isSelf}
            onChange={(event) => setStatus(event.target.value as SettableStatus)}
            className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:text-ink-muted`}
          >
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
