'use client';

import type { MonthBucket } from '@/hooks/use-monthly-series';
import { inr, roi } from '@/lib/formatters';

/**
 * Monthly spend against revenue for the selected months.
 *
 * Hand-built rather than pulled through Recharts: the design is two rounded
 * gradient bars per month, and this keeps the height transition on the same
 * easing as the rest of the shell with no charting dependency. The figures are
 * also rendered as a real <table> underneath for screen readers, so the visual
 * bars can stay aria-hidden.
 */
/**
 * Tallest bar, as a percentage. The remainder is headroom for the value label
 * that now sits above each bar — at a full 100% the label would be pushed out of
 * the plot area and clipped by the header.
 */
const BAR_CEILING = 86;

/** Bar height for a value, as a percentage of the plot area. */
function barHeight(value: number, peak: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // A visible sliver for a small-but-real value, so a month with spend never
  // looks like a month without any.
  return Math.max((value / peak) * BAR_CEILING, 1.5);
}

export function SpendRevenueChart({ buckets }: { buckets: MonthBucket[] }) {
  if (buckets.length === 0) return null;

  // Months, so a spread is safe here — the list is at most a handful of items.
  const peak = Math.max(
    ...buckets.flatMap((b) => [b.totalSpend, b.revenue]).filter((v) => Number.isFinite(v) && v > 0),
    1,
  );

  return (
    <section className="rounded-card border border-line bg-panel px-6 py-5">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink">Spend vs revenue</h2>
          <p className="mt-1 text-[12px] text-ink-muted">
            Monthly, across {buckets.length} selected {buckets.length === 1 ? 'month' : 'months'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11.5px] text-ink-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-brand" />
            Spend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-q-champions" />
            Revenue
          </span>
        </div>
      </header>

      <div className="flex h-[210px] items-end gap-5" aria-hidden>
        {buckets.map((bucket) => {
          const spendHeight = barHeight(bucket.totalSpend, peak);
          const revenueHeight = barHeight(bucket.revenue, peak);

          // Each bar sits in its own full-height track and is positioned from the
          // bottom, so its label can be pinned just above the bar's top edge
          // without the label's own height eating into the scale.
          const bars = [
            {
              key: 'spend',
              height: spendHeight,
              value: bucket.totalSpend,
              fill: 'bg-[linear-gradient(180deg,#6B8BFF,#3F53B8)]',
              text: 'text-brand-200',
              title: `${bucket.month} · spend ${inr(bucket.totalSpend, true)}`,
            },
            {
              key: 'revenue',
              height: revenueHeight,
              value: bucket.revenue,
              fill: 'bg-[linear-gradient(180deg,#4FE0AC,#1E8F6C)]',
              text: 'text-q-champions',
              title: `${bucket.month} · revenue ${inr(bucket.revenue, true)}`,
            },
          ];

          return (
            <div key={bucket.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-2.5">
              <div className="flex w-full flex-1 items-end justify-center gap-1.5">
                {bars.map((bar) => (
                  <div key={bar.key} className="relative h-full w-[34%]" title={bar.title}>
                    <div
                      className={`absolute bottom-0 w-full rounded-t-md ${bar.fill} transition-[height] duration-700 ease-[cubic-bezier(.4,0,.2,1)]`}
                      style={{ height: `${bar.height}%` }}
                    />
                    {/* Compact notation keeps the label inside the bar's width at
                        five months across; the exact figure is in the tooltip and
                        in the table below. */}
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9.5px] font-medium tabular-nums transition-[bottom] duration-700 ease-[cubic-bezier(.4,0,.2,1)] ${bar.text}`}
                      style={{ bottom: `calc(${bar.height}% + 4px)` }}
                    >
                      {inr(bar.value, true)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-center gap-0.5">
                <span className="truncate text-[11.5px] text-ink-muted tabular-nums">
                  {bucket.shortLabel}
                </span>
                <span className="text-[10px] tabular-nums text-ink-faint">{roi(bucket.roi)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Accessible equivalent of the bars above. */}
      <table className="sr-only">
        <caption>Monthly spend, revenue and ROI for the selected months</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Total spend</th>
            <th scope="col">Revenue</th>
            <th scope="col">ROI</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.month}>
              <th scope="row">{bucket.month}</th>
              <td>{inr(bucket.totalSpend)}</td>
              <td>{inr(bucket.revenue)}</td>
              <td>{roi(bucket.roi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
