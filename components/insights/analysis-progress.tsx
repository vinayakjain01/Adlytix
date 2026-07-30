'use client';

import { Check, Sparkles } from 'lucide-react';
import { AI_STEPS, STEPS_DONE_LOCALLY } from '@/lib/insights-context';
import { cn } from '@/lib/utils';

/**
 * What is happening while an analysis runs.
 *
 * The first two steps are genuinely complete before the request leaves the
 * browser — the brief is built and the products are bucketed here — so they show
 * a tick. The remaining two happen inside one Gemini call that reports no
 * progress, so the third reads as in flight and the fourth as pending. Nothing
 * advances on a timer: a checklist that ticks itself on a stopwatch claims work
 * that may not have happened.
 */
export function AnalysisProgress({ productCount, monthLabel }: {
  productCount: number;
  monthLabel: string | null;
}) {
  return (
    <section className="rounded-card border border-line bg-panel px-6 py-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-chip bg-brand-gradient text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <h2 className="text-[15.5px] font-semibold text-ink">Analysing your catalogue</h2>
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-brand-300 animate-pulse-dot"
              style={{ animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </span>
      </div>

      <ol className="space-y-3">
        {AI_STEPS.map((step, index) => {
          const complete = index < STEPS_DONE_LOCALLY;
          const active = index === STEPS_DONE_LOCALLY;

          // Only the first step can state a scale, because it is the one that
          // actually read the data.
          const label =
            index === 0
              ? `${step} (${productCount.toLocaleString('en-IN')} products${monthLabel ? `, ${monthLabel.toLowerCase()}` : ''})`
              : step;

          return (
            <li key={step} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px]',
                  complete && 'bg-ok-tint text-ok',
                  active && 'bg-brand-tint text-brand-200',
                  !complete && !active && 'bg-panel-sunken text-ink-disabled',
                )}
                aria-hidden
              >
                {complete ? <Check className="h-3 w-3" /> : active ? '•' : ''}
              </span>
              <span
                className={cn(
                  'text-[13.5px]',
                  complete && 'text-ink-secondary',
                  active && 'font-medium text-ink',
                  !complete && !active && 'text-ink-disabled',
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 space-y-2.5" aria-hidden>
        {[100, 88, 72].map((width, i) => (
          <div
            key={width}
            className="h-2.5 animate-shimmer rounded-chip bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]"
            style={{ width: `${width}%`, animationDelay: `${i * 0.14}s` }}
          />
        ))}
      </div>

      <span className="sr-only" role="status">
        Generating recommendations. This usually takes a few seconds.
      </span>
    </section>
  );
}
