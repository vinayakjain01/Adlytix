'use client';

import { useCallback } from 'react';
import { useApp } from '@/lib/context';
import { formatMoney } from '@/lib/formatters';

/**
 * A money formatter that is a real React dependency.
 *
 * `inr()` reads the display currency and rate from module state, so React has no
 * way to know its output changed. A `useMemo` that formats money with it and
 * lists only its data dependencies keeps returning the string it built the first
 * time — the figure silently keeps the previous currency's symbol and rate. That
 * is precisely what left the product table's totals bar showing rupees after the
 * rest of the screen had switched.
 *
 * Listing `currency` in the deps fixes the staleness, but the linter correctly
 * objects that it is never read inside the block. This closes the gap properly:
 * the returned function's identity changes with the currency and the rate, and
 * it genuinely uses both — so it can be depended on honestly.
 *
 * For formatting during render, `inr()` remains correct and simpler.
 */
export function useMoney(): (value: number | null | undefined, compact?: boolean) => string {
  const { currency, displayRate } = useApp();

  return useCallback(
    (value: number | null | undefined, compact = false) =>
      // A null rate means no conversion is known; formatMoney treats that as 1
      // and the UI states which currency the figures are still in.
      formatMoney(value, currency, displayRate ?? 1, compact),
    [currency, displayRate],
  );
}
