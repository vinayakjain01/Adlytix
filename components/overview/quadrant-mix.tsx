'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { NormProduct } from '@/lib/context';
import { bucketByQuadrant, computeThresholds, QUADRANT_ORDER } from '@/lib/quadrants';
import { num, roi } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/**
 * Share of the catalogue in each 4C quadrant, at the default 100% thresholds.
 * Uses the same lib/quadrants helpers as the quadrant screen, so the counts
 * here and there always agree for a given month selection.
 */
export function QuadrantMix({ products }: { products: NormProduct[] }) {
  const thresholds = computeThresholds(products);
  const buckets = bucketByQuadrant(products, thresholds.spend, thresholds.revenue);

  return (
    <section className="rounded-card border border-line bg-panel px-6 py-5">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink">4C mix</h2>
          <p className="mt-1 text-[12px] text-ink-muted">Share of catalogue</p>
        </div>
        <Link
          href="/quadrant-view"
          className="flex flex-shrink-0 items-center gap-1 text-[12.5px] text-brand-300 transition-colors hover:text-brand-100"
        >
          Open
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      <ul className="space-y-4">
        {QUADRANT_ORDER.map((key) => {
          const bucket = buckets[key];
          return (
            <li key={key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] text-ink-body">
                  <span className={cn('h-2 w-2 rounded-sm', bucket.meta.dotClass)} />
                  {bucket.meta.label}
                </span>
                <span className="text-[12.5px] text-ink-secondary tabular-nums">
                  {num(bucket.count)} · {roi(bucket.roi)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-sunken">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(.4,0,.2,1)]', bucket.meta.dotClass)}
                  style={{ width: `${bucket.share}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 border-t border-line-subtle pt-3.5 text-[11.5px] leading-relaxed text-ink-muted">
        Cut-offs are the mean total spend and mean revenue of the products in view. Adjust them
        on the quadrant screen.
      </p>
    </section>
  );
}
