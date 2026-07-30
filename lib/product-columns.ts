/**
 * Column configuration for the product table.
 *
 * Consolidates what used to live in three places: DEFAULT_COLUMNS in
 * app/product-analysis/page.tsx, ALL_CHIPS in columns-filters.tsx, and
 * columnLabels in ui/data-table.tsx — which had drifted out of sync.
 */

export type ColumnKey =
  | 'id' | 'title' | 'variant'
  | 'metaSpend' | 'googleCost' | 'totalSpend' | 'revenue' | 'roi'
  | 'itemsSold' | 'ctr' | 'cpm';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Which upload the value originates from — surfaced on the chips. */
  source: 'Merged' | 'Meta' | 'Shopify' | 'Google' | 'Derived';
  align: 'left' | 'right';
  /** Product ID and Title are always shown, so they cannot be removed. */
  toggleable: boolean;
  /** Sorts numerically rather than by locale string compare. */
  numeric: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: 'id',         label: 'Product ID',    source: 'Merged',  align: 'left',  toggleable: false, numeric: false },
  { key: 'title',      label: 'Product Title', source: 'Shopify', align: 'left',  toggleable: false, numeric: false },
  { key: 'variant',    label: 'Variant Title', source: 'Shopify', align: 'left',  toggleable: true,  numeric: false },
  { key: 'metaSpend',  label: 'Meta Spend',    source: 'Meta',    align: 'right', toggleable: true,  numeric: true },
  { key: 'googleCost', label: 'Google Cost',   source: 'Google',  align: 'right', toggleable: true,  numeric: true },
  { key: 'totalSpend', label: 'Total Spend',   source: 'Derived', align: 'right', toggleable: true,  numeric: true },
  { key: 'revenue',    label: 'Revenue',       source: 'Shopify', align: 'right', toggleable: true,  numeric: true },
  { key: 'roi',        label: 'ROI',           source: 'Derived', align: 'right', toggleable: true,  numeric: true },
  { key: 'itemsSold',  label: 'Items Sold',    source: 'Shopify', align: 'right', toggleable: true,  numeric: true },
  { key: 'ctr',        label: 'CTR',           source: 'Meta',    align: 'right', toggleable: true,  numeric: true },
  { key: 'cpm',        label: 'CPM',           source: 'Meta',    align: 'right', toggleable: true,  numeric: true },
];

/**
 * Unchanged from the original DEFAULT_COLUMNS — Google Cost is deliberately
 * absent, so the table looks exactly as it did before.
 */
export const DEFAULT_COLUMNS: ColumnKey[] = [
  'id', 'title', 'variant', 'metaSpend', 'totalSpend',
  'revenue', 'roi', 'itemsSold', 'ctr', 'cpm',
];

export const TOGGLEABLE_COLUMNS = COLUMNS.filter((c) => c.toggleable);
export const FIXED_COLUMNS = COLUMNS.filter((c) => !c.toggleable).map((c) => c.key);

export function columnDef(key: ColumnKey): ColumnDef {
  const found = COLUMNS.find((c) => c.key === key);
  if (!found) throw new Error(`Unknown column: ${key}`);
  return found;
}

/** Keeps visible columns in canonical order regardless of toggle sequence. */
export function orderColumns(keys: ColumnKey[]): ColumnKey[] {
  const wanted = new Set(keys);
  return COLUMNS.filter((c) => wanted.has(c.key)).map((c) => c.key);
}

/** Metrics offered in the filter row — matches the original select options. */
export const FILTERABLE_METRICS: { key: ColumnKey; label: string }[] = [
  { key: 'roi', label: 'ROI' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'totalSpend', label: 'Total Spend' },
  { key: 'metaSpend', label: 'Meta Spend' },
  { key: 'ctr', label: 'CTR' },
  { key: 'cpm', label: 'CPM' },
  { key: 'itemsSold', label: 'Items Sold' },
];
