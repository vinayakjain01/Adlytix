import type { NormProduct } from './context';
import type { ActiveFilter } from './product-metrics';

/**
 * Serialises rows to CSV and triggers a download.
 *
 * Quoting, the doubled-quote escape and the UTF-8 BOM (which is what makes
 * Excel open the ₹ column correctly) are preserved from the original
 * download-band / quadrant exporters.
 */
export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The product-table export. Header metadata, applied-filter block, column
 * order and raw (unrounded, unformatted) numeric cells are all unchanged from
 * components/product-analysis/download-band.tsx.
 */
export function buildProductExportRows(
  products: NormProduct[],
  activeFilters: ActiveFilter[],
): (string | number)[][] {
  const rows: (string | number)[][] = [];

  rows.push(['ROASify Export']);
  rows.push(['Generated', new Date().toLocaleString('en-IN')]);
  rows.push(['Total Products', String(products.length)]);

  if (activeFilters.length > 0) {
    rows.push([]);
    rows.push(['Applied Filters']);
    rows.push(['Metric', 'Operator', 'Value', 'Value2']);
    for (const f of activeFilters) {
      rows.push([
        f.metric,
        f.operator,
        String(f.value),
        f.value2 !== undefined ? String(f.value2) : '',
      ]);
    }
  }

  rows.push([]);

  rows.push([
    'Product ID', 'Product Title', 'Variant Title',
    'Meta Spend', 'Google Cost', 'Total Spend', 'Revenue',
    'ROI', 'Items Sold', 'CTR', 'CPM',
  ]);

  for (const p of products) {
    rows.push([
      String(p.id ?? ''),
      String(p.title ?? ''),
      String(p.variant ?? ''),
      String(p.metaSpend ?? 0),
      String(p.googleCost ?? 0),
      String(p.totalSpend ?? 0),
      String(p.revenue ?? 0),
      String(p.roi ?? 0),
      String(p.itemsSold ?? 0),
      String(p.ctr ?? 0),
      String(p.cpm ?? 0),
    ]);
  }

  return rows;
}

// ── Quadrant exports ───────────────────────────────────────────────────────
// Header rows, column sets and the rounding of each cell are unchanged from
// components/quadrant-view/quadrant-cards.tsx, app/quadrant-view/page.tsx and
// components/quadrant-view/champions-hero.tsx respectively.

/** One quadrant's products. */
export function buildQuadrantExportRows(
  label: string,
  products: NormProduct[],
): (string | number)[][] {
  return [
    [`ROASify — ${label} Export`],
    ['Generated', new Date().toLocaleString('en-IN')],
    ['Products', String(products.length)],
    [],
    ['Product ID', 'Product Title', 'Variant', 'Meta Spend', 'Total Spend', 'Revenue', 'ROI', 'Items Sold'],
    ...products.map((p) => [
      p.id,
      p.title,
      p.variant,
      String(Math.round(p.metaSpend)),
      String(Math.round(p.totalSpend)),
      String(Math.round(p.revenue)),
      p.roi.toFixed(2),
      String(p.itemsSold),
    ]),
  ];
}

/** Every product, tagged with the quadrant it currently falls into. */
export function buildAllQuadrantsExportRows(
  products: NormProduct[],
  quadrantOf: (product: NormProduct) => string,
  spendThreshold: number,
  revenueThreshold: number,
  monthsLabel: string,
): (string | number)[][] {
  return [
    ['ROASify — Quadrant View Export'],
    ['Generated', new Date().toLocaleString('en-IN')],
    ['Months', monthsLabel],
    ['Spend Threshold', String(Math.round(spendThreshold))],
    ['Revenue Threshold', String(Math.round(revenueThreshold))],
    [],
    ['Product ID', 'Product Title', 'Variant', 'Quadrant', 'Meta Spend', 'Total Spend', 'Revenue', 'ROI', 'Items Sold'],
    ...products.map((p) => [
      p.id,
      p.title,
      p.variant,
      quadrantOf(p),
      String(Math.round(p.metaSpend)),
      String(Math.round(p.totalSpend)),
      String(Math.round(p.revenue)),
      p.roi.toFixed(2),
      String(p.itemsSold),
    ]),
  ];
}

/** The budget recommendation sheet. */
export function buildScalePlanExportRows(
  rows: { product: string; currentSpend: number; suggestedBudget: number; expectedRevenue: number; roiAtScale: number }[],
  currencySymbolText: string,
  formatRoi: (value: number) => string,
): (string | number)[][] {
  return [
    ['ROASify — Scale-Spend Plan for Champions'],
    ['Generated', new Date().toLocaleString('en-IN')],
    [],
    ['Product', `Current Spend (${currencySymbolText})`, 'Suggested Budget (+50%)', 'Expected Revenue', 'Conservative ROI'],
    ...rows.map((r) => [
      r.product,
      String(Math.round(r.currentSpend)),
      String(r.suggestedBudget),
      String(r.expectedRevenue),
      formatRoi(r.roiAtScale),
    ]),
  ];
}

/** Same default name the original filename input started with. */
export function defaultProductExportName(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `roasify_overall_${y}${m}${d}.csv`;
}
