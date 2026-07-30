'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Circle, Diamond, Download, Star, Triangle, ChevronDown } from 'lucide-react';
import type { QuadrantBucket, QuadrantKey } from '@/lib/quadrants';
import { QUADRANT_ORDER } from '@/lib/quadrants';
import { buildQuadrantExportRows, downloadCsv } from '@/lib/csv-export';
import { track } from '@/lib/analytics/client';
import { inr, num, roi, roiTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const ICONS = {
  champions: Star,
  contenders: Diamond,
  cruisers: Circle,
  casualties: Triangle,
} as const;

const TONE_CLASS = { good: 'text-ok', bad: 'text-bad', neutral: 'text-ink' } as const;

function QuadrantCard({ bucket }: { bucket: QuadrantBucket }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICONS[bucket.key];
  const { meta } = bucket;

  function download() {
    if (bucket.products.length === 0) return;
    downloadCsv(
      `roasify_${bucket.key}.csv`,
      buildQuadrantExportRows(meta.label, bucket.products),
    );
    track('csv_downloaded', {
      kind: 'quadrant',
      row_count: bucket.products.length,
      was_filtered: false,
      filter_count: 0,
      filename_length: null,
    });
    toast.success(`${meta.label} exported · ${bucket.count} products`);
  }

  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-line border-l-[3px] bg-panel',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover',
        meta.borderClass,
      )}
    >
      <div className="px-5 py-5">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', meta.textClass)} />
            <h3 className="text-[15px] font-medium text-ink">{meta.label}</h3>
            <span
              className={cn(
                'flex-shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-[0.06em]',
                meta.tintClass,
                meta.textClass,
              )}
            >
              {meta.tag.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap text-[11.5px] text-ink-muted">{meta.rule}</span>
            <button
              type="button"
              onClick={download}
              disabled={bucket.products.length === 0}
              title={`Download ${meta.label} CSV`}
              className="rounded p-1.5 text-ink-muted transition-colors hover:bg-panel-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'PRODUCTS', value: num(bucket.count), tone: 'neutral' as const },
            { label: 'SPEND', value: inr(bucket.spend, true), tone: 'neutral' as const },
            { label: 'REVENUE', value: inr(bucket.revenue, true), tone: 'neutral' as const },
            { label: 'ROI', value: roi(bucket.roi), tone: roiTone(bucket.roi) },
          ].map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-muted">
                {stat.label}
              </dt>
              <dd
                className={cn(
                  'truncate text-[18px] font-semibold tabular-nums',
                  TONE_CLASS[stat.tone],
                )}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        {bucket.count > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] text-brand-300 transition-colors hover:text-brand-100"
          >
            {expanded ? 'Hide products' : `View all ${num(bucket.count)} products`}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="max-h-[320px] overflow-auto border-t border-line-subtle animate-fade-in">
          <table className="w-full border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                {['PRODUCT ID', 'PRODUCT', 'SPEND', 'REVENUE', 'ROI'].map((label, i) => (
                  <th
                    key={label}
                    scope="col"
                    className={cn(
                      'sticky top-0 z-[2] whitespace-nowrap border-b border-line-subtle bg-header px-5 py-2.5',
                      'text-[10px] font-semibold tracking-[0.1em] text-ink-tertiary',
                      i >= 2 ? 'text-right' : 'text-left',
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...bucket.products]
                .sort((a, b) => b.revenue - a.revenue)
                .map((product) => (
                  <tr key={product.id} className="transition-colors hover:bg-panel-raised">
                    <td className="whitespace-nowrap border-b border-line-subtle px-5 py-2.5 font-mono text-ink-muted">
                      {product.id}
                    </td>
                    <td className="max-w-[220px] truncate border-b border-line-subtle px-5 py-2.5 text-ink-body">
                      {product.title}
                    </td>
                    <td className="whitespace-nowrap border-b border-line-subtle px-5 py-2.5 text-right text-ink-secondary tabular-nums">
                      {inr(product.totalSpend, true)}
                    </td>
                    <td className="whitespace-nowrap border-b border-line-subtle px-5 py-2.5 text-right text-ink-secondary tabular-nums">
                      {inr(product.revenue, true)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap border-b border-line-subtle px-5 py-2.5 text-right tabular-nums',
                        TONE_CLASS[roiTone(product.roi)],
                      )}
                    >
                      {roi(product.roi)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function QuadrantGrid({
  buckets,
}: {
  buckets: Record<QuadrantKey, QuadrantBucket>;
}) {
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {QUADRANT_ORDER.map((key) => (
        <QuadrantCard key={key} bucket={buckets[key]} />
      ))}
    </div>
  );
}
