'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { LogoMark } from '@/components/layout/logo-mark';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/http';
import { BRAND } from '@/lib/nav';
import { FIELD_CLASS } from '@/components/ui/form-field';
import { cn } from '@/lib/utils';

const HIGHLIGHTS = [
  { value: '3 sources', caption: 'merged automatically' },
  { value: '4C model', caption: 'scale, protect, decide, cut' },
  { value: 'Per product', caption: 'not per campaign' },
];

export function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [view, setView] = useState<'signin' | 'help'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;

      if (!email.trim() || !password) {
        setError('Enter your email and password to continue.');
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        await signIn(email.trim(), password, remember);
        router.replace('/overview');
      } catch (err) {
        // The API returns the specific reason for a blocked account (suspended,
        // not activated, subscription expired) and a deliberately generic
        // message for bad credentials.
        setError(
          err instanceof ApiError ? err.message : 'Could not sign in. Please try again.',
        );
        setSubmitting(false);
      }
    },
    [email, password, remember, signIn, submitting, router],
  );

  return (
    <div className="adlytix grid min-h-screen bg-page font-sans text-ink antialiased lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden border-r border-line-subtle bg-[radial-gradient(120%_90%_at_8%_0%,#1B2547_0%,#0D1220_55%,#0B0F1A_100%)] px-16 py-14 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-36 -top-32 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgb(91_124_255_/_0.20),transparent_65%)] blur-2xl animate-glow" />
        <div className="pointer-events-none absolute -bottom-24 -right-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgb(168_85_247_/_0.16),transparent_65%)] blur-2xl animate-glow" />

        <div className="relative flex items-center gap-3">
          <LogoMark size={34} />
          <span className="text-[19px] font-semibold tracking-[-0.02em]">{BRAND}</span>
        </div>

        <div className="relative max-w-[520px]">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-line-strong bg-panel/70 px-3 py-1.5 text-[12px] text-ink-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse-dot" />
            Unified performance intelligence
          </span>

          <h1 className="mb-4 text-[46px] font-semibold leading-[1.06] tracking-[-0.035em]">
            Every ad rupee,
            <br />
            measured against
            <br />
            every product sold.
          </h1>

          <p className="max-w-[430px] text-[15px] leading-relaxed text-ink-secondary">
            Meta, Shopify and Google exports merge into one product-level view — cleaned,
            normalised and classified in seconds.
          </p>

          <dl className="mt-10 flex gap-10">
            {HIGHLIGHTS.map((item) => (
              <div key={item.value}>
                <dt className="text-[24px] font-semibold tracking-[-0.02em]">{item.value}</dt>
                <dd className="mt-1 text-[12px] text-ink-muted">{item.caption}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-[12px] text-ink-faint">
          Invite-only workspace · managed by your account team
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-[380px] animate-fade-up">
          {/* Brand shown here too, since the left panel is hidden on small screens. */}
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <LogoMark size={30} />
            <span className="text-[17px] font-semibold tracking-[-0.02em]">{BRAND}</span>
          </div>

          {view === 'signin' ? (
            <form onSubmit={submit} noValidate>
              <h2 className="mb-2 text-[26px] font-semibold tracking-[-0.025em]">Welcome back</h2>
              <p className="mb-8 text-[14px] text-ink-secondary">Sign in to your workspace.</p>

              <label htmlFor="email" className="mb-2 block text-[12px] font-medium text-ink-secondary">
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
                placeholder="you@company.com"
                className={FIELD_CLASS}
              />

              <div className="mb-2 mt-5 flex items-baseline justify-between">
                <label htmlFor="password" className="text-[12px] font-medium text-ink-secondary">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setView('help');
                    setError(null);
                  }}
                  className="text-[12px] text-brand-300 transition-colors hover:text-brand-100"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                placeholder="••••••••••"
                className={FIELD_CLASS}
              />

              <button
                type="button"
                onClick={() => setRemember((value) => !value)}
                aria-pressed={remember}
                className="my-6 flex items-center gap-2.5 text-left"
              >
                <span
                  className={cn(
                    'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border transition-colors',
                    remember ? 'border-brand bg-brand' : 'border-line-strong',
                  )}
                >
                  {remember && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <span className="text-[13px] text-ink-secondary">
                  Keep me signed in for 30 days
                </span>
              </button>

              {error && (
                <div
                  role="alert"
                  className="mb-4 flex gap-2.5 rounded-control border border-bad-line bg-bad-tint px-3.5 py-3 text-[13px] leading-relaxed text-bad-soft animate-fade-in"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className={cn(
                  'flex h-[46px] w-full items-center justify-center gap-2.5 rounded-control',
                  'bg-brand-gradient text-[14px] font-medium text-white shadow-brand',
                  'transition-transform hover:-translate-y-px',
                  submitting && 'cursor-wait opacity-80',
                )}
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>

              <p className="mt-7 border-t border-line-subtle pt-5 text-[12px] leading-relaxed text-ink-muted">
                {BRAND} is invite-only. Accounts are created by your administrator — there is no
                public sign-up.
              </p>
            </form>
          ) : (
            /* Password help.
               Honest by design: there is no email provider wired up, so this
               does not claim to send a reset link. In an invite-only product
               where administrators create every account, administrator-issued
               resets are the correct flow rather than a limitation. */
            <div className="animate-fade-up">
              <h2 className="mb-2 text-[26px] font-semibold tracking-[-0.025em]">
                Password help
              </h2>
              <p className="mb-6 text-[14px] leading-relaxed text-ink-secondary">
                Password resets are issued by your administrator.
              </p>

              <div className="mb-6 rounded-control border border-line bg-panel px-4 py-4">
                <p className="mb-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-muted">
                  WHAT TO DO
                </p>
                <ol className="space-y-2 text-[13px] leading-relaxed text-ink-secondary">
                  <li>1. Contact the administrator who set up your workspace.</li>
                  <li>2. They will set a new password on your account.</li>
                  <li>3. Sign in with it, then change it from Settings.</li>
                </ol>
              </div>

              <p className="mb-6 text-[12.5px] leading-relaxed text-ink-muted">
                Because {BRAND} is invite-only, accounts are never created or recovered
                self-service — which also means a leaked email address cannot be used to
                trigger a reset.
              </p>

              <button
                type="button"
                onClick={() => setView('signin')}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-control border border-line text-[13px] text-ink-body transition-colors hover:border-line-hover hover:text-ink"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
