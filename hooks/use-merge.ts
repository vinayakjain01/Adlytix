'use client';

import { useCallback, useState } from 'react';
import { useApp, type IncomingRow } from '@/lib/context';
import { useAuth } from '@/lib/auth-context';
import { mergeFiles } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { track } from '@/lib/analytics/client';
import { errorMessage } from '@/lib/errors';

export type MergeStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * Owns the merge round-trip.
 *
 * The body of `run()` is lifted verbatim from the original
 * app/product-analysis/page.tsx handler — same endpoint, same response
 * unwrapping, same summary fallbacks, same runId format — so the numbers this
 * produces are identical to before. Extracted only so the Sources screen and
 * the product table cannot drift apart.
 */
export function useMerge() {
  const {
    metaFile, shopifyFile, googleFile, discountFile,
    mergedData, mergedSummary, setMergedResult,
    baseCurrency, sourceCurrencies, setMergeCurrency,
  } = useApp();

  const { refresh: refreshSession } = useAuth();

  const [status, setStatus] = useState<MergeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const metaF = metaFile?.file ?? null;
  const shopF = shopifyFile?.file ?? null;
  const gooF = googleFile?.file ?? null;
  const discF = discountFile?.file ?? null;

  const canMerge = metaF !== null && shopF !== null;
  const fileCount = [metaF, shopF, gooF, discF].filter(Boolean).length;
  const isMerged = mergedData !== null && mergedSummary !== null;

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(async () => {
    if (!canMerge || !metaF || !shopF) return;
    setStatus('running');
    setError(null);

    const startedAt = Date.now();
    const sourceCurrencyList = [sourceCurrencies.meta, sourceCurrencies.shopify]
      .concat(gooF ? [sourceCurrencies.google] : []);

    track('merge_started', {
      source_count: fileCount,
      has_google: gooF !== null,
      has_discount: discF !== null,
      base_currency: baseCurrency,
      needs_conversion: sourceCurrencyList.some((code) => code !== baseCurrency),
    });

    try {
      const result = await mergeFiles(metaF, shopF, gooF, discF, {
        base: baseCurrency,
        meta: sourceCurrencies.meta,
        shopify: sourceCurrencies.shopify,
        google: sourceCurrencies.google,
      });

      // Record what the server actually applied, so the UI can state the
      // currency of the figures it is showing instead of assuming.
      setMergeCurrency(result.currency ?? null);
      const products = result.products ?? result.data ?? [];
      const summary = result.summary ?? {};
      const warns = result.warnings ?? [];

      // Compute totals from raw rows as fallback if API summary has zeros
      const calcTotalSpend = products.reduce((s: number, p: IncomingRow) => s + Number(p['Total Spend']     ?? p.totalSpend  ?? 0), 0);
      const calcTotalRev   = products.reduce((s: number, p: IncomingRow) => s + Number(p['Shopify Revenue'] ?? p.revenue     ?? 0), 0);
      const calcMetaSpend  = products.reduce((s: number, p: IncomingRow) => s + Number(p['Meta Spend']      ?? p.metaSpend   ?? 0), 0);
      const calcGoogleCost = products.reduce((s: number, p: IncomingRow) => s + Number(p['Google Cost']     ?? p.googleCost  ?? 0), 0);

      setMergedResult(
        products,
        {
          products:    summary.products    ?? products.length,
          total_spend: summary.total_spend || calcTotalSpend,
          total_rev:   summary.total_rev   || calcTotalRev,
          roi:         summary.roi         || (calcTotalSpend > 0 ? calcTotalRev / calcTotalSpend : 0),
          meta_spend:  summary.meta_spend  || calcMetaSpend,
          google_cost: summary.google_cost || calcGoogleCost,
          lpv:         summary.lpv         ?? 0,
        },
        // The API returns `hasMonth`/`hasGoogle`; the original code read the
        // snake_case keys, so these flags were always false. Both spellings are
        // accepted here, falling back to the previous behaviour. Neither flag is
        // read by any screen today (month detection derives from the rows
        // themselves in lib/context.tsx), so nothing on screen changes.
        result.hasMonth ?? result.has_month ?? false,
        result.hasGoogle ?? result.has_google ?? (gooF !== null),
        warns,
      );

      const now = new Date();
      setRunId(
        `pa_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`,
      );
      setStatus('done');

      // Row and month counts only — never the spend, revenue or ROI they carry.
      const months = new Set(
        products.map((p: IncomingRow) => p['Month'] ?? p.month).filter((m: unknown) => Boolean(m)),
      );
      track('merge_completed', {
        source_count: fileCount,
        has_google: gooF !== null,
        has_discount: discF !== null,
        product_rows: products.length,
        months_detected: months.size,
        warning_count: warns.length,
        base_currency: result.currency?.base ?? baseCurrency,
        converted_sources: Object.values(result.currency?.sources ?? {}).filter(
          (s) => s?.converted,
        ).length,
        duration_ms: Date.now() - startedAt,
      });
    } catch (err: unknown) {
      const message = errorMessage(err, 'Failed to merge files.');
      setError(message);
      setStatus('error');

      // The ApiError itself is already reported as app_error by lib/http; this
      // records the failure in merge terms so the funnel shows where it broke.
      track('merge_failed', {
        source_count: fileCount,
        reason: message,
        status_code: err instanceof ApiError ? err.status : null,
        duration_ms: Date.now() - startedAt,
      });

      // A session that expired or was revoked mid-upload should not leave the
      // user staring at a generic failure — re-reading it flips the app back
      // to the sign-in screen with the reason the API gave.
      if (err instanceof ApiError && err.isAuthError) void refreshSession();
    }
  }, [
    canMerge, metaF, shopF, gooF, discF, setMergedResult, refreshSession,
    baseCurrency, sourceCurrencies, setMergeCurrency, fileCount,
  ]);

  return { run, status, error, clearError, runId, canMerge, fileCount, isMerged };
}
