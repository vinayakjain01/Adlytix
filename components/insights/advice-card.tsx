'use client';

import { ArrowRight, ChevronDown } from 'lucide-react';
import { QUADRANTS, type QuadrantBucket } from '@/lib/quadrants';
import type { QuadrantAdvice } from '@/lib/insights';
import type { NormProduct } from '@/lib/context';
import { roi as roiFmt } from '@/lib/formatters';
import { useMoney } from '@/hooks/use-money';
import { cn } from '@/lib/utils';

interface AdviceCardProps {
  advice: QuadrantAdvice;
  bucket: QuadrantBucket;
  /** Resolves the model's product IDs to real rows. */
  byId: Map<string, NormProduct>;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One quadrant's recommendation, as an accordion row.
 *
 * Every figure here — the bucket line and each product chip — is read from local
 * data. The model contributes the title, the headline, the three actions and the
 * list of product IDs, and nothing else, so no number on screen can have come
 * from it.
 */
export function AdviceCard({ advice, bucket, byId, expanded, onToggle }: AdviceCardProps) {
  const meta = QUADRANTS[advice.quadrant];
  const money = useMoney();

  const named = advice.productIds
    .map((id) => byId.get(id))
    .filter((product): product is NormProduct => product !== undefined);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-line border-l-[3px] bg-panel',
        'transition-colors',
        meta.borderClass,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors hover:bg-panel-raised/40"
      >
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-chip text-[13px]',
            meta.tintClass,
            meta.textClass,
          )}
          aria-hidden
        >
          {GLYPHS[advice.quadrant]}
        </span>

        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-center gap-2.5">
            <span className="text-[15px] font-semibold text-ink">{advice.title}</span>
            <span
              className={cn(
                'rounded-chip px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.08em]',
                meta.tintClass,
                meta.textClass,
              )}
            >
              {meta.tag.toUpperCase()}
            </span>
          </span>

          {advice.headline && (
            <span className="block text-[13px] leading-relaxed text-ink-secondary">
              {advice.headline}
            </span>
          )}

          {/* Real figures, from the bucket the screen computed. */}
          <span className="mt-1.5 block text-[12px] tabular-nums text-ink-faint">
            {bucket.count} {bucket.count === 1 ? 'product' : 'products'} ·{' '}
            {money(bucket.spend, true)} spend · {money(bucket.revenue, true)} revenue ·{' '}
            {roiFmt(bucket.roi)}
          </span>
        </span>

        <ChevronDown
          className={cn(
            'mt-1 h-4 w-4 flex-shrink-0 text-ink-faint transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-line-subtle px-5 pb-5 pt-4 animate-fade-in">
          <ul className="space-y-2.5">
            {advice.actions.map((action) => (
              <li key={action} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-body">
                <ArrowRight className={cn('mt-1 h-3.5 w-3.5 flex-shrink-0', meta.textClass)} />
                <span>{action}</span>
              </li>
            ))}
          </ul>

          {advice.rationale && (
            <p className="mt-3.5 text-[12.5px] leading-relaxed text-ink-tertiary">
              {advice.rationale}
            </p>
          )}

          {named.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {named.map((product) => (
                <li
                  key={product.id}
                  title={`${product.title} · ${money(product.totalSpend)} spend · ${money(product.revenue)} revenue`}
                  className="rounded-chip border border-line-subtle bg-panel-sunken px-2.5 py-1.5 font-mono text-[11.5px] tabular-nums text-ink-body"
                >
                  {product.id} <span className="text-ink-faint">·</span>{' '}
                  <span className={meta.textClass}>{roiFmt(product.roi)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Matches the glyph each quadrant carries in the design. */
const GLYPHS: Record<QuadrantAdvice['quadrant'], string> = {
  champions: '★',
  contenders: '◆',
  cruisers: '●',
  casualties: '▲',
};
