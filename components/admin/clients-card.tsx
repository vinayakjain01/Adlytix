'use client';

import { useState } from 'react';
import { Building2, CalendarClock, Check, Plus, X } from 'lucide-react';
import {
  BUTTON_GHOST, BUTTON_PRIMARY, FIELD_CLASS, FormError,
} from '@/components/ui/form-field';
import { daysUntilExpiry, type AdminClient, type ClientPatch } from '@/lib/admin';
import { cn } from '@/lib/utils';

interface ClientsCardProps {
  clients: AdminClient[];
  onCreate: (name: string, expiresAt: string | null) => Promise<void>;
  onUpdate: (id: string, patch: ClientPatch) => Promise<void>;
}

/** `<input type="date">` needs YYYY-MM-DD; the API speaks ISO timestamps. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * An empty date field means "no expiry", which the API stores as null and reads
 * as perpetual access. End of day is used so the last day is inclusive — an
 * expiry of the 30th should not lock the account at midnight on the 30th.
 */
function fromDateInput(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function ExpiryBadge({ client }: { client: AdminClient }) {
  const days = daysUntilExpiry(client.subscriptionExpiresAt);

  if (days === null) {
    return <span className="text-[12px] text-ink-faint">No expiry</span>;
  }
  if (!client.subscriptionActive) {
    return (
      <span className="rounded-chip bg-bad-tint px-2 py-0.5 text-[11.5px] font-medium text-bad-soft">
        Lapsed {Math.abs(days)}d ago
      </span>
    );
  }
  // Inside a month is worth flagging: it is the window in which an admin still
  // has time to renew before users start being locked out.
  const soon = days <= 30;
  return (
    <span
      className={cn(
        'rounded-chip px-2 py-0.5 text-[11.5px] font-medium',
        soon ? 'bg-warn-tint text-warn' : 'text-ink-muted',
      )}
    >
      {days}d left
    </span>
  );
}

export function ClientsCard({ clients, onCreate, onUpdate }: ClientsCardProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editExpiry, setEditExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(newName, fromDateInput(newExpiry));
      setNewName('');
      setNewExpiry('');
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that client.');
    } finally {
      setBusy(false);
    }
  }

  async function saveExpiry(client: AdminClient) {
    setBusy(true);
    setError(null);
    try {
      await onUpdate(client.id, { subscriptionExpiresAt: fromDateInput(editExpiry) });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the subscription.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Building2 className="h-4 w-4 text-ink-faint" />
          <h2 className="text-[14.5px] font-semibold text-ink">Clients</h2>
          <span className="text-[12px] text-ink-faint">{clients.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className={cn(BUTTON_GHOST, 'h-8')}
        >
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {adding ? 'Cancel' : 'Add client'}
        </button>
      </header>

      <div className="px-5 py-4">
        {error && <FormError message={error} />}

        {adding && (
          <div className="mb-4 rounded-panel border border-line-subtle bg-panel-sunken p-3.5 animate-fade-up">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] flex-1">
                <label htmlFor="client-name" className="mb-1.5 block text-[12px] font-medium text-ink-secondary">
                  Client name
                </label>
                <input
                  id="client-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && create()}
                  placeholder="Acme Commerce"
                  className={cn(FIELD_CLASS, 'h-9 text-[13px]')}
                />
              </div>
              <div>
                <label htmlFor="client-expiry" className="mb-1.5 block text-[12px] font-medium text-ink-secondary">
                  Subscription until
                </label>
                <input
                  id="client-expiry"
                  type="date"
                  value={newExpiry}
                  onChange={(event) => setNewExpiry(event.target.value)}
                  className={cn(FIELD_CLASS, 'h-9 w-[170px] text-[13px]')}
                />
              </div>
              <button
                type="button"
                onClick={create}
                disabled={!newName.trim() || busy}
                className={BUTTON_PRIMARY}
              >
                Create
              </button>
            </div>
            <p className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
              Leave the date empty for no expiry. Once it passes, every user under this client is
              blocked from signing in until you extend it.
            </p>
          </div>
        )}

        {clients.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-tertiary">
            No clients yet. Add one before creating accounts — every non-admin user belongs to a
            client.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {clients.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-ink">{client.name}</p>
                  <p className="text-[12px] text-ink-faint">
                    {client.userCount} {client.userCount === 1 ? 'user' : 'users'}
                    {client.subscriptionExpiresAt && (
                      <> · until {new Date(client.subscriptionExpiresAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>

                {editingId === client.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={editExpiry}
                      onChange={(event) => setEditExpiry(event.target.value)}
                      aria-label={`Subscription expiry for ${client.name}`}
                      className={cn(FIELD_CLASS, 'h-8 w-[160px] text-[13px]')}
                    />
                    <button
                      type="button"
                      onClick={() => saveExpiry(client)}
                      disabled={busy}
                      aria-label="Save subscription date"
                      className={cn(BUTTON_PRIMARY, 'h-8 px-2.5')}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel"
                      className={cn(BUTTON_GHOST, 'h-8 px-2.5')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <ExpiryBadge client={client} />
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(client.id);
                        setEditExpiry(toDateInput(client.subscriptionExpiresAt));
                      }}
                      className={cn(BUTTON_GHOST, 'h-8')}
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Subscription
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
