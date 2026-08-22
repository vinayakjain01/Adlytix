'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Play, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { ModeToggle } from '@/components/integrations/mode-toggle';
import { SourceUploads } from '@/components/sources/source-uploads';
import { MergePipeline } from '@/components/sources/merge-pipeline';
import { useMerge } from '@/hooks/use-merge';
import { useApp } from '@/lib/context';
import { CURRENCIES, type CurrencyCode } from '@/lib/currency';
import { inr, roi } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export default function SourcesPage() {
  const {
    warnings, aggregatedProducts, allMonths, mergedSummary, googleFile,
    baseCurrency, setBaseCurrency, sourceCurrencies, mergeCurrency,
    metaFile, shopifyFile,
  } = useApp();
  const { run, status, error, clearError, runId, canMerge, fileCount, isMerged } = useMerge();

  // Only the uploads actually present matter for the mixed-currency notice.
  const mixedCurrencies = (
    [
      [metaFile, sourceCurrencies.meta],
      [shopifyFile, sourceCurrencies.shopify],
      [googleFile, sourceCurrencies.google],
    ] as const
  ).some(([file, code]) => file && code !== baseCurrency);

  // Announce completion once per successful run.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (status === 'done' && runId && announced.current !== runId) {
      announced.current = runId;
      toast.success(`Merge complete · ${aggregatedProducts.length} products`);
    }
  }, [status, runId, aggregatedProducts.length]);

  const running = status === 'running';

  const hint = canMerge
    ? `${fileCount} file${fileCount === 1 ? '' : 's'} loaded${googleFile ? '' : ' — Google Ads is optional'} — ready to merge`
    : 'Upload the Meta Ads and Shopify exports to enable the merge. Google Ads is optional.';

  return (
    <AppShell>
      <div className="animate-fade-up">
        <ModeToggle active="upload" />

        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Data sources</h1>
          <p className="text-[14px] text-ink-secondary">
            Drop your raw exports. They are cleaned, normalised and merged into one
            product-level table.
          </p>
        </header>

        <SourceUploads />

        {/* Merge bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-panel px-6 py-4">
          <div className="min-w-0">
            <p className="text-[13.5px] text-ink-secondary">{hint}</p>
            {mixedCurrencies && (
              <p className="mt-1.5 text-[12px] text-warn">
                Sources use different currencies — every amount will be converted to{' '}
                {baseCurrency} before totals and ROI are calculated.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
              Report in
              <select
                value={baseCurrency}
                onChange={(event) => setBaseCurrency(event.target.value as CurrencyCode)}
                aria-label="Base currency for the analysis"
                className="h-9 rounded-control border border-line bg-field px-2.5 text-[13px] text-ink-body transition-colors focus:border-brand focus:outline-none"
              >
                {CURRENCIES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.code} · {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={run}
              disabled={!canMerge || running}
              className={cn(
                'flex h-10 min-w-[190px] items-center justify-center gap-2.5 rounded-control px-5',
                'text-[13.5px] font-medium transition-transform',
                canMerge && !running
                  ? 'bg-brand-gradient text-white shadow-brand hover:-translate-y-px'
                  : 'cursor-not-allowed bg-panel-raised text-ink-faint',
              )}
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Merge &amp; analyse
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-card border border-bad-line bg-bad-tint px-6 py-4 animate-fade-in">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-bad" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-bad-soft">Merge failed</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-tertiary">
                {error}
              </p>
            </div>
            <button
              type="button"
              onClick={clearError}
              title="Dismiss"
              className="flex-shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-bad"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="mt-4">
          <MergePipeline status={status} />
        </div>

        {isMerged && (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {/* Result */}
            <section className="rounded-card border border-ok/25 bg-ok-tint px-6 py-5 animate-fade-up">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ok-tint text-ok">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-[14.5px] font-medium text-ink">Merge complete</h2>
                {runId && (
                  <span className="ml-auto font-mono text-[11.5px] text-ink-tertiary">{runId}</span>
                )}
              </div>

              <p className="text-[13px] leading-relaxed text-ink-secondary">
                <strong className="font-medium text-ink">
                  {aggregatedProducts.length.toLocaleString('en-IN')} products
                </strong>{' '}
                across {allMonths.length || '—'}{' '}
                {allMonths.length === 1 ? 'month' : 'months'}. Totals:{' '}
                <strong className="font-medium text-ink">
                  {inr(mergedSummary?.total_spend ?? 0, true)}
                </strong>{' '}
                spend,{' '}
                <strong className="font-medium text-ink">
                  {inr(mergedSummary?.total_rev ?? 0, true)}
                </strong>{' '}
                revenue,{' '}
                <strong className="font-medium text-ink">{roi(mergedSummary?.roi ?? 0)}</strong>{' '}
                overall.
              </p>

              {/* What was actually converted, and at what rate — so a run can
                  be explained later rather than the numbers just differing. */}
              {mergeCurrency && (
                <div className="mt-3.5 border-t border-ok/20 pt-3">
                  <p className="text-[12px] text-ink-tertiary">
                    Reported in <span className="font-medium text-ink">{mergeCurrency.base}</span>
                    {mergeCurrency.converted ? (
                      <>
                        {' · converted from '}
                        {(['meta', 'shopify', 'google'] as const)
                          .filter((key) => mergeCurrency.sources[key]?.converted)
                          .map((key) => {
                            const entry = mergeCurrency.sources[key];
                            return `${key} ${entry.currency} @ ${entry.factor?.toFixed(4)}`;
                          })
                          .join(', ')}
                        {mergeCurrency.rateProvider !== 'not required' &&
                          ` · rates from ${mergeCurrency.rateProvider}`}
                      </>
                    ) : (
                      ' · no conversion needed, every source was already in this currency'
                    )}
                  </p>
                </div>
              )}

              <Link
                href="/product-analysis"
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-control border border-ok/30 px-4 text-[13px] text-ok-soft transition-colors hover:bg-ok-tint"
              >
                View product table
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </section>

            {/* Warnings from the cleaners */}
            {warnings.length > 0 && (
              <section className="rounded-card border border-warn/25 bg-warn-tint px-6 py-5 animate-fade-up">
                <h2 className="mb-3 text-[12px] font-semibold tracking-[0.1em] text-warn">
                  WARNINGS
                </h2>
                <ul className="space-y-2.5">
                  {warnings.map((warning, i) => (
                    <li
                      key={i}
                      className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-body"
                    >
                      <span className="text-warn">·</span>
                      {warning}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
