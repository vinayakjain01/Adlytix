'use client';

import { cn } from '@/lib/utils';

export interface MetricItem {
  label: string;
  value: string;
  /** Small qualifier shown next to the value, e.g. "of 72". */
  note?: string;
  highlight?: boolean;
}

/**
 * Compact horizontal metric strip. Used for both the filtered totals and the
 * per-product averages, which are the same shape at different scales.
 */
export function MetricsBar({
  title,
  items,
  badge,
  className,
}: {
  title: string;
  items: MetricItem[];
  badge?: string;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-panel border border-line bg-panel px-5 py-4', className)}
    >
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-muted">
          {title.toUpperCase()}
        </h2>
        {badge && (
          <span className="flex-shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-200">
            {badge}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-x-4 gap-y-3.5 sm:grid-cols-5 lg:grid-cols-9">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="mb-1 truncate text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
              {item.label.toUpperCase()}
            </dt>
            <dd className="flex min-w-0 items-baseline gap-1">
              <span
                className={cn(
                  'truncate text-[15px] font-semibold leading-tight tabular-nums',
                  item.highlight ? 'text-brand-200' : 'text-ink',
                )}
              >
                {item.value}
              </span>
              {item.note && (
                <span className="flex-shrink-0 whitespace-nowrap text-[10px] text-ink-muted">
                  {item.note}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
