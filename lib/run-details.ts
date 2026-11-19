import type { NormProduct } from '@/lib/context';

/** Run identifier shown in the Run details panel, e.g. `pa_2026_11_19`. */
export function runIdFor(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `pa_${date.getFullYear()}_${mm}_${dd}`;
}

export interface SourceRowCounts {
  meta: number;
  shopify: number;
  google: number;
}

/**
 * How many merged rows actually carry each source's data. Counted from the
 * rows themselves (not guessed from file size), so the numbers move with the
 * date range and month selection.
 */
export function countSourceRows(rows: NormProduct[]): SourceRowCounts {
  let meta = 0;
  let shopify = 0;
  let google = 0;
  for (const r of rows) {
    if (r.metaSpend > 0) meta += 1;
    if (r.googleCost > 0) google += 1;
    if (r.revenue > 0 || r.itemsSold > 0) shopify += 1;
  }
  return { meta, shopify, google };
}

/** `All N months` / `X of N months`, or null when the data has no months. */
export function monthsLabel(allMonths: string[], selected: Set<string>): string | null {
  if (allMonths.length === 0) return null;
  return selected.size === allMonths.length
    ? `All ${allMonths.length} months`
    : `${selected.size} of ${allMonths.length} months`;
}
