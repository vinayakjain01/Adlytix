'use client';

import { inr, num, roi } from '@/lib/formatters';
import type { KpiValue } from '@/lib/product-metrics';
import { cn } from '@/lib/utils';

export function formatKpi({ value, format }: Pick<KpiValue, 'value' | 'format'>): string {
  switch (format) {
    case 'currency': return inr(value, true);
    case 'roi':      return roi(value);
    case 'number':   return num(value);
  }
}

export interface StatCardData extends KpiValue {
  /**
   * One value per selected month, chronological. Drives the sparkline.
   * Real data only — never a decorative path.
   */
  series?: number[];
  /** Month-over-month change, or null when there is nothing to compare. */
  delta?: number | null;
  /** e.g. "vs March 2026" — shown as the delta's tooltip. */
  deltaLabel?: string;
  /**
   * Whether a rise is good. Spend rising is not an improvement, so those
   * cards stay neutral instead of being painted red or green.
   */
  deltaDirection?: 'up-is-good' | 'neutral';
}

const SPARK_WIDTH = 62;
const SPARK_HEIGHT = 22;

/** Normalises a series into an SVG polyline. Needs at least two points. */
function sparkPoints(series: number[]): string | null {
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const stepX = SPARK_WIDTH / (series.length - 1);
  const pad = 2;
  const usable = SPARK_HEIGHT - pad * 2;

  return series
    .map((value, i) => {
      // A flat series sits on the mid-line rather than dividing by zero.
      const ratio = span === 0 ? 0.5 : (value - min) / span;
      const y = pad + (1 - ratio) * usable;
      return `${(i * stepX).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function Sparkline({ series, tone }: { series: number[]; tone: 'good' | 'bad' | 'neutral' }) {
  const points = sparkPoints(series);
  if (!points) return null;

  const stroke =
    tone === 'good' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : 'var(--brand-300)';

  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      className="flex-shrink-0"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StatCard({
  label, value, tone = 'default', series, delta, deltaLabel, deltaDirection = 'neutral', className,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
  className?: string;
} & Pick<StatCardData, 'series' | 'delta' | 'deltaLabel' | 'deltaDirection'>) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const rising = hasDelta && (delta as number) > 0;

  const deltaTone: 'good' | 'bad' | 'neutral' =
    !hasDelta || deltaDirection === 'neutral'
      ? 'neutral'
      : rising
        ? 'good'
        : 'bad';

  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-panel border border-line bg-panel p-4',
        'transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover',
        className,
      )}
    >
      <p className="mb-2 truncate text-[10.5px] font-semibold tracking-[0.1em] text-ink-muted">
        {label}
      </p>
      <p
        className={cn(
          'truncate text-[23px] font-semibold leading-tight tracking-[-0.03em] tabular-nums',
          tone === 'good' && 'text-ok',
          tone === 'bad' && 'text-bad',
        )}
      >
        {value}
      </p>

      {(hasDelta || (series && series.length > 1)) && (
        <div className="mt-2.5 flex items-end justify-between gap-2">
          {hasDelta ? (
            <span
              title={deltaLabel}
              className={cn(
                'truncate text-[11.5px] font-medium tabular-nums',
                deltaTone === 'good' && 'text-ok',
                deltaTone === 'bad' && 'text-bad',
                deltaTone === 'neutral' && 'text-ink-tertiary',
              )}
            >
              {rising ? '↑' : '↓'} {Math.abs(delta as number).toFixed(1)}%
            </span>
          ) : (
            <span />
          )}
          {series && <Sparkline series={series} tone={deltaTone} />}
        </div>
      )}
    </div>
  );
}

/**
 * KPI row.
 *
 * Sparklines and deltas are computed from the real per-month series for the
 * selected months. When only one month is selected there is nothing to compare
 * or plot, so both are omitted rather than fabricated — the previous KpiCard
 * drew one of three hardcoded SVG paths regardless of the data.
 */
export function StatStrip({ cards, className }: { cards: StatCardData[]; className?: string }) {
  if (!cards.length) return null;

  return (
    <div className={cn('grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6', className)}>
      {cards.map((card) => (
        <StatCard
          key={card.label}
          label={card.label}
          value={formatKpi(card)}
          tone={card.label === 'OVERALL ROI' && card.value >= 3 ? 'good' : 'default'}
          series={card.series}
          delta={card.delta}
          deltaLabel={card.deltaLabel}
          deltaDirection={card.deltaDirection}
        />
      ))}
    </div>
  );
}
