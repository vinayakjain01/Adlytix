'use client';

import type { QuadrantBucket, QuadrantKey, Thresholds } from '@/lib/quadrants';
import { QUADRANT_ORDER } from '@/lib/quadrants';
import { inr, num, roi } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** Tick marks preserved from the original panel: 0 / Avg / 200 / 300. */
const TICKS = [0, 100, 200, 300];

function ThresholdSlider({
  label, pct, value, average, onChange,
}: {
  label: string;
  pct: number;
  value: number;
  average: number;
  onChange: (pct: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-body">{label}</span>
        <span className="text-right">
          <span className="text-[12.5px] font-semibold text-brand-200 tabular-nums">
            {inr(value, true)}
          </span>
          <span className="ml-1.5 text-[11px] text-ink-muted tabular-nums">({pct}%)</span>
        </span>
      </div>

      {/* Range kept at 0–300 step 5, matching the original — the prototype
          narrowed it to 20–200, which would remove reachable scenarios. */}
      <input
        type="range"
        min={0}
        max={300}
        step={5}
        value={pct}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`${label} as a percentage of the average`}
        className="w-full"
      />

      <div className="mt-1 flex justify-between">
        {TICKS.map((tick) => (
          <span
            key={tick}
            className={cn(
              'text-[10px] tabular-nums',
              pct === tick ? 'font-semibold text-brand-200' : 'text-ink-faint',
            )}
          >
            {tick === 100 ? 'Avg' : `${tick}%`}
          </span>
        ))}
      </div>

      <p className="mt-1.5 text-[11px] text-ink-muted tabular-nums">
        Average: {inr(average, true)}
      </p>
    </div>
  );
}

export function ThresholdPanel({
  thresholds, spendPct, revPct, buckets, monthLabel,
  onSpendPctChange, onRevPctChange, onReset,
}: {
  thresholds: Thresholds;
  spendPct: number;
  revPct: number;
  buckets: Record<QuadrantKey, QuadrantBucket>;
  monthLabel: string | null;
  onSpendPctChange: (pct: number) => void;
  onRevPctChange: (pct: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Axis summary */}
      <section className="rounded-panel border border-line bg-panel p-4">
        <h2 className="mb-3.5 text-[10.5px] font-semibold tracking-[0.12em] text-ink-muted">
          QUADRANT AXIS THRESHOLDS
        </h2>

        <div className="grid grid-cols-2 gap-4">
          {[
            { axis: 'X-AXIS — TOTAL SPEND', value: thresholds.spend, average: thresholds.avgSpend },
            { axis: 'Y-AXIS — REVENUE', value: thresholds.revenue, average: thresholds.avgRevenue },
          ].map((axis) => (
            <div key={axis.axis} className="min-w-0">
              <p className="mb-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-ink-muted">
                {axis.axis}
              </p>
              <p className="text-[11.5px] text-ink-secondary tabular-nums">
                Low &lt; {inr(axis.value, true)}
              </p>
              <p className="text-[11.5px] font-semibold text-brand-200 tabular-nums">
                High ≥ {inr(axis.value, true)}
              </p>
              <p className="mt-1 text-[10.5px] text-ink-muted tabular-nums">
                Avg: {inr(axis.average, true)}
              </p>
            </div>
          ))}
        </div>

        {monthLabel && (
          <div className="mt-3 flex items-baseline gap-2 border-t border-line-subtle pt-2.5">
            <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
              MONTHS
            </span>
            <span className="text-[11.5px] font-semibold text-brand-200">{monthLabel}</span>
          </div>
        )}
      </section>

      {/* Sliders */}
      <section className="rounded-panel border border-line bg-panel p-4">
        <h2 className="mb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-ink-muted">
          ADJUST THRESHOLDS
        </h2>
        <p className="mb-5 text-[11.5px] leading-relaxed text-ink-muted">
          100% = average of the selected data. Range 0–300%. Updates live.
        </p>

        <div className="space-y-6">
          <ThresholdSlider
            label="Spend cut-off"
            pct={spendPct}
            value={thresholds.spend}
            average={thresholds.avgSpend}
            onChange={onSpendPctChange}
          />
          <ThresholdSlider
            label="Revenue cut-off"
            pct={revPct}
            value={thresholds.revenue}
            average={thresholds.avgRevenue}
            onChange={onRevPctChange}
          />

          <button
            type="button"
            onClick={onReset}
            className="text-[12.5px] text-brand-300 transition-colors hover:text-brand-100"
          >
            Reset to average (100%)
          </button>
        </div>
      </section>

      {/* Counts */}
      <section className="rounded-panel border border-line bg-panel p-4">
        <h2 className="mb-3.5 text-[10.5px] font-semibold tracking-[0.12em] text-ink-muted">
          QUADRANT COUNTS
        </h2>
        <ul className="space-y-2.5">
          {QUADRANT_ORDER.map((key) => {
            const bucket = buckets[key];
            return (
              <li key={key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] text-ink-body">
                  <span className={cn('h-2 w-2 rounded-full', bucket.meta.dotClass)} />
                  {bucket.meta.label}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-[13px] font-medium text-ink tabular-nums">
                    {num(bucket.count)}
                  </span>
                  <span className={cn('w-12 text-right text-[11.5px] tabular-nums', bucket.meta.textClass)}>
                    {roi(bucket.roi)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="px-1 text-[11.5px] leading-relaxed text-ink-muted">
        Products are classified by spend against revenue, relative to the average of the selected
        months. Adjust the sliders to find the right cut-offs for your catalogue.
      </p>
    </div>
  );
}
