'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowRight, Upload } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { StatStrip } from '@/components/ui/stat-card';
import { MetricsBar, type MetricItem } from '@/components/products/metrics-bar';
import { ColumnsAndFilters } from '@/components/products/columns-and-filters';
import { ProductTable } from '@/components/products/product-table';
import { TopPerformers } from '@/components/products/top-performers';
import { ExportBand } from '@/components/products/export-band';
import { useApp } from '@/lib/context';
import { DEFAULT_COLUMNS, type ColumnKey } from '@/lib/product-columns';
import {
  applyFilters, computeAverages, computeKpis, computeTotals, searchProducts,
  type ActiveFilter,
} from '@/lib/product-metrics';
import {
  buildProductExportRows, defaultProductExportName, downloadCsv,
} from '@/lib/csv-export';
import { num, roi } from '@/lib/formatters';
import { track } from '@/lib/analytics/client';
import { useSettledValue } from '@/hooks/use-settled-value';
import { useMoney } from '@/hooks/use-money';

export default function ProductAnalysisPage() {
  // aggregatedProducts is the single source of truth: month-filtered and
  // grouped by product ID by lib/context.tsx.
  const { mergedData, aggregatedProducts, allMonths, selectedMonths } = useApp();
  // A real dependency for the memos below; inr() alone would go stale.
  const money = useMoney();

  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>([...DEFAULT_COLUMNS]);
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [search, setSearch] = useState('');
  const [filename, setFilename] = useState(defaultProductExportName);
  const tableRef = useRef<HTMLDivElement>(null);

  // search → metric filters, exactly the order the original applied them.
  const searched = useMemo(() => searchProducts(aggregatedProducts, search), [aggregatedProducts, search]);
  const finalProducts = useMemo(() => applyFilters(searched, activeFilters), [searched, activeFilters]);

  // KPIs reflect the selected months and ignore search/metric filters.
  const kpis = useMemo(() => computeKpis(aggregatedProducts), [aggregatedProducts]);

  // Totals and averages track every active filter and the search box.
  const totals = useMemo(() => computeTotals(finalProducts), [finalProducts]);
  const averages = useMemo(() => computeAverages(finalProducts), [finalProducts]);

  const isFiltered = finalProducts.length < aggregatedProducts.length;

  const totalItems: MetricItem[] = useMemo(
    () => [
      {
        label: 'Products',
        value: num(totals.count),
        note: isFiltered ? `of ${num(aggregatedProducts.length)}` : undefined,
      },
      { label: 'Meta spend', value: money(totals.metaSpend, true) },
      { label: 'Google cost', value: money(totals.googleCost, true) },
      { label: 'Total spend', value: money(totals.totalSpend, true) },
      { label: 'Revenue', value: money(totals.revenue, true), highlight: true },
      { label: 'ROI', value: roi(totals.roi), highlight: totals.roi >= 3 },
      { label: 'Items sold', value: num(totals.itemsSold) },
      { label: 'Avg CTR', value: `${totals.avgCtr.toFixed(1)}%` },
      { label: 'Avg CPM', value: money(totals.avgCpm, true) },
    ],
    [totals, isFiltered, aggregatedProducts.length, money],
  );

  const averageItems: MetricItem[] = useMemo(
    () => [
      { label: 'Meta spend', value: money(averages.metaSpend) },
      { label: 'Google cost', value: money(averages.googleCost) },
      { label: 'Total spend', value: money(averages.totalSpend) },
      { label: 'Revenue', value: money(averages.revenue) },
      { label: 'ROI', value: roi(averages.roi), highlight: averages.roi >= 3 },
      { label: 'Units', value: num(averages.itemsSold) },
    ],
    [averages, money],
  );

  const handleDownload = useCallback(() => {
    if (finalProducts.length === 0) return;
    const name = filename.trim() || 'roasify_export.csv';
    downloadCsv(name, buildProductExportRows(finalProducts, activeFilters));
    track('csv_downloaded', {
      kind: 'products',
      row_count: finalProducts.length,
      was_filtered: isFiltered,
      filter_count: activeFilters.length,
      // Length only: an operator-set filename routinely carries the client name.
      filename_length: name.length,
    });
    toast.success(`Exported ${num(finalProducts.length)} rows`);
  }, [finalProducts, activeFilters, filename, isFiltered]);

  const clearAll = useCallback(() => {
    track('filters_cleared', { filter_count: activeFilters.length, had_search: search.length > 0 });
    setSearch('');
    setActiveFilters([]);
  }, [activeFilters.length, search]);

  // Both are debounced: the search box and the filter value fields change on
  // every keystroke, and one event per character would be noise.
  useSettledValue(search, (term) => {
    if (term.trim().length === 0) return;
    track('product_searched', {
      term_length: term.trim().length,
      rows_matched: finalProducts.length,
      rows_total: aggregatedProducts.length,
    });
  });

  // Wrapped rather than tracked in an effect so the added/removed column can be
  // diffed against the current selection. The event is emitted outside the state
  // updater: React may invoke an updater twice in development, which would
  // double-count the change.
  const handleColumnsChange = useCallback(
    (next: ColumnKey[]) => {
      track('columns_changed', {
        visible_count: next.length,
        added: next.find((c) => !visibleColumns.includes(c)) ?? null,
        removed: visibleColumns.find((c) => !next.includes(c)) ?? null,
      });
      setVisibleColumns(next);
    },
    [visibleColumns],
  );

  useSettledValue(activeFilters, (filters) => {
    if (filters.length === 0) return;
    track('filters_applied', {
      // Metric names are column labels, not values.
      metrics: filters.map((f) => f.metric),
      filter_count: filters.length,
      rows_matched: finalProducts.length,
      rows_total: aggregatedProducts.length,
    });
  });

  const monthLabel =
    allMonths.length > 0
      ? selectedMonths.size === allMonths.length
        ? `all ${allMonths.length} months`
        : `${selectedMonths.size} of ${allMonths.length} months`
      : null;

  if (!mergedData || aggregatedProducts.length === 0) {
    return (
      <AppShell>
        <div className="animate-fade-up">
          <header className="mb-7">
            <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Product analysis</h1>
            <p className="text-[14px] text-ink-secondary">
              One row per product, aggregated across the selected months.
            </p>
          </header>

          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint animate-floaty">
              <Upload className="h-5 w-5" />
            </div>
            <p className="mb-1.5 text-[17px] font-medium">No merged data yet</p>
            <p className="mx-auto mb-6 max-w-md text-[13.5px] leading-relaxed text-ink-tertiary">
              Upload the Meta Ads and Shopify exports on the Data sources screen and run a
              merge — the table is built from that result.
            </p>
            <Link
              href="/sources"
              className="inline-flex h-9 items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-transform hover:-translate-y-px"
            >
              Go to data sources
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      onExport={handleDownload}
      exportLabel={`Export ${num(finalProducts.length)} rows`}
    >
      <div className="animate-fade-up">
        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Product analysis</h1>
          <p className="text-[14px] text-ink-secondary">
            One row per product, aggregated across{' '}
            {monthLabel ?? 'all available data'}.
          </p>
        </header>

        <div className="space-y-4">
          <StatStrip cards={kpis} />

          <TopPerformers tableRef={tableRef} />

          <ColumnsAndFilters
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={handleColumnsChange}
            activeFilters={activeFilters}
            onActiveFiltersChange={setActiveFilters}
          />

          <MetricsBar
            title="Totals for current view"
            items={totalItems}
            badge={isFiltered ? 'Filtered' : undefined}
          />

          <div ref={tableRef}>
            <ProductTable
              products={finalProducts}
              columns={visibleColumns}
              totalCount={aggregatedProducts.length}
              search={search}
              onSearchChange={setSearch}
              onClearFilters={clearAll}
            />
          </div>

          <MetricsBar title="Averages per product" items={averageItems} />

          <p className="px-1 text-[12px] leading-relaxed text-ink-muted">
            ROI = Shopify revenue ÷ total spend. Multi-month data is summed per product ID
            before averaging, and every figure reflects the selected months only.
          </p>

          <ExportBand
            products={finalProducts}
            activeFilters={activeFilters}
            filename={filename}
            onFilenameChange={setFilename}
            onDownload={handleDownload}
          />
        </div>
      </div>
    </AppShell>
  );
}
