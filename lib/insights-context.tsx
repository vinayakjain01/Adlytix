'use client';

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { useApp } from './context';
import { bucketByQuadrant, computeThresholds } from './quadrants';
import { computeTotals } from './product-metrics';
import { buildBrief, requestInsights, type Insights } from './insights';
import { track } from './analytics/client';
import { errorMessage } from './errors';

/**
 * One AI analysis, shared by every screen that shows it.
 *
 * The result has three consumers — the Overview teaser, the sidebar badge and
 * the insights screen — so it cannot live in a component's own state. Running it
 * from Overview and then navigating to the insights screen must show the same
 * answer, not trigger a second billed call.
 *
 * Scope is the session. The design mocks up "Latest AI read · 2 days ago", but
 * analyses are not stored anywhere (that was a deliberate decision: accounts are
 * the only thing this app persists), so the age shown is the age of *this*
 * session's run and a reload clears it. Showing "2 days ago" without a stored
 * analysis to back it would be an invented timestamp.
 */

export type AiStatus = 'idle' | 'thinking' | 'done' | 'error';

/**
 * The four steps the design lists while an analysis runs.
 *
 * The first two are genuinely finished before the request goes out — the brief is
 * assembled and the products are bucketed client-side — so they tick for real.
 * The last two are what Gemini does inside one HTTP call, which reports no
 * progress, so the third is shown as in flight and the fourth as pending. No
 * timer advances anything: a progress bar that moves on a stopwatch is a lie
 * about work that has not happened.
 */
export const AI_STEPS = [
  'Reading merged dataset',
  'Classifying against 4C thresholds',
  'Ranking scale and cut candidates',
  'Drafting recommendations',
] as const;

/** Index of the first step that is not yet known to be complete. */
export const STEPS_DONE_LOCALLY = 2;

interface AiState {
  status: AiStatus;
  result: Insights | null;
  error: string | null;
  /** Client clock at the moment the result arrived; null until then. */
  generatedAt: number | null;
  /** True when there is merged data to analyse. */
  canRun: boolean;
  /** Products and months the analysis covered, for the meta line. */
  scope: { products: number; monthLabel: string | null };
  run: () => Promise<void>;
}

const AiContext = createContext<AiState | null>(null);

export function AiInsightsProvider({ children }: { children: ReactNode }) {
  const { aggregatedProducts, allMonths, selectedMonths, currency } = useApp();

  const [status, setStatus] = useState<AiStatus>('idle');
  const [result, setResult] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);

  const monthLabel = useMemo(() => {
    if (allMonths.length === 0) return null;
    return selectedMonths.size === allMonths.length
      ? `All ${allMonths.length} months`
      : `${selectedMonths.size} of ${allMonths.length} months`;
  }, [allMonths.length, selectedMonths.size]);

  const canRun = aggregatedProducts.length > 0;

  const run = useCallback(async () => {
    if (!canRun || status === 'thinking') return;

    setStatus('thinking');
    setError(null);
    const startedAt = Date.now();

    // The analysis is of the catalogue at its natural cut-offs. The quadrant
    // screen's sliders are an exploration tool for that screen; feeding a
    // half-dragged slider position into the advice would make the same data
    // produce different recommendations depending on where a control was left.
    const thresholds = computeThresholds(aggregatedProducts, 100, 100);
    const buckets = bucketByQuadrant(aggregatedProducts, thresholds.spend, thresholds.revenue);
    const totals = computeTotals(aggregatedProducts);
    const brief = buildBrief(buckets, thresholds, totals, currency, monthLabel);

    track('ai_analysis_requested', {
      product_count: totals.count,
      populated_quadrants: brief.quadrants.filter((q) => q.productCount > 0).length,
      currency,
    });

    try {
      const insights = await requestInsights(brief);
      setResult(insights);
      setGeneratedAt(Date.now());
      setStatus('done');
      track('ai_analysis_completed', {
        model: insights.model,
        cached: insights.cached,
        quadrants_returned: insights.quadrants.length,
        dropped_product_ids: insights.droppedProductIds,
        duration_ms: Date.now() - startedAt,
      });
    } catch (err) {
      const message = errorMessage(err, 'Could not generate insights.');
      setError(message);
      setStatus('error');
      track('ai_analysis_failed', { reason: message, duration_ms: Date.now() - startedAt });
    }
  }, [canRun, status, aggregatedProducts, currency, monthLabel]);

  const value = useMemo<AiState>(
    () => ({
      status,
      result,
      error,
      generatedAt,
      canRun,
      scope: { products: aggregatedProducts.length, monthLabel },
      run,
    }),
    [status, result, error, generatedAt, canRun, aggregatedProducts.length, monthLabel, run],
  );

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAiInsights(): AiState {
  const context = useContext(AiContext);
  if (!context) throw new Error('useAiInsights must be used inside <AiInsightsProvider>');
  return context;
}

/** "just now", "4 min ago" — the age of this session's run. */
export function insightAge(generatedAt: number | null, now = Date.now()): string | null {
  if (generatedAt === null) return null;
  const seconds = Math.max(0, Math.round((now - generatedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}
