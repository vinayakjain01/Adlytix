'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AdviceCard } from '@/components/insights/advice-card';
import { AnalysisProgress } from '@/components/insights/analysis-progress';
import { BUTTON_PRIMARY } from '@/components/ui/form-field';
import { useApp, type NormProduct } from '@/lib/context';
import { useAiInsights } from '@/lib/insights-context';
import { inAdviceOrder } from '@/lib/insights';
import { bucketByQuadrant, computeThresholds } from '@/lib/quadrants';
import { num } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export default function InsightsPage() {
  const { mergedData, aggregatedProducts, currency } = useApp();
  const { status, result, error, canRun, scope, run } = useAiInsights();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Same natural cut-offs the analysis was briefed on, so the figures beside each
  // recommendation are the ones it was actually given.
  const buckets = useMemo(() => {
    const thresholds = computeThresholds(aggregatedProducts, 100, 100);
    return bucketByQuadrant(aggregatedProducts, thresholds.spend, thresholds.revenue);
  }, [aggregatedProducts]);

  const byId = useMemo(() => {
    const map = new Map<string, NormProduct>();
    for (const product of aggregatedProducts) map.set(product.id, product);
    return map;
  }, [aggregatedProducts]);

  const ordered = useMemo(() => (result ? inAdviceOrder(result.quadrants) : []), [result]);

  // First card open by default, matching the design; toggling closes it.
  const isOpen = useCallback(
    (key: string, index: number) => (expanded === null ? index === 0 : expanded === key),
    [expanded],
  );

  const buttonLabel =
    status === 'thinking' ? 'Analysing…' : result ? 'Re-run analysis' : 'Generate analysis';

  if (!mergedData || aggregatedProducts.length === 0) {
    return (
      <AppShell>
        <div className="animate-fade-up">
          <Header />
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint animate-floaty">
              <Upload className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">No merged data yet</p>
            <p className="mx-auto mb-6 max-w-md text-[13.5px] leading-relaxed text-ink-tertiary">
              The recommendations are read from your merged catalogue — upload your exports and run
              a merge first.
            </p>
            <Link
              href="/sources"
              className="inline-flex h-9 items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-transform hover:-translate-y-px"
            >
              Go to data sources
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="animate-fade-up">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">AI insights</h1>
            <p className="text-[14px] text-ink-secondary">
              Per-quadrant recommendations, grounded in your merged numbers.
            </p>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!canRun || status === 'thinking'}
            className={cn(BUTTON_PRIMARY, 'h-[42px] px-5 text-[14px]')}
          >
            {status === 'thinking' ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {buttonLabel}
          </button>
        </header>

        {status === 'thinking' && (
          <AnalysisProgress productCount={scope.products} monthLabel={scope.monthLabel} />
        )}

        {status === 'error' && error && (
          <div
            role="alert"
            className="flex gap-2.5 rounded-card border border-bad-line bg-bad-tint px-5 py-4 text-[13.5px] leading-relaxed text-bad-soft animate-fade-in"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {status === 'idle' && (
          <section className="rounded-card border border-line bg-panel px-6 py-20 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-panel bg-brand-gradient text-white shadow-brand animate-floaty">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="mb-2 text-[19px] font-semibold text-ink">Ready when you are</p>
            <p className="mx-auto max-w-lg text-[14px] leading-relaxed text-ink-tertiary">
              Adlytix reads all {num(scope.products)} products across the selected months and
              returns specific actions per quadrant — with exact product IDs and figures.
            </p>
          </section>
        )}

        {result && status !== 'thinking' && (
          <div className="space-y-4">
            <section className="rounded-card border border-brand/25 bg-brand-tint px-6 py-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-chip bg-brand-gradient text-white">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <h2 className="text-[15.5px] font-semibold text-ink">Executive summary</h2>
                </span>
                <span className="text-[11.5px] tabular-nums text-ink-muted">
                  {num(scope.products)} products
                  {scope.monthLabel && ` · ${scope.monthLabel.toLowerCase()}`} · {currency} ·{' '}
                  {result.model}
                  {result.cached && ' · reused'}
                </span>
              </div>
              <p className="text-[14.5px] leading-relaxed text-brand-100">{result.headline}</p>
            </section>

            {ordered.map((advice, index) => (
              <AdviceCard
                key={advice.quadrant}
                advice={advice}
                bucket={buckets[advice.quadrant]}
                byId={byId}
                expanded={isOpen(advice.quadrant, index)}
                onToggle={() => setExpanded(isOpen(advice.quadrant, index) ? '' : advice.quadrant)}
              />
            ))}

            {result.watchOuts.length > 0 && (
              <section className="rounded-card border border-line bg-panel px-6 py-5">
                <p className="mb-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-ink-faint">
                  WATCH OUT
                </p>
                <ul className="space-y-1.5">
                  {result.watchOuts.map((item) => (
                    <li key={item} className="text-[13px] leading-relaxed text-ink-tertiary">
                      · {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.droppedProductIds > 0 && (
              <p className="text-[12.5px] leading-relaxed text-warn">
                {result.droppedProductIds} product{' '}
                {result.droppedProductIds === 1 ? 'reference was' : 'references were'} removed
                because {result.droppedProductIds === 1 ? 'it did' : 'they did'} not match any
                product in your data.
              </p>
            )}

            <p className="text-[12px] leading-relaxed text-ink-faint">
              Every figure on this screen is read from your merged data. The model supplies the
              wording and the product IDs only, and each ID is checked against your catalogue
              before it is shown.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Header() {
  return (
    <header className="mb-7">
      <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">AI insights</h1>
      <p className="text-[14px] text-ink-secondary">
        Per-quadrant recommendations, grounded in your merged numbers.
      </p>
    </header>
  );
}
