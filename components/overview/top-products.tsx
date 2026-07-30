'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { NormProduct } from '@/lib/context';
import { inr, num, roi, roiTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const TONE_CLASS = { good: 'text-ok', bad: 'text-bad', neutral: 'text-ink-body' } as const;

/**
 * Highest-revenue products in the current month selection.
 *
 * Distinct from the product screen's "Top performers", which ranks by ROI
 * among products with confirmed ad spend. This one answers "where does the
 * revenue come from", which is the Overview's question.
 */
export function TopProducts({ products, limit = 5 }: { products: NormProduct[]; limit?: number }) {
  const rows = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line-subtle px-6 py-4">
        <h2 className="text-[15px] font-medium text-ink">Top products by revenue</h2>
        <Link
          href="/product-analysis"
          className="flex flex-shrink-0 items-center gap-1 text-[12.5px] text-brand-300 transition-colors hover:text-brand-100"
        >
          All products
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      <ol>
        {rows.map((product, index) => (
          <li
            key={product.id}
            className="flex items-center gap-3.5 border-b border-line-subtle px-6 py-3.5 last:border-b-0 transition-colors hover:bg-panel-raised"
          >
            <span className="w-5 flex-shrink-0 font-mono text-[12px] text-ink-faint tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-ink">{product.title}</p>
              <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-muted">
                {product.id}
                {product.variant ? ` · ${product.variant}` : ''}
              </p>
            </div>

            <div className="flex-shrink-0 text-right">
              <p className="text-[13.5px] text-ink-body tabular-nums">{inr(product.revenue, true)}</p>
              <p className={cn('mt-0.5 text-[11.5px] tabular-nums', TONE_CLASS[roiTone(product.roi)])}>
                {roi(product.roi)} · {num(product.itemsSold)} units
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
