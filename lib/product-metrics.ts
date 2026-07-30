/**
 * Pure metric functions for the product screens.
 *
 * Every body here is lifted verbatim from the original components so the
 * numbers cannot drift:
 *   applyFilters    ← app/product-analysis/page.tsx
 *   computeKpis     ← app/product-analysis/page.tsx (kpiCards useMemo)
 *   computeTotals   ← components/product-analysis/filtered-totals-bar.tsx
 *   computeAverages ← components/product-analysis/right-panel.tsx
 *
 * sortProducts is new — the design has sortable headers. It only reorders
 * rows; it never recomputes a value.
 */

import type { NormProduct } from './context';
import type { ColumnKey } from './product-columns';

// ── Filtering ──────────────────────────────────────────────────────────────

export type FilterOperator = '>' | '<' | '=' | '>=' | '<=' | 'between';

export interface ActiveFilter {
  metric: string;
  operator: FilterOperator;
  value: number;
  value2?: number;
}

export function applyFilters(products: NormProduct[], filters: ActiveFilter[]): NormProduct[] {
  if (!filters.length) return products;
  return products.filter((p) =>
    filters.every((f) => {
      const val = Number(p[f.metric as keyof NormProduct] ?? 0);
      switch (f.operator) {
        case '>':       return val >  f.value;
        case '<':       return val <  f.value;
        case '=':       return val === f.value;
        case '>=':      return val >= f.value;
        case '<=':      return val <= f.value;
        case 'between': return val >= f.value && (f.value2 === undefined || val <= f.value2);
        default:        return true;
      }
    }),
  );
}

export function searchProducts(products: NormProduct[], query: string): NormProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return products;
  return products.filter(
    (p) =>
      p.id.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.variant.toLowerCase().includes(q),
  );
}

// ── Aggregates ─────────────────────────────────────────────────────────────

export interface ProductTotals {
  count: number;
  metaSpend: number;
  googleCost: number;
  totalSpend: number;
  revenue: number;
  roi: number;
  itemsSold: number;
  lpv: number;
  /** Weighted by landing page views, as in the original. */
  avgCtr: number;
  /** Weighted by Meta spend, as in the original. */
  avgCpm: number;
}

export function computeTotals(products: NormProduct[]): ProductTotals {
  // Single-pass accumulation — O(n) once
  let totMeta = 0, totGoogle = 0, totSpend = 0, totRev = 0;
  let totItems = 0, totLpv = 0;
  let ctrAcc = 0, cpmAcc = 0;

  for (const p of products) {
    totMeta   += p.metaSpend;
    totGoogle += p.googleCost;
    totSpend  += p.totalSpend;
    totRev    += p.revenue;
    totItems  += p.itemsSold;
    totLpv    += p.lpv;
    // Weighted averages: weight CTR by LPV, CPM by meta spend
    ctrAcc    += p.ctr * p.lpv;
    cpmAcc    += p.cpm * p.metaSpend;
  }

  return {
    count: products.length,
    metaSpend: totMeta,
    googleCost: totGoogle,
    totalSpend: totSpend,
    revenue: totRev,
    roi: totSpend > 0 ? totRev / totSpend : 0,
    itemsSold: totItems,
    lpv: totLpv,
    avgCtr: totLpv > 0 ? ctrAcc / totLpv : 0,
    avgCpm: totMeta > 0 ? cpmAcc / totMeta : 0,
  };
}

export interface ProductAverages {
  metaSpend: number;
  googleCost: number;
  totalSpend: number;
  revenue: number;
  roi: number;
  itemsSold: number;
}

export function computeAverages(products: NormProduct[]): ProductAverages {
  const count = products.length;
  const t = computeTotals(products);
  return {
    metaSpend:  count > 0 ? t.metaSpend  / count : 0,
    googleCost: count > 0 ? t.googleCost / count : 0,
    totalSpend: count > 0 ? t.totalSpend / count : 0,
    revenue:    count > 0 ? t.revenue    / count : 0,
    // Original showed overall ROI in the "Avg ROI" row, not a mean of ratios.
    roi:        t.roi,
    itemsSold:  count > 0 ? Math.round(t.itemsSold / count) : 0,
  };
}

export interface KpiValue {
  label: string;
  value: number;
  format: 'number' | 'currency' | 'roi';
}

export function computeKpis(products: NormProduct[]): KpiValue[] {
  if (!products.length) return [];
  const t = computeTotals(products);
  return [
    { label: 'PRODUCTS',    value: t.count,      format: 'number' },
    { label: 'META SPEND',  value: t.metaSpend,  format: 'currency' },
    { label: 'GOOGLE COST', value: t.googleCost, format: 'currency' },
    { label: 'TOTAL SPEND', value: t.totalSpend, format: 'currency' },
    { label: 'REVENUE',     value: t.revenue,    format: 'currency' },
    { label: 'OVERALL ROI', value: t.roi,        format: 'roi' },
  ];
}

// ── Sorting (presentation only) ────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: ColumnKey;
  direction: SortDirection;
}

export function sortProducts(
  products: NormProduct[],
  sort: SortState | null,
  numericKeys: ReadonlySet<string>,
): NormProduct[] {
  if (!sort) return products;
  const factor = sort.direction === 'asc' ? 1 : -1;

  // Copy first — never mutate the array coming out of context.
  return [...products].sort((a, b) => {
    const av = a[sort.key as keyof NormProduct];
    const bv = b[sort.key as keyof NormProduct];
    if (numericKeys.has(sort.key)) return (Number(av ?? 0) - Number(bv ?? 0)) * factor;
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor;
  });
}
