'use client';

import { useMemo } from 'react';
import { useApp } from '@/lib/context';
import { computeAverages } from '@/lib/product-metrics';
import { countSourceRows, monthsLabel, runIdFor } from '@/lib/run-details';
import { inr, num, roi } from '@/lib/formatters';
import { PanelRow, PanelSection, SourceItem } from '@/components/layout/right-panel';

/**
 * "Run details" for the data behind the current screen. Everything is derived
 * from the same filtered data the page uses, so the header date range, month
 * picker and currency all update it without any extra fetching. There is no
 * "Range" row on purpose: the active range is shown by the header buttons, and
 * a label here could disagree with the numbers if a refresh failed.
 */
export function RunDetailsPanel() {
  const { mergedData, aggregatedProducts, normalizedProducts, allMonths, selectedMonths } = useApp();

  const sourceRows = useMemo(
    () =>
      countSourceRows(
        normalizedProducts.filter((r) => !r.month || selectedMonths.has(r.month)),
      ),
    [normalizedProducts, selectedMonths],
  );

  // Formatted with inr() during render (not memoised) so a currency change shows immediately.
  const avg = computeAverages(aggregatedProducts);
  const months = monthsLabel(allMonths, selectedMonths);
  const connected = [sourceRows.meta, sourceRows.shopify, sourceRows.google].filter((n) => n > 0).length;
  const runId = mergedData ? runIdFor(new Date()) : '—';

  return (
    <div>
      <PanelSection title="Run details">
        <PanelRow label="Run ID" value={runId} mono />
        <PanelRow label="Products" value={num(aggregatedProducts.length)} />
        <PanelRow label="Sources" value={`${connected} connected`} />
        {months && <PanelRow label="Months" value={months} />}
        <div className="mt-4">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-widest text-ink-muted">
            Sources merged
          </div>
          <SourceItem name="Meta Ads" rows={sourceRows.meta} connected={sourceRows.meta > 0} />
          <SourceItem name="Shopify" rows={sourceRows.shopify} connected={sourceRows.shopify > 0} />
          <SourceItem name="Google Ads" rows={sourceRows.google} connected={sourceRows.google > 0} />
        </div>
      </PanelSection>

      <PanelSection title={`Averages per product${months ? ` · ${months}` : ''}`}>
        <PanelRow label="Avg Meta Spend" value={inr(avg.metaSpend)} />
        <PanelRow label="Avg Google Spend" value={inr(avg.googleCost)} />
        <PanelRow label="Avg Total Spend" value={inr(avg.totalSpend)} />
        <PanelRow label="Avg Revenue" value={inr(avg.revenue)} />
        <PanelRow label="Avg ROI" value={roi(avg.roi)} />
        <PanelRow label="Avg Units/Product" value={num(avg.itemsSold)} />
      </PanelSection>

      <PanelSection title="Methodology">
        <p className="text-[12.5px] leading-relaxed text-ink-tertiary">
          ROI = Shopify Revenue ÷ Total Spend. Averages reflect selected months only.
          Multi-month data is summed per product ID before averaging.
        </p>
      </PanelSection>
    </div>
  );
}
