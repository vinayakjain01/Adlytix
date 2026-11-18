'use client';

import { useCallback, useState } from 'react';
import { useApp, type IncomingRow } from '@/lib/context';
import { daysToRange } from '@/lib/date-range';
import { getIntegrationAnalysis } from '@/lib/api';

/**
 * Integration mode's equivalent of useMerge()'s run() (hooks/use-merge.ts) —
 * same success handling, same setMergedResult call, same endpoint family —
 * except it never navigates and never toasts, so it can be called from
 * anywhere a range change needs to refresh the shared merged data in place
 * (the global header's date-range control, the Integrations page after a
 * sync, a manual re-run). Callers that DO want a toast/redirect add that
 * themselves around refresh().
 */
export function useIntegrationRefresh() {
  const { baseCurrency, sourceCurrencies, setMergeCurrency, setMergedResult } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (days: number): Promise<boolean> => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await getIntegrationAnalysis({
        ...daysToRange(days),
        base: baseCurrency, meta: sourceCurrencies.meta, shopify: sourceCurrencies.shopify,
      });

      setMergeCurrency(result.currency ?? null);
      const products = result.products ?? [];
      const summary = result.summary ?? {};
      const warns = result.warnings ?? [];

      const calcTotalSpend = products.reduce((s: number, p: IncomingRow) => s + Number(p['Total Spend'] ?? 0), 0);
      const calcTotalRev = products.reduce((s: number, p: IncomingRow) => s + Number(p['Shopify Revenue'] ?? 0), 0);
      const calcMetaSpend = products.reduce((s: number, p: IncomingRow) => s + Number(p['Meta Spend'] ?? 0), 0);

      setMergedResult(
        products,
        {
          products: summary.products ?? products.length,
          total_spend: summary.total_spend || calcTotalSpend,
          total_rev: summary.total_rev || calcTotalRev,
          roi: summary.roi || (calcTotalSpend > 0 ? calcTotalRev / calcTotalSpend : 0),
          meta_spend: summary.meta_spend || calcMetaSpend,
          google_cost: 0,
          lpv: summary.lpv ?? 0,
        },
        result.hasMonth ?? false,
        false,
        warns,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // No synced Shopify orders in range yet — a normal state, not a failure.
      if (!message.toLowerCase().includes('no synced shopify orders')) {
        setError(message || 'Could not refresh integration data.');
      }
      return false;
    } finally {
      setRefreshing(false);
    }
  }, [baseCurrency, sourceCurrencies, setMergeCurrency, setMergedResult]);

  return { refresh, refreshing, error };
}
