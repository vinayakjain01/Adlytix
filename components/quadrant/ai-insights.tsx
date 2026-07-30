'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { BUTTON_GHOST, BUTTON_PRIMARY } from '@/components/ui/form-field';
import { inr, roi as roiFmt } from '@/lib/formatters';
import { QUADRANTS, type QuadrantBucket, type QuadrantKey } from '@/lib/quadrants';
import type { NormProduct } from '@/lib/context';
import { buildBrief, requestInsights, type Insights } from '@/lib/insights';
import { track } from '@/lib/analytics/client';
import type { CurrencyCode } from '@/lib/currency';
import { cn } from '@/lib/utils';

interface AiInsightsProps {
  buckets: Record<QuadrantKey, QuadrantBucket>;
  products: NormProduct[];
  thresholds: { spend: number; revenue: number };
  totals: { count: number; totalSpend: number; revenue: number; roi: number };
  currency: CurrencyCode;
  monthLabel: string | null;
}

/**
 * Per-quadrant recommendations from Gemini.
 *
 * Every figure on this card is read from `products` — the same rows the table
 * and the scatter render. The model supplies only prose and product IDs, so a
 * number it invented could not reach the screen even if it produced one.
 *
 * Replaces the original component, which rendered a button wired to nothing and
 * an empty state that could never change.
 */
export function AiInsights({
  buckets, products, thresholds, totals, currency, monthLabel,
}: AiInsightsProps) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Product lookup, so a returned ID becomes real figures rather than a label.
  const byId = useMemo(() => {
    const map = new Map<string, NormProduct>();
    for (const product of products) map.set(product.id, product);
    return map;
  }, [products]);

  const hasProducts = totals.count > 0;

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const startedAt = Date.now();
    const brief = buildBrief(buckets, thresholds, totals, currency, monthLabel);

    track('ai_analysis_requested', {
      product_count: totals.count,
      populated_quadrants: brief.quadrants.filter((q) => q.productCount > 0).length,
      currency,
    });

    try {
      const result = await requestInsights(brief);
      setInsights(result);
      track('ai_analysis_completed', {
        model: result.model,
        cached: result.cached,
        quadrants_returned: result.quadrants.length,
        dropped_product_ids: result.droppedProductIds,
        duration_ms: Date.now() - startedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not generate insights.';
      setError(message);
      track('ai_analysis_failed', { reason: message, duration_ms: Date.now() - startedAt });
    } finally {
      setLoading(false);
    }
  }, [buckets, thresholds, totals, currency, monthLabel]);

  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-6 py-5">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-brand-300" />
            Per-quadrant recommendations
          </h2>
          <p className="text-[12.5px] text-ink-muted">
            {insights ? (
              <>
                {insights.model}
                {insights.cached && ' · reused from the last run'} · figures below are your own, not
                the model&rsquo;s
              </>
            ) : (
              'Gemini reads your quadrant totals and returns actions. It never writes the numbers.'
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !hasProducts}
          className={insights ? cn(BUTTON_GHOST, 'h-9') : BUTTON_PRIMARY}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analysing…
            </>
          ) : insights ? (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Run again
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Generate AI analysis
            </>
          )}
        </button>
      </header>

      <div className="px-6 py-5">
        {error && (
          <div
            role="alert"
            className="flex gap-2.5 rounded-control border border-bad-line bg-bad-tint px-3.5 py-3 text-[13px] leading-relaxed text-bad-soft animate-fade-in"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!error && !insights && !loading && (
          <p className="mx-auto max-w-lg py-8 text-center text-[13.5px] leading-relaxed text-ink-tertiary">
            {hasProducts
              ? 'Generate recommendations for each quadrant. Every product it names is checked against your data before it reaches this screen.'
              : 'Merge your exports first — there are no products in the current view to analyse.'}
          </p>
        )}

        {loading && !insights && (
          <div className="space-y-3 py-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[74px] animate-shimmer rounded-panel bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        )}

        {insights && !loading && (
          <div className="animate-fade-up">
            {insights.headline && (
              <p className="mb-4 rounded-panel border border-brand/25 bg-brand-tint px-4 py-3 text-[14px] leading-relaxed text-brand-100">
                {insights.headline}
              </p>
            )}

            <div className="space-y-3">
              {insights.quadrants.map((advice) => {
                const meta = QUADRANTS[advice.quadrant];
                const bucket = buckets[advice.quadrant];
                const named = advice.productIds
                  .map((id) => byId.get(id))
                  .filter((p): p is NormProduct => p !== undefined);

                return (
                  <article
                    key={advice.quadrant}
                    className={cn(
                      'rounded-panel border border-line border-l-[3px] bg-panel-sunken px-4 py-3.5',
                      meta.borderClass,
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2.5">
                      <span className={cn('text-[13px] font-semibold', meta.textClass)}>
                        {meta.label}
                      </span>
                      {/* Read from the bucket, never from the model. */}
                      <span className="text-[12px] text-ink-faint">
                        {bucket.count} {bucket.count === 1 ? 'product' : 'products'} ·{' '}
                        {inr(bucket.spend, true)} spend · {roiFmt(bucket.roi)}
                      </span>
                    </div>

                    <p className="mb-1.5 text-[13.5px] leading-relaxed text-ink">{advice.action}</p>
                    <p className="text-[12.5px] leading-relaxed text-ink-tertiary">
                      {advice.rationale}
                    </p>

                    {named.length > 0 && (
                      <ul className="mt-2.5 space-y-1 border-t border-line-subtle pt-2.5">
                        {named.map((product) => (
                          <li
                            key={product.id}
                            className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]"
                          >
                            <span className="min-w-0 truncate text-ink-body">
                              <span className="font-mono text-ink-faint">{product.id}</span>{' '}
                              {product.title}
                            </span>
                            <span className="flex-shrink-0 tabular-nums text-ink-muted">
                              {inr(product.totalSpend, true)} → {inr(product.revenue, true)} ·{' '}
                              {roiFmt(product.roi)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>

            {insights.watchOuts.length > 0 && (
              <div className="mt-4 rounded-panel border border-line-subtle bg-panel-sunken px-4 py-3">
                <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-ink-faint">
                  WATCH OUT
                </p>
                <ul className="space-y-1">
                  {insights.watchOuts.map((item) => (
                    <li key={item} className="text-[12.5px] leading-relaxed text-ink-tertiary">
                      · {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {insights.droppedProductIds > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-warn">
                {insights.droppedProductIds} product{' '}
                {insights.droppedProductIds === 1 ? 'reference was' : 'references were'} removed
                because {insights.droppedProductIds === 1 ? 'it did' : 'they did'} not match any
                product in your data.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
