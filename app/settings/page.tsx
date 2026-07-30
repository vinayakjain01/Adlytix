'use client';

import { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { BUTTON_DANGER, BUTTON_GHOST } from '@/components/ui/form-field';
import { useApp } from '@/lib/context';
import { useAuth } from '@/lib/auth-context';
import { CURRENCIES, displayFactor, rateAge, rateSentence } from '@/lib/currency';
import { roleLabel } from '@/lib/auth';
import { daysUntilExpiry } from '@/lib/admin';
import { analyticsEnabled } from '@/lib/analytics/client';
import { cn } from '@/lib/utils';

/**
 * Display preferences and session state.
 *
 * Everything here is presentation or account-level. No control on this screen
 * changes stored data or any calculation — the currency cards only decide what
 * figures are rendered in, which is stated plainly because it is the question
 * operators ask first.
 */
export default function SettingsPage() {
  const {
    currency, setCurrency, baseCurrency, rates, ratesError, refreshRates,
  } = useApp();
  const { user, signOutEverywhere } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const expiresInDays = daysUntilExpiry(user?.client?.subscriptionExpiresAt ?? null);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Settings</h1>
          <p className="text-[14px] text-ink-secondary">
            Display preferences for this workspace. Stored data and calculations are never altered.
          </p>
        </header>

        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          {/* ── Display currency ─────────────────────────────────────── */}
          <section className="rounded-card border border-line bg-panel px-6 py-5">
            <h2 className="mb-1.5 text-[15px] font-semibold text-ink">Display currency</h2>
            <p className="mb-5 max-w-xl text-[13px] leading-relaxed text-ink-tertiary">
              Every figure on screen converts at the rate below. The merge is stored in{' '}
              {baseCurrency} and the underlying data stays exactly as uploaded.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CURRENCIES.map((option) => {
                const isBase = option.code === baseCurrency;
                const isActive = option.code === currency;
                const factor = displayFactor(baseCurrency, option.code, rates);
                const unavailable = !isBase && factor === null;
                const sentence = isBase ? null : rateSentence(option.code, baseCurrency, rates);

                return (
                  <button
                    key={option.code}
                    type="button"
                    disabled={unavailable}
                    onClick={() => setCurrency(option.code)}
                    aria-pressed={isActive}
                    className={cn(
                      'rounded-panel border px-4 py-3.5 text-left transition-colors',
                      isActive
                        ? 'border-brand/40 bg-brand-tint'
                        : unavailable
                          ? 'cursor-not-allowed border-line-subtle bg-panel-sunken opacity-60'
                          : 'border-line bg-panel-sunken hover:border-line-hover',
                    )}
                  >
                    <span className="mb-2 flex items-center justify-between">
                      <span
                        className={cn(
                          'font-mono text-[15px]',
                          isActive ? 'text-brand-200' : 'text-ink-tertiary',
                        )}
                      >
                        {option.symbol}
                      </span>
                      {isActive && <Check className="h-3.5 w-3.5 text-brand" />}
                    </span>
                    <span className="block text-[14px] font-medium text-ink">{option.code}</span>
                    <span className="block text-[12px] text-ink-muted">{option.label}</span>
                    <span className="mt-2 block font-mono text-[11.5px] text-ink-faint">
                      {isBase ? 'base currency' : (sentence ?? 'rate unavailable')}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line-subtle bg-panel-sunken px-4 py-3">
              <div>
                <p className="text-[13px] text-ink-body">
                  {currency === baseCurrency
                    ? `Showing ${baseCurrency}, the currency of this merge`
                    : (rateSentence(currency, baseCurrency, rates) ??
                       `No rate available — still showing ${baseCurrency}`)}
                </p>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  {ratesError
                    ? ratesError
                    : rates
                      ? `${rates.provider} · refreshed ${rateAge(rates.fetchedAt)}`
                      : 'Loading rates…'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRefreshing(true);
                  void refreshRates(true).finally(() => setRefreshing(false));
                }}
                disabled={refreshing}
                className={cn(BUTTON_GHOST, 'h-9')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </section>

          <div className="space-y-4">
            {/* ── Session ───────────────────────────────────────────── */}
            <section className="rounded-card border border-line bg-panel px-6 py-5">
              <h2 className="mb-4 text-[15px] font-semibold text-ink">Session</h2>

              <dl className="space-y-3 text-[13px]">
                <Row label="Signed in as" value={user?.email ?? '—'} />
                <Row label="Role" value={user ? roleLabel(user.role) : '—'} />
                <Row label="Workspace" value={user?.client?.name ?? 'Platform'} />
                <Row
                  label="Subscription"
                  value={
                    user?.client?.subscriptionExpiresAt
                      ? expiresInDays !== null && expiresInDays >= 0
                        ? `Active · renews ${new Date(user.client.subscriptionExpiresAt).toLocaleDateString()}`
                        : 'Lapsed'
                      : user?.client
                        ? 'No expiry'
                        : 'Not applicable'
                  }
                  tone={
                    user?.client?.subscriptionExpiresAt && expiresInDays !== null && expiresInDays < 0
                      ? 'bad'
                      : user?.client
                        ? 'ok'
                        : 'muted'
                  }
                />
                <Row
                  label="Last sign-in"
                  value={user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'This session'}
                />
              </dl>

              <button
                type="button"
                onClick={() => {
                  setSigningOut(true);
                  void signOutEverywhere().finally(() => setSigningOut(false));
                }}
                disabled={signingOut}
                className={cn(BUTTON_DANGER, 'mt-5 w-full')}
              >
                {signingOut ? 'Signing out…' : 'Sign out of all devices'}
              </button>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                Ends every session for this account, including this one.
              </p>
            </section>

            {/* ── Product analytics ─────────────────────────────────── */}
            <section className="rounded-card border border-line bg-panel px-6 py-5">
              <h2 className="mb-1.5 text-[15px] font-semibold text-ink">Product analytics</h2>
              <p className="mb-4 text-[12.5px] leading-relaxed text-ink-tertiary">
                {analyticsEnabled
                  ? 'Usage events are collected in the background to improve the product. Counts and durations only — never your spend, revenue, product names or search terms.'
                  : 'Disabled. No analytics key is configured, so nothing is collected and the SDK is never even downloaded.'}
              </p>

              <ul className="flex flex-wrap gap-1.5">
                {TRACKED_EVENTS.map((event) => (
                  <li
                    key={event}
                    className="rounded-chip border border-line-subtle bg-panel-sunken px-2 py-1 font-mono text-[11px] text-ink-muted"
                  >
                    {event}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, tone = 'default' }: {
  label: string;
  value: string;
  tone?: 'default' | 'ok' | 'bad' | 'muted';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex-shrink-0 text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'text-right',
          tone === 'ok' && 'text-ok',
          tone === 'bad' && 'text-bad',
          tone === 'muted' && 'text-ink-faint',
          tone === 'default' && 'text-ink-body',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The event names actually emitted, taken from the analytics contract.
 *
 * Deliberately the real names rather than the shorter ones the design mocks up
 * (`merge_run`, `export_csv`, …) — a settings screen listing events the product
 * does not send would be inventing its own documentation.
 */
const TRACKED_EVENTS = [
  'page_viewed',
  'page_time_spent',
  'login_succeeded',
  'logout',
  'upload_started',
  'upload_completed',
  'merge_started',
  'merge_completed',
  'filters_applied',
  'product_searched',
  'csv_downloaded',
  'display_currency_changed',
  'ai_analysis_requested',
  'ai_analysis_completed',
  'app_error',
] as const;
