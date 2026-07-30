'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Percent, Upload } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { StatStrip } from '@/components/ui/stat-card';
import { CohortComparison } from '@/components/discounts/cohort-comparison';
import { DiscountNarrative } from '@/components/discounts/discount-narrative';
import { DiscountTable } from '@/components/discounts/discount-table';
import { useApp } from '@/lib/context';
import { splitByDiscount } from '@/lib/discount-metrics';
import { inr, num } from '@/lib/formatters';

export default function DiscountAnalysisPage() {
  // aggregatedProducts rather than the raw rows, so the split follows the
  // header's month selection like every other screen. The original read
  // mergedData directly and therefore ignored the month picker.
  const { mergedData, aggregatedProducts, allMonths, selectedMonths, discountFile } = useApp();

  const hasData = mergedData !== null && aggregatedProducts.length > 0;
  const split = useMemo(() => splitByDiscount(aggregatedProducts), [aggregatedProducts]);

  const hasDiscountList = split.d.count > 0;

  const kpis = useMemo(
    () => [
      { label: 'DISCOUNTED', value: split.d.count, format: 'number' as const },
      { label: 'FULL PRICE', value: split.nd.count, format: 'number' as const },
      { label: 'DISCOUNTED ROI', value: split.d.roi, format: 'roi' as const },
      { label: 'FULL-PRICE ROI', value: split.nd.roi, format: 'roi' as const },
    ],
    [split],
  );

  const monthLabel =
    allMonths.length > 0
      ? selectedMonths.size === allMonths.length
        ? `all ${allMonths.length} ${allMonths.length === 1 ? 'month' : 'months'}`
        : `${selectedMonths.size} of ${allMonths.length} months`
      : null;

  const header = (
    <header className="mb-7">
      <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">
        Discount vs full price
      </h1>
      <p className="text-[14px] text-ink-secondary">
        Compare discounted and full-price products to see whether the discount pays for itself
        {monthLabel && hasData ? ` · ${monthLabel}` : ''}.
      </p>
    </header>
  );

  if (!hasData) {
    return (
      <AppShell>
        <div className="animate-fade-up">
          {header}
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint animate-floaty">
              <Upload className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">No merged data yet</p>
            <p className="mx-auto mb-6 max-w-md text-[13.5px] leading-relaxed text-ink-tertiary">
              Upload your exports and run a merge first. Add the optional discount list to split
              products into discounted and full-price cohorts.
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
        {header}

        {!hasDiscountList ? (
          /* Merged data exists, but nothing is tagged as discounted. */
          <div className="rounded-card border border-warn/25 bg-warn-tint px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-warn/25 bg-panel-sunken text-warn">
              <Percent className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">
              {discountFile ? 'No products matched the discount list' : 'No discount list uploaded'}
            </p>
            <p className="mx-auto mb-6 max-w-lg text-[13.5px] leading-relaxed text-ink-secondary">
              {discountFile ? (
                <>
                  <span className="font-mono text-ink">{discountFile.name}</span> was uploaded, but
                  none of its product IDs matched the {num(aggregatedProducts.length)} merged
                  products. Check that the file has a <span className="text-ink">Product ID</span>{' '}
                  column holding the same IDs as your Shopify export.
                </>
              ) : (
                <>
                  This screen splits your catalogue into discounted and full-price cohorts. Add the
                  optional discount list — a single <span className="text-ink">Product ID</span>{' '}
                  column, one row per discounted product — on the Data sources screen, then re-run
                  the merge.
                </>
              )}
            </p>
            <Link
              href="/sources"
              className="inline-flex h-9 items-center gap-2 rounded-control border border-warn/30 px-4 text-[13px] text-warn transition-colors hover:bg-warn-tint"
            >
              {discountFile ? 'Replace the discount list' : 'Add a discount list'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <StatStrip cards={kpis} className="2xl:grid-cols-4" />

            <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
              <CohortComparison split={split} />
              <DiscountNarrative split={split} />
            </div>

            <DiscountTable products={aggregatedProducts} />

            <p className="px-1 text-[12px] leading-relaxed text-ink-muted">
              Discounted spend in this selection is {inr(split.d.spend, true)} against{' '}
              {inr(split.nd.spend, true)} at full price. Averages here are per-product means, so
              CTR and CPM are not spend-weighted the way they are on the product table.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
