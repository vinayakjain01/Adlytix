'use client';

import type { RefObject } from 'react';
import { useApp } from '@/lib/context';
import { currencySymbol, inr, num, roi, roiTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const TONE_CLASS = { good: 'text-ok', bad: 'text-bad', neutral: 'text-ink' } as const;

/**
 * Top three products by ROI among those with confirmed ad spend.
 * Selection rule (totalSpend > 1, sort by ROI desc, take 3) is unchanged.
 */
export function TopPerformers({ tableRef }: { tableRef?: RefObject<HTMLDivElement | null> }) {
  const { aggregatedProducts, selectedMonths, allMonths } = useApp();

  if (!aggregatedProducts.length) return null;

  const withSpend = aggregatedProducts.filter((p) => p.totalSpend > 1);
  const top3 = [...withSpend].sort((a, b) => b.roi - a.roi).slice(0, 3);
  if (top3.length === 0) return null;

  const monthBadge =
    allMonths.length > 0
      ? selectedMonths.size === allMonths.length
        ? 'all months'
        : `${selectedMonths.size} month${selectedMonths.size !== 1 ? 's' : ''}`
      : null;

  /**
   * Jump to the product's row. The original relied on a `data-product-id`
   * attribute that the old table never rendered, so this always fell back to
   * scrolling to the top of the table; the new table sets the attribute.
   */
  function jumpTo(productId: string) {
    const container = tableRef?.current;
    if (!container) return;

    const row = container.querySelector<HTMLElement>(
      `[data-product-id="${CSS.escape(productId)}"]`,
    );
    if (!row) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('bg-brand-tint-strong');
    setTimeout(() => row.classList.remove('bg-brand-tint-strong'), 2000);
  }

  return (
    <section className="rounded-panel border border-line bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[15px] font-medium text-ink">Top performers in this view</h2>
          <span className="rounded bg-panel-sunken px-2 py-1 text-[11px] text-ink-secondary">
            {num(aggregatedProducts.length)} products
          </span>
          {monthBadge && (
            <span className="rounded bg-brand-tint px-2 py-1 text-[11px] text-brand-200">
              {monthBadge}
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-ink-muted">
          Highest ROI · total spend &gt; 1 · click to jump to the row
        </p>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2 2xl:grid-cols-3">
        {top3.map((p, index) => (
          <button
            key={p.id}
            type="button"
            onClick={() => jumpTo(p.id)}
            className="min-w-0 rounded-control border border-line bg-panel-sunken p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <span className="flex-1 text-[13.5px] font-medium leading-snug text-ink">
                {p.title}
                {p.variant ? ` — ${p.variant}` : ''}
              </span>
              <span
                className={cn(
                  'flex-shrink-0 text-[17px] font-semibold tabular-nums',
                  TONE_CLASS[roiTone(p.roi)],
                )}
              >
                {roi(p.roi)}
              </span>
            </div>

            <p className="text-[12.5px] text-ink-muted">
              Meta spend {inr(p.metaSpend)} · Total spend {inr(p.totalSpend)}
            </p>
            <p className="mb-2.5 text-[12.5px] text-ink-muted">
              Revenue {inr(p.revenue)} · {num(p.itemsSold)} units
            </p>

            <p className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-secondary">
              {index === 0
                ? `Returns ${roi(p.roi)} per ${currencySymbol()}1 spent — highest ROI with confirmed ad spend.`
                : index === 1
                  ? `Delivers ${roi(p.roi)} ROI, moving ${num(p.itemsSold)} units efficiently.`
                  : `Achieves ${roi(p.roi)} ROI with strong unit economics.`}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}
