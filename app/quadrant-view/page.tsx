'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowRight, Upload } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { StatStrip } from '@/components/ui/stat-card';
import { QuadrantScatter } from '@/components/quadrant/quadrant-scatter';
import { ChampionsHero } from '@/components/quadrant/champions-hero';
import { QuadrantGrid } from '@/components/quadrant/quadrant-cards';
import { ThresholdPanel } from '@/components/quadrant/threshold-panel';
import { FourCsSlideover } from '@/components/quadrant/four-cs-slideover';
import { useApp } from '@/lib/context';
import { bucketByQuadrant, classify, computeThresholds, QUADRANTS } from '@/lib/quadrants';
import { buildAllQuadrantsExportRows, downloadCsv } from '@/lib/csv-export';
import { track } from '@/lib/analytics/client';
import { computeTotals } from '@/lib/product-metrics';
import { num } from '@/lib/formatters';
import { useSettledValue } from '@/hooks/use-settled-value';

export default function QuadrantViewPage() {
  const { mergedData, aggregatedProducts, allMonths, selectedMonths } = useApp();

  const [spendPct, setSpendPct] = useState(100);
  const [revPct, setRevPct] = useState(100);
  const [helpOpen, setHelpOpen] = useState(false);

  const hasData = mergedData !== null && aggregatedProducts.length > 0;

  // Thresholds are the MEAN of the products currently in view, scaled by the
  // sliders — so they move with the month selection as well as the sliders.
  const thresholds = useMemo(
    () => computeThresholds(aggregatedProducts, spendPct, revPct),
    [aggregatedProducts, spendPct, revPct],
  );

  const buckets = useMemo(
    () => bucketByQuadrant(aggregatedProducts, thresholds.spend, thresholds.revenue),
    [aggregatedProducts, thresholds.spend, thresholds.revenue],
  );

  const totals = useMemo(() => computeTotals(aggregatedProducts), [aggregatedProducts]);

  const monthLabel =
    allMonths.length > 0
      ? selectedMonths.size === allMonths.length
        ? `All ${allMonths.length} months`
        : `${selectedMonths.size} of ${allMonths.length} months`
      : null;

  const kpis = useMemo(
    () => [
      { label: 'TOTAL PRODUCTS', value: totals.count, format: 'number' as const },
      { label: 'TOTAL SPEND', value: totals.totalSpend, format: 'currency' as const },
      { label: 'TOTAL REVENUE', value: totals.revenue, format: 'currency' as const },
      { label: 'OVERALL ROI', value: totals.roi, format: 'roi' as const },
    ],
    [totals],
  );

  // Sliders emit continuously while dragged; only the resting value is a
  // deliberate choice worth recording. The tracked value is a primitive, not an
  // object: a fresh object identity each render would restart the timer on
  // unrelated re-renders and then report a change that never happened.
  useSettledValue(`${spendPct}:${revPct}`, (pair) => {
    const [spend, revenue] = pair.split(':').map(Number);
    track('quadrant_thresholds_changed', { spend_pct: spend, revenue_pct: revenue });
  }, 500);

  const exportAll = useCallback(() => {
    if (aggregatedProducts.length === 0) return;
    downloadCsv(
      `roasify_quadrant_${Date.now()}.csv`,
      buildAllQuadrantsExportRows(
        aggregatedProducts,
        (product) => QUADRANTS[classify(product, thresholds.spend, thresholds.revenue)].label,
        thresholds.spend,
        thresholds.revenue,
        monthLabel ?? 'All data',
      ),
    );
    track('csv_downloaded', {
      kind: 'all-quadrants',
      row_count: aggregatedProducts.length,
      was_filtered: false,
      filter_count: 0,
      filename_length: null,
    });
    toast.success(`Exported ${num(aggregatedProducts.length)} products with quadrants`);
  }, [aggregatedProducts, thresholds.spend, thresholds.revenue, monthLabel]);

  if (!hasData) {
    return (
      <AppShell>
        <div className="animate-fade-up">
          <header className="mb-7">
            <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">4C quadrant</h1>
            <p className="text-[14px] text-ink-secondary">
              Classify products into Champions, Contenders, Cruisers and Casualties by spend
              against revenue.
            </p>
          </header>

          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint animate-floaty">
              <Upload className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">No merged data yet</p>
            <p className="mx-auto mb-6 max-w-md text-[13.5px] leading-relaxed text-ink-tertiary">
              Upload your exports and run a merge first — the quadrants are derived from that
              result.
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
    <AppShell
      onExport={exportAll}
      exportLabel="Export all"
      rightPanel={
        <ThresholdPanel
          thresholds={thresholds}
          spendPct={spendPct}
          revPct={revPct}
          buckets={buckets}
          monthLabel={monthLabel}
          onSpendPctChange={setSpendPct}
          onRevPctChange={setRevPct}
          onReset={() => {
            setSpendPct(100);
            setRevPct(100);
          }}
        />
      }
    >
      <div className="animate-fade-up">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">4C quadrant</h1>
            <p className="text-[14px] text-ink-secondary">
              Classify products into Champions, Contenders, Cruisers and Casualties by spend
              against revenue.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              track('quadrant_explainer_opened', {
                populated_quadrants: Object.values(buckets).filter((b) => b.count > 0).length,
              });
              setHelpOpen(true);
            }}
            className="flex h-[38px] flex-shrink-0 items-center gap-1.5 rounded-control border border-line bg-field px-4 text-[13px] text-ink-body transition-colors hover:border-line-hover hover:text-ink"
          >
            How the 4Cs work
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Ordered so the screen answers "what have I got?" before "what should
            I do?", and keeps the chart as supporting evidence rather than the
            opening statement: totals, then the four quadrants and their
            products, then the single recommended action, then the distribution
            that explains it. The per-quadrant recommendations moved to their own
            AI insights screen, which is where the design puts them. */}
        <div className="space-y-4">
          <StatStrip cards={kpis} className="2xl:grid-cols-4" />
          <QuadrantGrid buckets={buckets} />
          <ChampionsHero
            products={aggregatedProducts}
            spendThreshold={thresholds.spend}
            revenueThreshold={thresholds.revenue}
          />
          <QuadrantScatter
            products={aggregatedProducts}
            spendThreshold={thresholds.spend}
            revenueThreshold={thresholds.revenue}
          />
        </div>
      </div>

      <FourCsSlideover open={helpOpen} onClose={() => setHelpOpen(false)} />
    </AppShell>
  );
}
