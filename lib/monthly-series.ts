import type { NormProduct } from './context';

export interface MonthBucket {
  /** Full label as produced by the backend, e.g. "March 2026". */
  month: string;
  /** Short label for chart axes, e.g. "Mar". */
  shortLabel: string;
  /** Distinct products with a row in this month. */
  products: number;
  metaSpend: number;
  googleCost: number;
  totalSpend: number;
  revenue: number;
  itemsSold: number;
  roi: number;
}

/**
 * Per-month totals for the SELECTED months, in chronological order.
 *
 * Buckets the same rows that context.aggregatedProducts groups — just keyed on
 * month instead of product ID — so summing every bucket reproduces the same
 * totals the KPI strip shows. Pure, so the relationship can be asserted in a
 * test rather than assumed.
 *
 * @param normalizedProducts one row per product per month (context.normalizedProducts)
 * @param selectedMonths     the header's current month selection
 * @param allMonths          context.allMonths — already sorted chronologically
 */
export function buildMonthBuckets(
  normalizedProducts: NormProduct[],
  selectedMonths: ReadonlySet<string>,
  allMonths: string[],
): MonthBucket[] {
  if (allMonths.length === 0 || normalizedProducts.length === 0) return [];

  const order = allMonths.filter((m) => selectedMonths.has(m));

  const accumulator = new Map<
    string,
    { ids: Set<string>; meta: number; google: number; spend: number; revenue: number; items: number }
  >();
  for (const month of order) {
    accumulator.set(month, {
      ids: new Set(), meta: 0, google: 0, spend: 0, revenue: 0, items: 0,
    });
  }

  for (const row of normalizedProducts) {
    if (!row.month) continue;
    const bucket = accumulator.get(row.month);
    if (!bucket) continue; // month not selected
    bucket.ids.add(row.id);
    bucket.meta += row.metaSpend;
    bucket.google += row.googleCost;
    bucket.spend += row.totalSpend;
    bucket.revenue += row.revenue;
    bucket.items += row.itemsSold;
  }

  return order.map((month) => {
    const b = accumulator.get(month)!;
    return {
      month,
      shortLabel: month.split(' ')[0].slice(0, 3),
      products: b.ids.size,
      metaSpend: b.meta,
      googleCost: b.google,
      totalSpend: b.spend,
      revenue: b.revenue,
      itemsSold: b.items,
      roi: b.spend > 0 ? b.revenue / b.spend : 0,
    };
  });
}

/**
 * Month-over-month change between the last two selected months, as a
 * percentage. Returns null when there is nothing to compare against or the
 * earlier value is zero — rather than inventing a number.
 */
export function monthOverMonthDelta(values: number[]): number | null {
  if (values.length < 2) return null;
  const previous = values[values.length - 2];
  const latest = values[values.length - 1];
  if (previous === 0) return null;
  return ((latest - previous) / Math.abs(previous)) * 100;
}
