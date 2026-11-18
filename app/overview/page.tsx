'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Plug, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { StatStrip, type StatCardData } from '@/components/ui/stat-card';
import { SpendRevenueChart } from '@/components/overview/spend-revenue-chart';
import { QuadrantMix } from '@/components/overview/quadrant-mix';
import { TopProducts } from '@/components/overview/top-products';
import { LatestAiRead } from '@/components/overview/latest-ai-read';
import { useApp } from '@/lib/context';
import { useAiInsights } from '@/lib/insights-context';
import { useMonthlySeries, monthOverMonthDelta, type MonthBucket } from '@/hooks/use-monthly-series';
import { computeKpis } from '@/lib/product-metrics';

/** Maps each KPI onto the month series that backs its sparkline. */
const SERIES_FOR: Record<string, (b: MonthBucket) => number> = {
  PRODUCTS: (b) => b.products,
  'META SPEND': (b) => b.metaSpend,
  'GOOGLE COST': (b) => b.googleCost,
  'TOTAL SPEND': (b) => b.totalSpend,
  REVENUE: (b) => b.revenue,
  'OVERALL ROI': (b) => b.roi,
};

/** Only revenue and ROI are unambiguously better when they rise. */
const UP_IS_GOOD = new Set(['REVENUE', 'OVERALL ROI']);

export default function OverviewPage() {
  const { mergedData, aggregatedProducts, allMonths, selectedMonths } = useApp();
  const { status: aiStatus, run: runAi } = useAiInsights();
  const { buckets } = useMonthlySeries();

  const hasData = mergedData !== null && aggregatedProducts.length > 0;

  // Totals come from aggregatedProducts, which context recomputes on every
  // month change — so the whole screen follows the header's month picker.
  const kpis = useMemo(() => computeKpis(aggregatedProducts), [aggregatedProducts]);

  const cards = useMemo((): StatCardData[] => {
    const previousMonth = buckets.length >= 2 ? buckets[buckets.length - 2].month : null;

    return kpis.map((kpi) => {
      const pick = SERIES_FOR[kpi.label];
      const series = pick ? buckets.map(pick) : undefined;
      return {
        ...kpi,
        series,
        delta: series ? monthOverMonthDelta(series) : null,
        deltaLabel: previousMonth ? `vs ${previousMonth}` : undefined,
        deltaDirection: UP_IS_GOOD.has(kpi.label) ? 'up-is-good' : 'neutral',
      };
    });
  }, [kpis, buckets]);

  const monthLabel =
    allMonths.length === 0
      ? 'all available data'
      : selectedMonths.size === allMonths.length
        ? `all ${allMonths.length} ${allMonths.length === 1 ? 'month' : 'months'}`
        : `${selectedMonths.size} of ${allMonths.length} months`;

  return (
    <AppShell>
      <div className="animate-fade-up">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Overview</h1>
            <p className="text-[14px] text-ink-secondary">
              Merged product performance across Meta Ads, Shopify and Google Ads
              {hasData ? ` · ${monthLabel}` : ''}.
            </p>
          </div>

          {hasData && (
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5">
              <Link
                href="/integrations"
                className="flex h-[38px] items-center gap-2 rounded-control border border-line bg-field px-4 text-[13px] text-ink-body transition-colors hover:border-line-hover hover:text-ink"
              >
                <Plug className="h-3.5 w-3.5" />
                Integration
              </Link>

              {/* Runs the same analysis the AI insights screen shows — the
                  result is shared, so this never triggers a second call. */}
              <button
                type="button"
                onClick={runAi}
                disabled={aiStatus === 'thinking'}
                className="flex h-[38px] items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aiStatus === 'thinking' ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {aiStatus === 'thinking' ? 'Analysing…' : 'Ask Adlytix AI'}
              </button>
            </div>
          )}
        </header>

        {!hasData ? (
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint animate-floaty">
              <Upload className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">No data yet</p>
            <p className="mx-auto mb-6 max-w-md text-[13.5px] leading-relaxed text-ink-tertiary">
              Upload your Meta Ads and Shopify exports and run a merge, or connect Shopify
              and Meta directly and sync. Either way, everything on this screen is derived
              from that data.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Link
                href="/sources"
                className="inline-flex h-9 items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-transform hover:-translate-y-px"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload data
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/integrations"
                className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-field px-4 text-[13px] text-ink-body transition-colors hover:border-line-hover hover:text-ink"
              >
                <Plug className="h-3.5 w-3.5" />
                Connect an integration
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <StatStrip cards={cards} />

            {buckets.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                <SpendRevenueChart buckets={buckets} />
                <QuadrantMix products={aggregatedProducts} />
              </div>
            ) : (
              /* No Month column in the upload — the chart has no axis to draw. */
              <QuadrantMix products={aggregatedProducts} />
            )}

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <TopProducts products={aggregatedProducts} />
              <LatestAiRead />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
