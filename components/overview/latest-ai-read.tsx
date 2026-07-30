'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { QUADRANTS } from '@/lib/quadrants';
import { inAdviceOrder } from '@/lib/insights';
import { insightAge, useAiInsights } from '@/lib/insights-context';
import { cn } from '@/lib/utils';

/**
 * A teaser for the most recent analysis, linking to the full screen.
 *
 * Renders nothing until an analysis has actually run. The design mocks this up
 * with "2 days ago", which would need analyses to be stored — they are not, by
 * design — so the age shown is this session's run and says so plainly rather
 * than implying history that does not exist.
 */
export function LatestAiRead() {
  const { status, result, generatedAt } = useAiInsights();

  if (status === 'thinking') {
    return (
      <section className="rounded-card border border-brand/25 bg-brand-tint px-5 py-5">
        <p className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-brand-100">
          <Sparkles className="h-3.5 w-3.5" />
          Reading your catalogue…
        </p>
        <div className="space-y-2.5" aria-hidden>
          {[100, 82, 64].map((width, i) => (
            <div
              key={width}
              className="h-2.5 animate-shimmer rounded-chip bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]"
              style={{ width: `${width}%`, animationDelay: `${i * 0.14}s` }}
            />
          ))}
        </div>
      </section>
    );
  }

  if (!result) return null;

  const ordered = inAdviceOrder(result.quadrants);
  const age = insightAge(generatedAt);

  return (
    <section className="rounded-card border border-brand/25 bg-brand-tint px-5 py-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-chip bg-brand-gradient text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-[14.5px] font-semibold text-ink">Latest AI read</h2>
        </span>
        {age && <span className="text-[11.5px] text-ink-muted">{age}</span>}
      </header>

      <p className="mb-4 text-[13.5px] leading-relaxed text-brand-100">{result.headline}</p>

      <ul className="mb-4 space-y-2">
        {ordered.map((advice) => {
          const meta = QUADRANTS[advice.quadrant];
          return (
            <li key={advice.quadrant} className="flex items-start gap-2.5 text-[12.5px]">
              <span className={cn('mt-px flex-shrink-0 font-semibold', meta.textClass)} aria-hidden>
                {meta.label.charAt(0)}
              </span>
              <span className="leading-relaxed text-ink-secondary">{advice.title}</span>
            </li>
          );
        })}
      </ul>

      <Link
        href="/insights"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-200 transition-colors hover:text-brand-100"
      >
        Open full analysis
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>

      <p className="mt-3 border-t border-brand/20 pt-2.5 text-[11px] leading-relaxed text-ink-faint">
        This session only — analyses are not stored, so it clears when you reload.
      </p>
    </section>
  );
}
