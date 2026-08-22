'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  BarChart3, CheckCircle2, Loader2, Plug, RefreshCw, ShoppingBag, Megaphone, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { BUTTON_DANGER, BUTTON_GHOST, BUTTON_PRIMARY } from '@/components/ui/form-field';
import { DateRangeSelector } from '@/components/integrations/date-range-selector';
import { ModeToggle } from '@/components/integrations/mode-toggle';
import { SyncProgress } from '@/components/integrations/sync-progress';
import { useAuth } from '@/lib/auth-context';
import { useApp, type IncomingRow } from '@/lib/context';
import { CURRENCIES, type CurrencyCode } from '@/lib/currency';
import {
  disconnectIntegration, getAnalyticsSources, getIntegrationAnalysis, getUnifiedOverview,
  listIntegrations, listMetaAccounts, metaConnectHref, selectMetaAccount, shopifyConnectHref,
  triggerMetaSync, triggerShopifySync,
  type IntegrationStatusInfo, type MetaAdAccount, type SyncJobInfo, type UnifiedOverview,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Connect/manage Shopify and Meta, and see synced-data performance at a
 * glance. Google and TikTok are shown as not-yet-available rather than
 * omitted, so the roadmap is visible without a link that 404s.
 *
 * "Connected" means the credential is stored and valid; synced data (and
 * the performance summary below the grid) only appears after a Sync now.
 */
export default function IntegrationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [integrations, setIntegrations] = useState<IntegrationStatusInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shopInput, setShopInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metaAccounts, setMetaAccounts] = useState<MetaAdAccount[] | null>(null);
  const [metaAccountsError, setMetaAccountsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<'shopify' | 'meta' | null>(null);
  const [overview, setOverview] = useState<UnifiedOverview | null>(null);
  const [shopifyJobIds, setShopifyJobIds] = useState<string[] | null>(null);
  const [metaJobIds, setMetaJobIds] = useState<string[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeRangeDays, setActiveRangeDays] = useState(30);
  const currenciesPrefilled = useRef(false);

  const {
    baseCurrency, setBaseCurrency, sourceCurrencies, setSourceCurrency,
    setMergeCurrency, setMergedResult, mergedData, mergedSummary, mergeCurrency,
    warnings, aggregatedProducts, allMonths,
  } = useApp();

  const load = useCallback(async () => {
    try {
      const rows = await listIntegrations();
      setIntegrations(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load integrations.');
    }
  }, []);

  const loadMetaAccounts = useCallback(async () => {
    try {
      const accounts = await listMetaAccounts();
      setMetaAccounts(accounts);
      setMetaAccountsError(null);
    } catch (err) {
      setMetaAccountsError(err instanceof Error ? err.message : 'Could not load ad accounts.');
    }
  }, []);

  const [overviewRangeDays, setOverviewRangeDays] = useState(30);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Best-effort: an empty/absent overview just means nothing has synced
  // yet, which the card below renders as an empty state, not an error.
  const loadOverview = useCallback(async (days: number = 30) => {
    setOverviewLoading(true);
    try {
      const until = new Date();
      const since = new Date(until);
      since.setDate(since.getDate() - (days - 1));
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      setOverview(await getUnifiedOverview({ since: fmt(since), until: fmt(until) }));
    } catch {
      setOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const handleOverviewRangeChange = useCallback((days: number) => {
    setOverviewRangeDays(days);
    void loadOverview(days);
  }, [loadOverview]);

  // Pre-fills the currency step with each source's REAL detected currency
  // (the Shopify store's own currency, the Meta ad account's own currency)
  // rather than leaving whatever default sourceCurrencies started at — runs
  // once per page visit, same shared state the CSV-upload flow reads.
  useEffect(() => {
    if (currenciesPrefilled.current) return;
    currenciesPrefilled.current = true;
    (async () => {
      try {
        const detected = await getAnalyticsSources();
        if (detected.shopify) setSourceCurrency('shopify', detected.shopify as CurrencyCode);
        if (detected.meta) setSourceCurrency('meta', detected.meta as CurrencyCode);
      } catch {
        // No synced data yet — the defaults already in context are fine.
      }
    })();
  }, [setSourceCurrency]);

  /**
   * Integration-mode equivalent of useMerge()'s run(): same endpoint family,
   * same success handling (lifted from hooks/use-merge.ts so the numbers
   * behave identically), same setMergedResult call — the only difference is
   * where the rows come from. Always reads what's already synced to
   * Postgres; never re-fetches Shopify or Meta's own APIs.
   */
  const runAnalysis = useCallback(async (days: number) => {
    setActiveRangeDays(days);
    setAnalyzing(true);
    try {
      const until = new Date();
      const since = new Date(until);
      since.setDate(since.getDate() - (days - 1));
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const result = await getIntegrationAnalysis({
        since: fmt(since), until: fmt(until),
        base: baseCurrency, meta: sourceCurrencies.meta, shopify: sourceCurrencies.shopify,
      });

      setMergeCurrency(result.currency ?? null);
      const products = result.products ?? [];
      const summary = result.summary ?? {};
      const warns = result.warnings ?? [];

      const calcTotalSpend = products.reduce((s: number, p: IncomingRow) => s + Number(p['Total Spend'] ?? 0), 0);
      const calcTotalRev = products.reduce((s: number, p: IncomingRow) => s + Number(p['Shopify Revenue'] ?? 0), 0);
      const calcMetaSpend = products.reduce((s: number, p: IncomingRow) => s + Number(p['Meta Spend'] ?? 0), 0);

      setMergedResult(
        products,
        {
          products: summary.products ?? products.length,
          total_spend: summary.total_spend || calcTotalSpend,
          total_rev: summary.total_rev || calcTotalRev,
          roi: summary.roi || (calcTotalSpend > 0 ? calcTotalRev / calcTotalSpend : 0),
          meta_spend: summary.meta_spend || calcMetaSpend,
          google_cost: 0,
          lpv: summary.lpv ?? 0,
        },
        result.hasMonth ?? false,
        false,
        warns,
      );

      toast.success(`Analysis ready — ${products.length} products, ${days === 30 ? 'last 30 days' : days === 90 ? 'last 90 days' : 'last 6 months'}.`);
      router.push('/overview');
    } catch (err) {
      // No synced Shopify orders in range yet — a quiet no-op, not an error
      // toast, since this fires automatically right after a first sync.
      const message = err instanceof Error ? err.message : '';
      if (!message.toLowerCase().includes('no synced shopify orders')) {
        toast.error(message || 'Could not run analysis.');
      }
    } finally {
      setAnalyzing(false);
    }
  }, [baseCurrency, sourceCurrencies, setMergeCurrency, setMergedResult, router]);

  // Handles the redirect back from a provider's OAuth callback
  // (?integration=shopify&status=connected, etc.) and then scrubs the query
  // string so a page refresh doesn't re-show the toast.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await Promise.all([load(), loadOverview()]);
      if (cancelled) return;

      const params = new URLSearchParams(window.location.search);
      const provider = params.get('integration');
      const status = params.get('status');
      const message = params.get('message');
      if (!provider || !status) return;

      if (status === 'connected') {
        toast.success(`${providerLabel(provider)} connected.`);
      } else if (status === 'needs-account-selection') {
        toast.info(`${providerLabel(provider)} connected — choose an ad account below.`);
        await loadMetaAccounts();
      } else if (status === 'cancelled') {
        toast.info(`${providerLabel(provider)} connection cancelled.`);
      } else if (status === 'error') {
        toast.error(message || `${providerLabel(provider)} connection failed.`);
      }
      router.replace('/integrations');
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally runs once on mount — the query string is only ever
    // present on the redirect back from a provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = useCallback(async (row: IntegrationStatusInfo) => {
    setBusyId(row.id);
    try {
      await disconnectIntegration(row.id);
      toast.success(`${providerLabel(row.provider)} disconnected.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleSyncNow = useCallback(async (provider: 'shopify' | 'meta') => {
    setSyncing(provider);
    try {
      const { jobIds } = provider === 'shopify' ? await triggerShopifySync() : await triggerMetaSync();
      const what = provider === 'shopify' ? 'products and orders' : 'campaigns and spend';
      if (jobIds.length) {
        toast.success(`Sync started — ${what} are queued.`);
        if (provider === 'shopify') setShopifyJobIds(jobIds); else setMetaJobIds(jobIds);
      } else {
        toast.info('Nothing to sync.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start sync.');
    } finally {
      setSyncing(null);
    }
  }, []);

  // Requirement: once a sync finishes, automatically run Merge & Analyse and
  // land on Overview — no separate "now go analyze" step for the operator.
  // A partial failure (e.g. one job out of three) still analyses whatever
  // did land, consistent with "partial-failure handling" rather than
  // blocking the whole flow on one provider edge case.
  const handleSyncSettled = useCallback((jobs: SyncJobInfo[]) => {
    const failed = jobs.filter((j) => j.status === 'failed');
    if (failed.length === jobs.length) {
      toast.error('Sync failed — see the job status above.');
      return;
    }
    if (failed.length > 0) {
      toast.warning(`${failed.length} of ${jobs.length} sync jobs failed — analyzing the rest.`);
    }
    void runAnalysis(30);
  }, [runAnalysis]);

  const handleSelectAccount = useCallback(async (account: MetaAdAccount) => {
    setBusyId(account.id);
    try {
      await selectMetaAccount(account.id, account.name);
      toast.success(`Connected to ${account.name ?? account.id}.`);
      setMetaAccounts(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not select this account.');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  if (user && !user.client) {
    return (
      <AppShell>
        <EmptyNotice
          title="Integrations are workspace-scoped"
          body="Platform administrators aren't attached to a workspace. Sign in as a client-scoped account to connect Shopify or Meta."
        />
      </AppShell>
    );
  }

  const shopify = integrations?.find((i) => i.provider === 'shopify');
  const meta = integrations?.find((i) => i.provider === 'meta');
  const metaNeedsAccount = meta?.status === 'connected' && !meta.externalAccountId;

  return (
    <AppShell>
      <div className="animate-fade-up">
        <ModeToggle active="integration" />

        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Integrations</h1>
          <p className="text-[14px] text-ink-secondary">
            Connect Shopify and Meta Ads directly. Products, orders, campaigns and spend sync
            in the background once connected — see Sync now on each card.
          </p>
        </header>

        {loadError && (
          <div className="mb-4 flex items-center gap-2.5 rounded-card border border-bad-line bg-bad-tint px-5 py-3.5 text-[13px] text-bad-soft">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {loadError}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Shopify ─────────────────────────────────────────────── */}
          <section className="rounded-card border border-line bg-panel px-6 py-5">
            <CardHeader icon={ShoppingBag} name="Shopify" tone="brand" state={shopify?.status} />

            {shopify?.status === 'connected' ? (
              <ConnectedBody
                displayName={shopify.displayName}
                lastSyncAt={shopify.lastSyncAt}
                notSyncedHint="Not synced yet — click Sync now."
              />
            ) : shopify?.status === 'error' ? (
              <ErrorBody lastError={shopify.lastError} />
            ) : (
              <p className="mb-4 text-[12.5px] leading-relaxed text-ink-tertiary">
                Enter your store&apos;s domain to connect its Admin API — read access to
                products, orders and customers.
              </p>
            )}

            {shopify?.status === 'connected' ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleSyncNow('shopify')}
                  disabled={syncing !== null}
                  className={cn(BUTTON_PRIMARY, 'flex-1')}
                >
                  {syncing === 'shopify' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync now
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnect(shopify)}
                  disabled={busyId === shopify.id}
                  className={cn(BUTTON_DANGER, 'flex-shrink-0')}
                >
                  {busyId === shopify.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Disconnect
                </button>
              </div>
            ) : null}
            {shopifyJobIds && (
              <SyncProgress key={shopifyJobIds.join(',')} jobIds={shopifyJobIds} onSettled={handleSyncSettled} />
            )}
            {!shopify || shopify.status !== 'connected' ? (
              <div className="flex gap-2">
                <input
                  value={shopInput}
                  onChange={(e) => setShopInput(e.target.value)}
                  placeholder="your-store or your-store.myshopify.com"
                  aria-label="Shopify store domain"
                  className="h-9 min-w-0 flex-1 rounded-control border border-line bg-field px-3 text-[13px] text-ink-body placeholder:text-ink-faint focus:border-brand focus:outline-none"
                />
                <a
                  href={shopInput.trim() ? shopifyConnectHref(shopInput.trim()) : undefined}
                  aria-disabled={!shopInput.trim()}
                  className={cn(
                    BUTTON_PRIMARY,
                    !shopInput.trim() && 'pointer-events-none opacity-50',
                  )}
                >
                  {shopify?.status === 'error' || shopify?.status === 'disconnected' ? 'Reconnect' : 'Connect'}
                </a>
              </div>
            ) : null}
          </section>

          {/* ── Meta ────────────────────────────────────────────────── */}
          <section className="rounded-card border border-line bg-panel px-6 py-5">
            <CardHeader icon={Megaphone} name="Meta Ads" tone="brand" state={meta?.status} />

            {meta?.status === 'connected' && !metaNeedsAccount ? (
              <ConnectedBody
                displayName={meta.displayName}
                lastSyncAt={meta.lastSyncAt}
                notSyncedHint="Not synced yet — click Sync now."
              />
            ) : meta?.status === 'error' ? (
              <ErrorBody lastError={meta.lastError} />
            ) : !metaNeedsAccount ? (
              <p className="mb-4 text-[12.5px] leading-relaxed text-ink-tertiary">
                Connect a Meta Business account, then choose which ad account to report on.
              </p>
            ) : null}

            {metaNeedsAccount ? (
              <MetaAccountPicker
                accounts={metaAccounts}
                error={metaAccountsError}
                busyId={busyId}
                onRetry={() => void loadMetaAccounts()}
                onSelect={(a) => void handleSelectAccount(a)}
              />
            ) : meta?.status === 'connected' ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleSyncNow('meta')}
                  disabled={syncing !== null}
                  className={cn(BUTTON_PRIMARY, 'flex-1')}
                >
                  {syncing === 'meta' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync now
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnect(meta)}
                  disabled={busyId === meta.id}
                  className={cn(BUTTON_DANGER, 'flex-shrink-0')}
                >
                  {busyId === meta.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Disconnect
                </button>
              </div>
            ) : !metaNeedsAccount ? (
              <a href={metaConnectHref()} className={cn(BUTTON_PRIMARY, 'w-full')}>
                {meta?.status === 'error' || meta?.status === 'disconnected' ? 'Reconnect' : 'Connect Meta'}
              </a>
            ) : null}
            {metaJobIds && (
              <SyncProgress key={metaJobIds.join(',')} jobIds={metaJobIds} onSettled={handleSyncSettled} />
            )}
          </section>

          {/* ── Not yet available ──────────────────────────────────── */}
          <ComingSoonCard name="Google Ads" />
          <ComingSoonCard name="TikTok Ads" />
        </div>

        {shopify?.status === 'connected' && (
          <section className="mt-4 rounded-card border border-line bg-panel px-6 py-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand">
                <BarChart3 className="h-4 w-4" />
              </span>
              <h2 className="text-[15px] font-semibold text-ink">Analysis</h2>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <CurrencySelect
                label="Shopify amounts are in"
                value={sourceCurrencies.shopify}
                onChange={(c) => setSourceCurrency('shopify', c)}
              />
              <CurrencySelect
                label="Meta amounts are in"
                value={sourceCurrencies.meta}
                onChange={(c) => setSourceCurrency('meta', c)}
              />
              <CurrencySelect
                label="Analyze in"
                value={baseCurrency}
                onChange={setBaseCurrency}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <DateRangeSelector activeDays={activeRangeDays} loading={analyzing} onSelect={(d) => void runAnalysis(d)} />
              <button
                type="button"
                onClick={() => void runAnalysis(activeRangeDays)}
                disabled={analyzing}
                className={cn(BUTTON_GHOST, 'flex-shrink-0')}
              >
                {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                Analyze now
              </button>
            </div>

            {mergedData !== null && mergedSummary !== null && (
              <div className="mt-4 grid gap-4 border-t border-line-subtle pt-4 xl:grid-cols-2">
                <div className="rounded-panel border border-ok/25 bg-ok-tint px-5 py-4">
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-ok-tint text-ok">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="text-[13.5px] font-medium text-ink">Merge complete</h3>
                  </div>
                  <p className="text-[13px] leading-relaxed text-ink-secondary">
                    <strong className="font-medium text-ink">
                      {aggregatedProducts.length.toLocaleString('en-IN')} products
                    </strong>{' '}
                    across {allMonths.length || '—'} {allMonths.length === 1 ? 'month' : 'months'}. Totals:{' '}
                    <strong className="font-medium text-ink">
                      {(mergedSummary.total_spend ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </strong>{' '}
                    spend,{' '}
                    <strong className="font-medium text-ink">
                      {(mergedSummary.total_rev ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </strong>{' '}
                    revenue,{' '}
                    <strong className="font-medium text-ink">{(mergedSummary.roi ?? 0).toFixed(2)}x</strong> overall.
                  </p>
                  {mergeCurrency && (
                    <p className="mt-2.5 border-t border-ok/20 pt-2.5 text-[11.5px] text-ink-tertiary">
                      Reported in <span className="font-medium text-ink">{mergeCurrency.base}</span>
                      {mergeCurrency.converted ? ' · converted from each source’s own currency' : ' · no conversion needed'}
                    </p>
                  )}
                </div>

                {warnings.length > 0 && (
                  <div className="rounded-panel border border-warn/25 bg-warn-tint px-5 py-4">
                    <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-warn">WARNINGS</h3>
                    <ul className="space-y-2">
                      {warnings.map((warning, i) => (
                        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-body">
                          <span className="text-warn">·</span>
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {overview && (overview.hasShopifyData || overview.hasMetaData) && (
          <UnifiedPerformanceCard overview={overview} rangeDays={overviewRangeDays} onRangeChange={handleOverviewRangeChange} loading={overviewLoading} />
        )}
      </div>
    </AppShell>
  );
}

function providerLabel(provider: string): string {
  return { shopify: 'Shopify', meta: 'Meta', google: 'Google Ads', tiktok: 'TikTok Ads' }[provider] ?? provider;
}

function CardHeader({
  icon: Icon, name, state,
}: { icon: typeof ShoppingBag; name: string; tone: 'brand'; state?: IntegrationStatusInfo['status'] }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-[15px] font-semibold text-ink">{name}</h2>
      <span className="ml-auto">
        <StatusBadge state={state} />
      </span>
    </div>
  );
}

function StatusBadge({ state }: { state?: IntegrationStatusInfo['status'] }) {
  if (!state || state === 'available') return null;
  const map: Record<string, { label: string; className: string }> = {
    connected: { label: 'Connected', className: 'border-ok/30 bg-ok-tint text-ok-soft' },
    pending: { label: 'Pending', className: 'border-warn/30 bg-warn-tint text-warn' },
    error: { label: 'Error', className: 'border-bad-line bg-bad-tint text-bad-soft' },
    disconnected: { label: 'Disconnected', className: 'border-line-subtle bg-panel-sunken text-ink-faint' },
  };
  const entry = map[state];
  if (!entry) return null;
  return (
    <span className={cn('rounded-chip border px-2 py-0.5 text-[11px] font-medium', entry.className)}>
      {entry.label}
    </span>
  );
}

function ConnectedBody({
  displayName, lastSyncAt, notSyncedHint,
}: { displayName: string | null; lastSyncAt: string | null; notSyncedHint: string }) {
  return (
    <div className="mb-4 space-y-1.5 text-[13px]">
      <div className="flex items-center gap-2 text-ok">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="font-medium text-ink">{displayName ?? 'Connected'}</span>
      </div>
      <p className="text-[12px] text-ink-faint">
        {lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString()}` : notSyncedHint}
      </p>
    </div>
  );
}

function ErrorBody({ lastError }: { lastError: string | null }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-panel border border-bad-line bg-bad-tint px-3.5 py-3 text-[12.5px] text-bad-soft">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{lastError ?? 'Something went wrong with this connection.'}</span>
    </div>
  );
}

function MetaAccountPicker({
  accounts, error, busyId, onRetry, onSelect,
}: {
  accounts: MetaAdAccount[] | null;
  error: string | null;
  busyId: string | null;
  onRetry: () => void;
  onSelect: (account: MetaAdAccount) => void;
}) {
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBody lastError={error} />
        <button type="button" onClick={onRetry} className={cn(BUTTON_GHOST, 'w-full')}>
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }
  if (accounts === null) {
    return (
      <div className="mb-1 flex items-center gap-2 text-[13px] text-ink-tertiary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading ad accounts…
      </div>
    );
  }
  if (accounts.length === 0) {
    return <p className="text-[13px] text-ink-tertiary">No ad accounts found on this Meta business.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-ink-faint">Choose the ad account to report on:</p>
      <ul className="max-h-56 space-y-1.5 overflow-y-auto">
        {accounts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect(a)}
              disabled={busyId === a.id}
              className="flex w-full items-center justify-between gap-3 rounded-control border border-line-subtle bg-panel-sunken px-3.5 py-2.5 text-left text-[13px] text-ink-body transition-colors hover:border-line-hover disabled:opacity-50"
            >
              <span className="min-w-0 truncate">
                {a.name ?? a.id}
                {a.businessName ? <span className="ml-1.5 text-ink-faint">· {a.businessName}</span> : null}
              </span>
              {busyId === a.id ? <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComingSoonCard({ name }: { name: string }) {
  return (
    <section className="rounded-card border border-line-subtle bg-panel-sunken px-6 py-5 opacity-70">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-panel text-ink-faint">
          <Plug className="h-4 w-4" />
        </span>
        <h2 className="text-[15px] font-semibold text-ink-tertiary">{name}</h2>
        <span className="ml-auto rounded-chip border border-line-subtle bg-panel px-2 py-0.5 text-[11px] text-ink-faint">
          Coming soon
        </span>
      </div>
      <p className="text-[12.5px] text-ink-faint">Not available yet.</p>
    </section>
  );
}

/**
 * Deliberately not run through lib/formatters' inr()/currency system — that
 * reads the CSV-upload merge's chosen base currency and conversion rate,
 * which has nothing to do with what currency a connected Shopify store or
 * Meta ad account actually reports in. Showing a ₹/$ symbol here would
 * silently imply a conversion that was never performed. Plain numbers until
 * this endpoint returns each source's real currency and normalises across
 * them (needed once more than one store/account can be connected at once).
 */
function plainNumber(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function UnifiedPerformanceCard({
  overview, rangeDays, onRangeChange, loading,
}: { overview: UnifiedOverview; rangeDays: number; onRangeChange: (days: number) => void; loading: boolean }) {
  const { totals, hasShopifyData, hasMetaData } = overview;
  return (
    <section className="mt-4 rounded-card border border-line bg-panel px-6 py-5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand">
            <TrendingUp className="h-4 w-4" />
          </span>
          <h2 className="text-[15px] font-semibold text-ink">Performance</h2>
        </div>
        <DateRangeSelector activeDays={rangeDays} loading={loading} onSelect={onRangeChange} />
      </div>
      <p className="mb-4 text-[12px] text-ink-faint">
        {overview.since} to {overview.until} · from synced Shopify and Meta data, day-level
        (not per-product) · currency as reported by each platform, not converted
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={hasShopifyData ? plainNumber(totals.revenue) : '—'} />
        <Stat label="Spend" value={hasMetaData ? plainNumber(totals.spend) : '—'} />
        <Stat
          label="ROAS"
          value={totals.roas != null ? `${totals.roas.toFixed(2)}x` : '—'}
        />
        <Stat label="Orders" value={hasShopifyData ? plainNumber(totals.orders) : '—'} />
      </div>

      {!hasShopifyData && (
        <p className="mt-3 text-[11.5px] text-ink-faint">No synced Shopify orders in this range yet.</p>
      )}
      {!hasMetaData && (
        <p className="mt-1 text-[11.5px] text-ink-faint">No synced Meta spend in this range yet.</p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-line-subtle bg-panel-sunken px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <p className="mt-1 text-[18px] font-semibold text-ink">{value}</p>
    </div>
  );
}

/** Same CURRENCIES list and value shape the CSV-upload currency step uses — one currency system, not two. */
function CurrencySelect({
  label, value, onChange,
}: { label: string; value: CurrencyCode; onChange: (c: CurrencyCode) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CurrencyCode)}
        className="h-9 w-full rounded-control border border-line bg-field px-2.5 text-[13px] text-ink-body transition-colors focus:border-brand focus:outline-none"
      >
        {CURRENCIES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.code} · {option.symbol}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-card border border-line bg-panel px-6 py-8 text-center">
      <Plug className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
      <h1 className="mb-1.5 text-[16px] font-semibold text-ink">{title}</h1>
      <p className="text-[13px] leading-relaxed text-ink-tertiary">{body}</p>
    </div>
  );
}
