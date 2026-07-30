'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X,
} from 'lucide-react';
import type { NormProduct } from '@/lib/context';
import { inr, num, roi, roiTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type StrategyFilter = 'all' | 'discounted' | 'non-discounted';

/** Preserved from the original discount table. */
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100] as const;
type RowsPerPage = (typeof ROWS_PER_PAGE_OPTIONS)[number];

const TONE_CLASS = { good: 'text-ok', bad: 'text-bad', neutral: 'text-ink-body' } as const;

export function DiscountTable({ products }: { products: NormProduct[] }) {
  const [strategy, setStrategy] = useState<StrategyFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState<RowsPerPage>(25);

  const strategyFiltered = useMemo(() => {
    if (strategy === 'discounted') return products.filter((p) => p.discounted);
    if (strategy === 'non-discounted') return products.filter((p) => !p.discounted);
    return products;
  }, [products, strategy]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return strategyFiltered;
    return strategyFiltered.filter(
      (p) => p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [strategyFiltered, search]);

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);

  // Reset to the first page whenever the row count changes.
  const prevLength = useRef(rows.length);
  useEffect(() => {
    if (prevLength.current !== rows.length) {
      prevLength.current = rows.length;
      setPage(1);
    }
  }, [rows.length]);

  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage),
    [rows, safePage, rowsPerPage],
  );

  const first = rows.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1;
  const last = Math.min(safePage * rowsPerPage, rows.length);

  // At most 5 page buttons, centred on the current page — original behaviour.
  const pageWindow = useMemo(() => {
    const half = 2;
    let start = Math.max(1, safePage - half);
    let end = Math.min(totalPages, safePage + half);
    if (end - start < 4) {
      if (start === 1) end = Math.min(totalPages, start + 4);
      else start = Math.max(1, end - 4);
    }
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [safePage, totalPages]);

  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle px-5 py-3.5">
        <div className="flex flex-shrink-0 items-center gap-1 rounded-control bg-panel-sunken p-1">
          {(['all', 'discounted', 'non-discounted'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setStrategy(option);
                setPage(1);
              }}
              aria-pressed={strategy === option}
              className={cn(
                'rounded-chip px-3 py-1.5 text-[12.5px] transition-colors',
                strategy === option
                  ? 'bg-panel text-ink shadow-sm'
                  : 'text-ink-secondary hover:text-ink',
              )}
            >
              {option === 'non-discounted'
                ? 'Non-discounted'
                : option === 'all'
                  ? 'All'
                  : 'Discounted'}
            </button>
          ))}
        </div>

        <div className="relative min-w-[200px] max-w-[360px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by product title or ID…"
            aria-label="Search discount products"
            className="h-9 w-full rounded-control border border-line bg-field pl-8 pr-8 text-[13px] text-ink transition-colors focus:border-brand focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              title="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              {[
                { label: 'PRODUCT ID', align: 'left' },
                { label: 'PRODUCT', align: 'left' },
                { label: 'STRATEGY', align: 'left' },
                { label: 'SPEND', align: 'right' },
                { label: 'REVENUE', align: 'right' },
                { label: 'ROI', align: 'right' },
                { label: 'UNITS', align: 'right' },
              ].map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={cn(
                    'sticky top-0 z-[5] whitespace-nowrap border-b border-line-subtle bg-header px-4 py-3',
                    'text-[10.5px] font-semibold tracking-[0.1em] text-ink-tertiary',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((product) => (
              <tr key={product.id} className="transition-colors hover:bg-panel-raised">
                <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3 font-mono text-[12.5px] text-ink-tertiary">
                  {product.id}
                </td>
                <td className="max-w-[240px] truncate border-b border-line-subtle px-4 py-3 font-medium text-ink">
                  {product.title}
                </td>
                <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex rounded px-2 py-0.5 text-[11px] font-medium',
                      product.discounted
                        ? 'bg-warn-tint text-warn'
                        : 'bg-brand-tint text-brand-200',
                    )}
                  >
                    {product.discounted ? 'Discounted' : 'Full price'}
                  </span>
                </td>
                <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3 text-right text-ink-body tabular-nums">
                  {inr(product.totalSpend)}
                </td>
                <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3 text-right text-ink-body tabular-nums">
                  {inr(product.revenue)}
                </td>
                <td
                  className={cn(
                    'whitespace-nowrap border-b border-line-subtle px-4 py-3 text-right font-medium tabular-nums',
                    TONE_CLASS[roiTone(product.roi)],
                  )}
                >
                  {roi(product.roi)}
                </td>
                <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3 text-right text-ink-body tabular-nums">
                  {num(product.itemsSold)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="px-5 py-14 text-center animate-fade-in">
          <p className="mb-1.5 text-[15px] font-medium text-ink">No products match</p>
          <p className="text-[13px] text-ink-muted">
            Try a different search term or switch the strategy filter.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-subtle px-5 py-3.5">
        <div className="flex items-center gap-4">
          <p className="text-[12.5px] text-ink-tertiary tabular-nums">
            {rows.length === 0 ? (
              'No rows'
            ) : (
              <>
                Showing{' '}
                <span className="font-medium text-ink">
                  {num(first)}–{num(last)}
                </span>{' '}
                of <span className="font-medium text-ink">{num(rows.length)}</span>
              </>
            )}
          </p>

          <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            Rows
            <select
              value={rowsPerPage}
              onChange={(event) => {
                setRowsPerPage(Number(event.target.value) as RowsPerPage);
                setPage(1);
              }}
              className="h-8 rounded-chip border border-line bg-field px-2 text-[12.5px] text-ink-body focus:border-brand focus:outline-none"
            >
              {ROWS_PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-1">
          {[
            { icon: ChevronsLeft, to: 1, disabled: safePage === 1, title: 'First page' },
            { icon: ChevronLeft, to: Math.max(1, safePage - 1), disabled: safePage === 1, title: 'Previous page' },
          ].map((button) => (
            <button
              key={button.title}
              type="button"
              onClick={() => setPage(button.to)}
              disabled={button.disabled}
              title={button.title}
              className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-secondary transition-colors hover:bg-panel-raised disabled:cursor-not-allowed disabled:opacity-30"
            >
              <button.icon className="h-3.5 w-3.5" />
            </button>
          ))}

          {pageWindow.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => setPage(pageNumber)}
              aria-current={pageNumber === safePage ? 'page' : undefined}
              className={cn(
                'h-7 min-w-7 rounded-chip px-1.5 text-[12.5px] transition-colors tabular-nums',
                pageNumber === safePage
                  ? 'bg-brand font-semibold text-white'
                  : 'text-ink-secondary hover:bg-panel-raised',
              )}
            >
              {pageNumber}
            </button>
          ))}

          {[
            { icon: ChevronRight, to: Math.min(totalPages, safePage + 1), disabled: safePage === totalPages, title: 'Next page' },
            { icon: ChevronsRight, to: totalPages, disabled: safePage === totalPages, title: 'Last page' },
          ].map((button) => (
            <button
              key={button.title}
              type="button"
              onClick={() => setPage(button.to)}
              disabled={button.disabled}
              title={button.title}
              className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-secondary transition-colors hover:bg-panel-raised disabled:cursor-not-allowed disabled:opacity-30"
            >
              <button.icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
