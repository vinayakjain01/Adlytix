'use client';

import { Download } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/context';
import { findNavItem, groupLabel } from '@/lib/nav';
import { useIntegrationRefresh } from '@/hooks/use-integration-refresh';
import { DateRangeSelector } from '@/components/integrations/date-range-selector';
import { MonthPicker } from './month-picker';
import { CurrencyPicker } from './currency-picker';
import { cn } from '@/lib/utils';

export interface AppHeaderProps {
  /** Overrides the crumbs derived from the route. */
  breadcrumbs?: string[];
  /** Rendered as an Export button only when the screen can actually export. */
  onExport?: () => void;
  exportLabel?: string;
}

export function AppHeader({ breadcrumbs, onExport, exportLabel = 'Export' }: AppHeaderProps) {
  const pathname = usePathname();
  const { mergedData, aggregatedProducts, integrationRangeDays, setIntegrationRangeDays } = useApp();
  const { refresh: refreshIntegrationData, refreshing } = useIntegrationRefresh();

  // Global — Section 12: one control drives every Integration-mode page.
  // Never navigates (the operator could be on any screen when they change
  // it) and never re-fetches Shopify/Meta, only the stored data for the new
  // range. A workspace with no integration connected simply gets a no-op
  // (see useIntegrationRefresh's "no synced Shopify orders" handling).
  const handleRangeChange = (days: number) => {
    setIntegrationRangeDays(days);
    void refreshIntegrationData(days);
  };

  const item = findNavItem(pathname);
  const crumbs = breadcrumbs ?? [
    item ? groupLabel(item.group) : 'Workspace',
    item?.label ?? '',
  ].filter(Boolean);

  const hasData = mergedData !== null && aggregatedProducts.length > 0;

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-[62px] flex-shrink-0 items-center justify-between gap-5',
        'border-b border-line-subtle bg-page/[0.82] px-6 backdrop-blur-[14px]',
      )}
    >
      {/* Breadcrumbs + data-source pill */}
      <div className="flex min-w-0 items-center gap-2.5 text-[13px]">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
          {crumbs.map((crumb, i) => (
            <span key={`${crumb}-${i}`} className="flex min-w-0 items-center gap-2">
              {i > 0 && <span className="text-ink-disabled">/</span>}
              <span
                className={cn(
                  'truncate',
                  i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-ink-muted',
                )}
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>

        <span
          className={cn(
            'ml-1.5 inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full',
            'border border-line-strong bg-panel/60 px-2.5 py-1 text-[11px]',
            hasData ? 'text-brand-200' : 'text-warn',
          )}
        >
          <span
            className={cn(
              'h-[5px] w-[5px] rounded-full animate-pulse-dot',
              hasData ? 'bg-brand' : 'bg-warn',
            )}
          />
          {hasData
            ? `Live merge · ${aggregatedProducts.length.toLocaleString('en-IN')} products`
            : 'No data yet'}
        </span>
      </div>

      {/* Global controls */}
      <div className="flex flex-shrink-0 items-center gap-2">
        <DateRangeSelector activeDays={integrationRangeDays} loading={refreshing} onSelect={handleRangeChange} />
        <MonthPicker />
        <CurrencyPicker />

        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className={cn(
              'flex h-[34px] items-center gap-2 whitespace-nowrap rounded-control border border-line',
              'bg-field px-3 text-[13px] text-ink-body transition-colors',
              'hover:border-line-hover hover:text-ink',
            )}
          >
            <Download className="h-3.5 w-3.5 text-ink-muted" />
            {exportLabel}
          </button>
        )}
      </div>
    </header>
  );
}
