'use client';

import type { DiscountSplit } from '@/lib/discount-metrics';
import { inr, num, roi } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface Row {
  label: string;
  discounted: number;
  nonDiscounted: number;
  format: (value: number) => string;
  /** Whether a higher value is the better outcome for that metric. */
  higherIsBetter: boolean;
}

function MetricRow({ row }: { row: Row }) {
  const { discounted: dv, nonDiscounted: ndv, higherIsBetter } = row;
  const total = dv + ndv;
  const discWins = higherIsBetter ? dv > ndv : dv < ndv;
  const ndWins = higherIsBetter ? ndv > dv : ndv < dv;

  return (
    <li className="py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-ink-secondary">{row.label}</span>
        <span className="tabular-nums">
          <span className={cn(discWins ? 'font-medium text-warn' : 'text-ink-secondary')}>
            {row.format(dv)}
          </span>
          <span className="mx-2 text-ink-disabled">vs</span>
          <span className={cn(ndWins ? 'font-medium text-brand-300' : 'text-ink-secondary')}>
            {row.format(ndv)}
          </span>
        </span>
      </div>

      {/* Proportional split — widths sum to 100% of the row. */}
      <div className="flex h-2 gap-1">
        <div
          className="rounded-full bg-[linear-gradient(90deg,#FBBF24,#F59E0B)] transition-[width] duration-700 ease-[cubic-bezier(.4,0,.2,1)]"
          style={{ width: `${total > 0 ? (dv / total) * 100 : 0}%` }}
        />
        <div
          className="rounded-full bg-brand-gradient transition-[width] duration-700 ease-[cubic-bezier(.4,0,.2,1)]"
          style={{ width: `${total > 0 ? (ndv / total) * 100 : 0}%` }}
        />
      </div>
    </li>
  );
}

export function CohortComparison({ split }: { split: DiscountSplit }) {
  const { d, nd } = split;

  const rows: Row[] = [
    { label: 'Products', discounted: d.count, nonDiscounted: nd.count, format: num, higherIsBetter: true },
    { label: 'Spend', discounted: d.spend, nonDiscounted: nd.spend, format: (v) => inr(v, true), higherIsBetter: false },
    { label: 'Revenue', discounted: d.revenue, nonDiscounted: nd.revenue, format: (v) => inr(v, true), higherIsBetter: true },
    { label: 'ROI', discounted: d.roi, nonDiscounted: nd.roi, format: roi, higherIsBetter: true },
    { label: 'Items sold', discounted: d.items, nonDiscounted: nd.items, format: num, higherIsBetter: true },
    { label: 'Average order value', discounted: d.aov, nonDiscounted: nd.aov, format: (v) => inr(v), higherIsBetter: true },
    { label: 'Avg CTR', discounted: d.avgCtr, nonDiscounted: nd.avgCtr, format: (v) => `${v.toFixed(1)}%`, higherIsBetter: true },
    { label: 'Avg CPM', discounted: d.avgCpm, nonDiscounted: nd.avgCpm, format: (v) => inr(v, true), higherIsBetter: false },
  ];

  return (
    <section className="rounded-card border border-line bg-panel px-6 py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium text-ink">Cohort comparison</h2>
        <div className="flex items-center gap-4 text-[11.5px] text-ink-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-warn" />
            Discounted ({num(d.count)})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-brand" />
            Non-discounted ({num(nd.count)})
          </span>
        </div>
      </header>

      <ul className="divide-y divide-line-subtle">
        {rows.map((row) => (
          <MetricRow key={row.label} row={row} />
        ))}
      </ul>
    </section>
  );
}
