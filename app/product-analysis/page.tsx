'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowRight, ChevronDown, ChevronRight, Sparkles, Upload } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { StatStrip } from '@/components/ui/stat-card';
import { MetricsBar, type MetricItem } from '@/components/products/metrics-bar';
import { ColumnsAndFilters } from '@/components/products/columns-and-filters';
import { ProductTable } from '@/components/products/product-table';
import { TopPerformers } from '@/components/products/top-performers';
import { ExportBand } from '@/components/products/export-band';
import { RunDetailsPanel } from '@/components/products/run-details-panel';import { useApp } from '@/lib/context';
import { getProductIntelligence, type ProductIntelligenceRow } from '@/lib/api';
import { daysToRange } from '@/lib/date-range';
import { cn } from '@/lib/utils';
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
  const { mergedData, aggregatedProducts, allMonths, selectedMonths, integrationRangeDays } = useApp();
  // A real dependency for the memos below; inr() alone would go stale.
  const money = useMoney();

  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>([...DEFAULT_COLUMNS]);
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [search, setSearch] = useState('');
  const [filename, setFilename] = useState(defaultProductExportName);
  const tableRef = useRef<HTMLDivElement>(null);

  // Integration-mode-only enrichment (Section 16) — a self-contained fetch
  // that simply renders nothing for a Data Source Upload-only workspace
  // (the endpoint returns an empty product list when nothing is synced),
  // so the existing upload-driven table above is never affected by this.
  // Follows the global date-range control in the header (Section 12).
  const [intel, setIntel] = useState<ProductIntelligenceRow[] | null>(null);
  const [intelExpanded, setIntelExpanded] = useState<string | null>(null);
  const [showIntel, setShowIntel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getProductIntelligence(daysToRange(integrationRangeDays));
        if (cancelled) return;
        setIntel(result.products.length > 0 ? result.products : null);
      } catch {
        if (!cancelled) setIntel(null);
      }
    })();
    return () => { cancelled = true; };
  }, [integrationRangeDays]);

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
      rightPanelTitle="Run details"
      rightPanel={<RunDetailsPanel />}
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

          {intel && (
            <button
              type="button"
              onClick={() => setShowIntel((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-card border border-line bg-panel px-6 py-3.5 text-left transition-colors hover:border-line-hover"
            >
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-ink">
                <Sparkles className="h-4 w-4 text-brand" />
                Product intelligence
                <span className="rounded-chip border border-line-subtle bg-panel-sunken px-2 py-0.5 text-[11px] font-normal text-ink-faint">
                  {intel.length} products
                </span>
              </span>
              {showIntel ? <ChevronDown className="h-4 w-4 text-ink-faint" /> : <ChevronRight className="h-4 w-4 text-ink-faint" />}
            </button>
          )}

          {intel && showIntel && (
            <ProductIntelligencePanel
              rows={intel}
              expanded={intelExpanded}
              onToggle={(id) => setIntelExpanded(intelExpanded === id ? null : id)}
            />
          )}

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

const TAG_LABEL: Record<string, { label: string; className: string }> = {
  winner: { label: 'Winner', className: 'border-ok/30 bg-ok-tint text-ok-soft' },
  emerging: { label: 'Emerging', className: 'border-brand/30 bg-brand-tint text-brand-100' },
  declining: { label: 'Declining', className: 'border-warn/30 bg-warn-tint text-warn' },
  inefficient: { label: 'Inefficient', className: 'border-bad-line bg-bad-tint text-bad-soft' },
  'high-revenue-low-efficiency': { label: 'High revenue, low efficiency', className: 'border-warn/30 bg-warn-tint text-warn' },
  'low-spend-high-efficiency': { label: 'Low spend, high efficiency', className: 'border-ok/30 bg-ok-tint text-ok-soft' },
  'no-ad-spend': { label: 'No ad spend', className: 'border-line-subtle bg-panel-sunken text-ink-faint' },
  steady: { label: 'Steady', className: 'border-line-subtle bg-panel-sunken text-ink-tertiary' },
};

function fmtRoi(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}x`;
}

function fmtTrend(n: number | null): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
}

function ProductIntelligencePanel({
  rows, expanded, onToggle,
}: { rows: ProductIntelligenceRow[]; expanded: string | null; onToggle: (id: string) => void }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.opportunityScore - a.opportunityScore), [rows]);

  return (
    <section className="rounded-card border border-line bg-panel px-6 py-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Product intelligence</h2>
          <p className="text-[12px] text-ink-faint">
            From your connected Shopify + Meta data — campaign/ad counts, best performers, trend and
            an explainable opportunity score.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-panel border border-line-subtle">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line-subtle text-left text-[11px] uppercase tracking-[0.06em] text-ink-faint">
              <th className="px-4 py-2.5 font-medium">Product</th>
              <th className="px-3 py-2.5 text-right font-medium">Revenue</th>
              <th className="px-3 py-2.5 text-right font-medium">Meta spend</th>
              <th className="px-3 py-2.5 text-right font-medium">ROI</th>
              <th className="px-3 py-2.5 text-right font-medium">Trend</th>
              <th className="px-3 py-2.5 text-right font-medium">Campaigns</th>
              <th className="px-3 py-2.5 text-right font-medium">Ads</th>
              <th className="px-3 py-2.5 text-center font-medium">Opportunity</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const tag = TAG_LABEL[p.opportunityTag] ?? TAG_LABEL.steady;
              return (
                <Fragment key={p.productId}>
                  <tr
                    onClick={() => onToggle(p.productId)}
                    className="cursor-pointer border-b border-line-subtle transition-colors hover:bg-panel-raised"
                  >
                    <td className="max-w-[240px] truncate px-4 py-2.5 font-medium text-ink" title={p.title}>{p.title}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-body">{p.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-body">{p.metaSpend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-body">{fmtRoi(p.roi)}</td>
                    <td className={cn('px-3 py-2.5 text-right font-mono',
                      p.revenueTrendPct == null ? 'text-ink-faint' : p.revenueTrendPct >= 0 ? 'text-ok' : 'text-bad')}>
                      {fmtTrend(p.revenueTrendPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-body">{p.campaignCount}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-body">{p.adCount}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn('rounded-chip border px-2 py-0.5 text-[11px] font-medium', tag.className)}>
                        {tag.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-faint">
                      {expanded === p.productId ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </td>
                  </tr>
                  {expanded === p.productId && (
                    <tr className="border-b border-line-subtle bg-panel-sunken">
                      <td colSpan={9} className="px-4 py-3.5">
                        <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-faint">
                          SCORE {p.opportunityScore}/100
                        </p>
                        {p.opportunityReasons.length === 0 ? (
                          <p className="text-[12.5px] text-ink-faint">No strong signal either way yet.</p>
                        ) : (
                          <ul className="mb-2 space-y-1">
                            {p.opportunityReasons.map((r, i) => (
                              <li key={i} className="flex gap-2 text-[12.5px] text-ink-body">
                                <span className="text-ink-faint">·</span>{r}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="text-[11.5px] text-ink-faint">
                          {p.orders} orders · {p.units} units
                          {p.bestCampaignId && <> · best campaign ROAS {fmtRoi(p.bestCampaignRoas)}</>}
                          {p.bestAdId && <> · best ad ROAS {fmtRoi(p.bestAdRoas)}</>}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
