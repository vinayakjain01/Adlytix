'use client';

import { useMemo } from 'react';
import type { NormProduct } from '@/lib/context';
import { classify, QUADRANTS, type QuadrantKey } from '@/lib/quadrants';
import { inr, roi } from '@/lib/formatters';
import { useMoney } from '@/hooks/use-money';
import { cn } from '@/lib/utils';

/**
 * Spend (x) against revenue (y), one dot per product, coloured by quadrant.
 *
 * Both axes use a power scale (^0.55) rather than a linear one: ad-spend
 * catalogues are heavily long-tailed, and on a linear scale a single big
 * spender squashes every other product into the bottom-left corner. The dots
 * are positioned for legibility — the quadrant a dot sits in is always decided
 * by classify(), never by its plotted position.
 */
const CURVE = 0.55;

/**
 * A value safe to plot: finite and not negative.
 *
 * Revenue is legitimately negative when a product's returns exceed its sales in
 * the period, and `Math.pow(negative, 0.5)` is NaN — which reached the DOM as
 * `width: NaN` and made React reject the style outright. Spend can also arrive
 * non-numeric if a cell survives the cleaner unparsed.
 *
 * Clamping affects the dot's POSITION and SIZE only. The tooltip below reports
 * the real figure, and quadrant membership comes from classify() on the true
 * value — so a refund-heavy product still lands in the correct quadrant and
 * still reads as negative when hovered. It simply sits on the axis floor
 * instead of vanishing.
 */
function plottable(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Largest plottable value in the set, floored at 1 so it can be divided by.
 *
 * A reduce rather than `Math.max(...array)`: spreading a few thousand products
 * into an argument list overflows the call stack, and a real catalogue is
 * exactly that size.
 */
function maxOf(products: NormProduct[], pick: (p: NormProduct) => number): number {
  return products.reduce((largest, p) => Math.max(largest, plottable(pick(p))), 1);
}

interface Dot {
  id: string;
  x: number;
  y: number;
  size: number;
  quadrant: QuadrantKey;
  tooltip: string;
}

export function QuadrantScatter({
  products,
  spendThreshold,
  revenueThreshold,
}: {
  products: NormProduct[];
  spendThreshold: number;
  revenueThreshold: number;
}) {
  const money = useMoney();

  const { dots, thresholdX, thresholdY } = useMemo(() => {
    const maxSpend = maxOf(products, (p) => p.totalSpend);
    const maxRevenue = maxOf(products, (p) => p.revenue);

    const scale = (value: number, max: number, from: number, span: number) =>
      from + Math.min(1, Math.pow(plottable(value) / max, CURVE)) * span;

    return {
      dots: products.map((product): Dot => {
        // Classified on the true values, never the clamped ones.
        const quadrant = classify(product, spendThreshold, revenueThreshold);
        return {
          id: product.id,
          x: scale(product.totalSpend, maxSpend, 4, 90),
          y: scale(product.revenue, maxRevenue, 5, 86),
          size: 6 + Math.pow(plottable(product.revenue) / maxRevenue, 0.5) * 9,
          quadrant,
          // Reports the real figures, including a negative revenue.
          tooltip: `${product.title} · spend ${money(product.totalSpend, true)} · revenue ${money(product.revenue, true)} · ${roi(product.roi)}`,
        };
      }),
      // Where the cut-offs land on the same curve, so the guides match the dots.
      thresholdX: scale(spendThreshold, maxSpend, 4, 90),
      thresholdY: scale(revenueThreshold, maxRevenue, 5, 86),
    };
  }, [products, spendThreshold, revenueThreshold, money]);

  const corners: { key: QuadrantKey; position: string; align: string }[] = [
    { key: 'champions', position: 'left-3.5 top-3', align: 'text-left' },
    { key: 'contenders', position: 'right-3.5 top-3', align: 'text-right' },
    { key: 'cruisers', position: 'left-3.5 bottom-3', align: 'text-left' },
    { key: 'casualties', position: 'right-3.5 bottom-3', align: 'text-right' },
  ];

  return (
    <section className="rounded-card border border-line bg-panel px-6 py-5">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5">
        <h2 className="text-[15px] font-medium text-ink">Distribution</h2>
        <p className="text-[12px] text-ink-muted tabular-nums">
          cut-offs · {inr(spendThreshold, true)} spend / {inr(revenueThreshold, true)} revenue
        </p>
      </header>

      <div className="flex gap-3">
        <div className="flex w-5 items-center justify-center">
          <span className="whitespace-nowrap text-[10.5px] font-semibold tracking-[0.12em] text-ink-muted [writing-mode:vertical-rl] rotate-180">
            REVENUE →
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="img"
            aria-label={`Scatter plot of ${products.length} products by total spend and revenue, divided into the four 4C quadrants`}
            className="relative h-[330px] overflow-hidden rounded-control border border-line-subtle bg-panel-sunken"
          >
            {/* Quadrant fields, positioned at the real cut-offs */}
            <div
              className="absolute left-0 top-0 bg-q-champions-tint/40"
              style={{ width: `${thresholdX}%`, height: `${100 - thresholdY}%` }}
            />
            <div
              className="absolute right-0 top-0 bg-q-contenders-tint/40"
              style={{ width: `${100 - thresholdX}%`, height: `${100 - thresholdY}%` }}
            />
            <div
              className="absolute bottom-0 left-0 bg-q-cruisers-tint/25"
              style={{ width: `${thresholdX}%`, height: `${thresholdY}%` }}
            />
            <div
              className="absolute bottom-0 right-0 bg-q-casualties-tint/40"
              style={{ width: `${100 - thresholdX}%`, height: `${thresholdY}%` }}
            />

            {/* Cut-off guides */}
            <div
              className="absolute top-0 h-full border-l border-dashed border-line-strong"
              style={{ left: `${thresholdX}%` }}
            />
            <div
              className="absolute left-0 w-full border-t border-dashed border-line-strong"
              style={{ bottom: `${thresholdY}%` }}
            />

            {corners.map(({ key, position, align }) => (
              <div
                key={key}
                className={cn(
                  'pointer-events-none absolute max-w-[44%] text-[10.5px] font-semibold leading-tight tracking-[0.06em]',
                  position,
                  align,
                  QUADRANTS[key].textClass,
                )}
              >
                {QUADRANTS[key].label.toUpperCase()}
                <br />
                <span className="opacity-70">{QUADRANTS[key].tag.toUpperCase()}</span>
              </div>
            ))}

            {dots.map((dot) => (
              <div
                key={dot.id}
                title={dot.tooltip}
                className={cn(
                  'absolute -translate-x-1/2 translate-y-1/2 rounded-full transition-all duration-500 ease-[cubic-bezier(.4,0,.2,1)] hover:brightness-150',
                  QUADRANTS[dot.quadrant].dotClass,
                )}
                style={{
                  left: `${dot.x}%`,
                  bottom: `${dot.y}%`,
                  width: dot.size,
                  height: dot.size,
                }}
              />
            ))}
          </div>

          <p className="mt-3 text-center text-[10.5px] font-semibold tracking-[0.12em] text-ink-muted">
            TOTAL SPEND →
          </p>
        </div>
      </div>

      <p className="mt-4 border-t border-line-subtle pt-3.5 text-[11.5px] leading-relaxed text-ink-muted">
        Dot size reflects revenue. Both axes are compressed so a few high spenders don&apos;t
        flatten the rest of the catalogue — quadrant membership is always decided by the
        cut-offs, not by a dot&apos;s position.
      </p>
    </section>
  );
}
