'use client';

import { useMemo } from 'react';
import { useApp } from '@/lib/context';
import { buildMonthBuckets, type MonthBucket } from '@/lib/monthly-series';

export type { MonthBucket } from '@/lib/monthly-series';
export { monthOverMonthDelta } from '@/lib/monthly-series';

export interface MonthlySeries {
  buckets: MonthBucket[];
  /** True when the upload had a Month column at all. */
  hasMonths: boolean;
}

/**
 * Memoised view of lib/monthly-series over the current month selection.
 *
 * Depends on selectedMonths, so the chart, the KPI sparklines and the deltas
 * all move together with the header's month picker — the same dependency that
 * drives context.aggregatedProducts.
 */
export function useMonthlySeries(): MonthlySeries {
  const { normalizedProducts, selectedMonths, allMonths } = useApp();

  return useMemo(
    () => ({
      buckets: buildMonthBuckets(normalizedProducts, selectedMonths, allMonths),
      hasMonths: allMonths.length > 0,
    }),
    [normalizedProducts, selectedMonths, allMonths],
  );
}
