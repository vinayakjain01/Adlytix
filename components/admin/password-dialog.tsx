'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import {
  BUTTON_GHOST, BUTTON_PRIMARY, Field, FIELD_CLASS, FormError,
} from '@/components/ui/form-field';
import { PASSWORD_MIN_LENGTH, type AdminUser } from '@/lib/admin';

interface PasswordDialogProps {
  user: AdminUser | null;
  onClose: () => void;
  onSubmit: (id: string, password: string) => Promise<void>;
}

export function PasswordDialog({ user, onClose, onSubmit }: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const canSubmit = password.length >= PASSWORD_MIN_LENGTH && !saving;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(user.id, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Set a new password"
      description={
        user
          ? `${user.email} will be signed out of every device, and the old password stops working.`
          : undefined
      }
      className="max-w-[460px]"
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_GHOST}>
            Cancel
          </button>
          <button type="submit" form="password-form" disabled={!canSubmit} className={BUTTON_PRIMARY}>
            {saving ? 'Setting…' : 'Set password'}
          </button>
        </>
      }
    >
      <form id="password-form" onSubmit={submit} noValidate>
        {error && <FormError message={error} />}
        <Field
          label="New password"
          htmlFor="new-password"
          className="mb-0"
          error={tooShort ? `At least ${PASSWORD_MIN_LENGTH} characters.` : null}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Shown as plain text so you can copy it — there is no reset email yet.`}
        >
          <input
            id="new-password"
            type="text"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </form>
    </Modal>
  );
}
