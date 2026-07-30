'use client';

import { Check, Loader2 } from 'lucide-react';
import type { MergeStatus } from '@/hooks/use-merge';
import { cn } from '@/lib/utils';

/**
 * The four stages the backend actually performs inside POST /api/analyse,
 * described accurately against backend/data_cleaner.py and analytics.py.
 */
const STEPS = [
  { label: 'Clean', detail: 'Strip BOM, drop Total rows, recover encodings, parse lakh commas' },
  { label: 'Normalise', detail: 'Unify product IDs, month labels and numeric formats' },
  { label: 'Merge', detail: 'Outer-join Meta ↔ Shopify ↔ Google on product ID' },
  { label: 'Calculate', detail: 'Spend, revenue, ROI, CTR and CPM per product' },
] as const;

/**
 * Progress is deliberately indeterminate.
 *
 * `/api/analyse` is a single request that performs all four stages server-side
 * and reports nothing until it returns, so there is no real per-stage progress
 * to show. Animating fake percentages would claim "Merge complete · 84%" for a
 * request that may still fail, so the whole pipeline reads as in-flight until
 * the response lands and every stage resolves together.
 */
export function MergePipeline({ status }: { status: MergeStatus }) {
  if (status !== 'running' && status !== 'done') return null;

  const running = status === 'running';

  return (
    <section className="rounded-card border border-line bg-panel px-6 py-6 animate-fade-up">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-ink">Merge pipeline</h2>
        <span className="text-[12.5px] text-ink-secondary">
          {running ? 'Processing on the server…' : 'All stages complete'}
        </span>
      </div>

      {/* Indeterminate while in flight, solid once resolved. */}
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-panel-sunken">
        {running ? (
          <div
            className="h-full w-full animate-shimmer rounded-full"
            style={{
              backgroundImage:
                'linear-gradient(90deg, transparent 0%, var(--brand) 35%, var(--brand-alt) 65%, transparent 100%)',
              backgroundSize: '400px 100%',
              backgroundRepeat: 'repeat-x',
            }}
          />
        ) : (
          <div className="h-full w-full rounded-full bg-brand-gradient" />
        )}
      </div>

      <ol className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.label}
            className={cn(
              'rounded-panel border p-4 transition-colors duration-300',
              running ? 'border-line-strong bg-brand-tint/40' : 'border-ok/25 bg-ok-tint',
            )}
          >
            <div className="mb-2 flex items-center gap-2.5">
              <span
                className={cn(
                  'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[10px]',
                  running ? 'bg-brand-tint-strong text-brand-200' : 'bg-ok-tint text-ok',
                )}
              >
                {running ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                )}
              </span>
              <span className="text-[13px] font-medium text-ink">
                {index + 1}. {step.label}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-muted">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
