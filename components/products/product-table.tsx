'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, Search, X,
} from 'lucide-react';
import type { NormProduct } from '@/lib/context';
import { COLUMNS, columnDef, type ColumnKey } from '@/lib/product-columns';
import { sortProducts, type SortState } from '@/lib/product-metrics';
import { inr, num, roi, roiTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** Unchanged from the original DataTable. */
const PAGE_SIZE = 25;

const NUMERIC_KEYS: ReadonlySet<string> = new Set(
  COLUMNS.filter((c) => c.numeric).map((c) => c.key),
);

const ROI_TONE_CLASS = {
  good: 'text-ok',
  bad: 'text-bad',
  neutral: 'text-ink-body',
} as const;

function renderCell(product: NormProduct, key: ColumnKey): ReactNode {
  const value = product[key as keyof NormProduct];

  switch (key) {
    case 'id':
      return <span className="font-mono text-[12.5px] text-ink-tertiary">{String(value ?? '')}</span>;
    case 'title':
      return (
        <span className="block max-w-[240px] truncate font-medium text-ink" title={String(value ?? '')}>
          {String(value ?? '')}
        </span>
      );
    case 'variant':
      return <span className="text-ink-secondary">{String(value ?? '')}</span>;
    case 'metaSpend':
    case 'googleCost':
    case 'totalSpend':
    case 'revenue':
    case 'cpm':
      return <span className="tabular-nums">{inr(Number(value ?? 0))}</span>;
    case 'roi': {
      const r = Number(value ?? 0);
      return (
        <span className={cn('font-medium tabular-nums', ROI_TONE_CLASS[roiTone(r)])}>
          {roi(r)}
        </span>
      );
    }
    case 'itemsSold':
      return <span className="tabular-nums">{num(Number(value ?? 0))}</span>;
    case 'ctr':
      return <span className="tabular-nums">{Number(value ?? 0).toFixed(1)}%</span>;
    default:
      return String(value ?? '');
  }
}

export interface ProductTableProps {
  products: NormProduct[];
  columns: ColumnKey[];
  /** Total before search/filters, shown as the denominator. */
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
}

export function ProductTable({
  products, columns, totalCount, search, onSearchChange, onClearFilters,
}: ProductTableProps) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => sortProducts(products, sort, NUMERIC_KEYS), [products, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  // Reset to page 1 whenever the row count changes (new merge, new filter).
  const prevLength = useRef(sorted.length);
  useEffect(() => {
    if (prevLength.current !== sorted.length) {
      prevLength.current = sorted.length;
      setPage(1);
    }
  }, [sorted.length]);

  const safePage = Math.min(page, totalPages);
  const visible = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage],
  );

  const first = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const last = Math.min(safePage * PAGE_SIZE, sorted.length);

  function toggleSort(key: ColumnKey) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null; // third click restores the original order
    });
    setPage(1);
  }

  return (
    <div className="space-y-3.5">
      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by product ID, title or variant…"
            aria-label="Search products"
            className="h-10 w-full rounded-control border border-line bg-field pl-9 pr-9 text-[13.5px] text-ink transition-colors focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand-tint"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              title="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="flex-shrink-0 whitespace-nowrap text-[13px] text-ink-secondary tabular-nums">
          <span className="font-medium text-ink">{num(sorted.length)}</span> of {num(totalCount)}{' '}
          products
        </p>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-panel border border-line bg-panel">
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {columns.map((key) => {
                  const def = columnDef(key);
                  const active = sort?.key === key;
                  return (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={
                        active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      className={cn(
                        'sticky top-0 z-[5] whitespace-nowrap border-b border-line-subtle bg-header',
                        'px-4 py-3 text-[10.5px] font-semibold tracking-[0.1em]',
                        def.align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        title={`Sort by ${def.label}`}
                        className={cn(
                          'inline-flex items-center gap-1.5 transition-colors',
                          def.align === 'right' && 'flex-row-reverse',
                          active ? 'text-ink' : 'text-ink-tertiary hover:text-ink',
                        )}
                      >
                        {def.label.toUpperCase()}
                        {active ? (
                          sort.direction === 'asc' ? (
                            <ChevronUp className="h-3 w-3 text-brand" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-brand" />
                          )
                        ) : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {visible.map((product, i) => (
                <tr
                  key={String(product.id ?? i)}
                  data-product-id={product.id}
                  className="transition-colors hover:bg-panel-raised"
                >
                  {columns.map((key) => (
                    <td
                      key={key}
                      className={cn(
                        'whitespace-nowrap border-b border-line-subtle px-4 py-3 text-[13px] text-ink-body',
                        columnDef(key).align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {renderCell(product, key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="px-5 py-16 text-center animate-fade-in">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-panel border border-line bg-panel-sunken text-ink-faint animate-floaty">
              <Search className="h-4 w-4" />
            </div>
            <p className="mb-1.5 text-[15px] font-medium text-ink">No products match</p>
            <p className="text-[13px] text-ink-muted">
              Try a shorter search term or clear the metric filters.
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-5 inline-flex h-9 items-center rounded-control border border-line px-4 text-[13px] text-ink-body transition-colors hover:border-line-hover"
            >
              Clear search &amp; filters
            </button>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between gap-4 border-t border-line-subtle px-5 py-3.5">
          <p className="text-[12.5px] text-ink-tertiary tabular-nums">
            {sorted.length === 0 ? (
              'No rows'
            ) : (
              <>
                Showing{' '}
                <span className="font-medium text-ink">
                  {num(first)}–{num(last)}
                </span>{' '}
                of <span className="font-medium text-ink">{num(sorted.length)}</span> products
              </>
            )}
          </p>

          <div className="flex items-center gap-1">
            <PagerButton onClick={() => setPage(1)} disabled={safePage === 1} title="First page">
              <ChevronsLeft className="h-3.5 w-3.5" />
            </PagerButton>
            <PagerButton
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              title="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </PagerButton>

            <PagePills page={safePage} totalPages={totalPages} onPage={setPage} />

            <PagerButton
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              title="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </PagerButton>
            <PagerButton
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              title="Last page"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </PagerButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function PagerButton({
  onClick, disabled, title, children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-secondary transition-colors hover:bg-panel-raised disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Pill window logic preserved from the original DataTable. */
function PagePills({
  page, totalPages, onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const pills: (number | '…')[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pills.push(i);
  } else {
    pills.push(1);
    if (page > 3) pills.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pills.push(i);
    }
    if (page < totalPages - 2) pills.push('…');
    pills.push(totalPages);
  }

  return (
    <div className="flex items-center gap-0.5">
      {pills.map((pill, i) =>
        pill === '…' ? (
          <span key={`gap-${i}`} className="w-7 text-center text-[11px] text-ink-faint">
            …
          </span>
        ) : (
          <button
            key={pill}
            type="button"
            onClick={() => onPage(pill)}
            aria-current={page === pill ? 'page' : undefined}
            className={cn(
              'h-7 min-w-7 rounded-chip px-1.5 text-[12.5px] transition-colors tabular-nums',
              page === pill
                ? 'bg-brand font-semibold text-white'
                : 'text-ink-secondary hover:bg-panel-raised',
            )}
          >
            {pill}
          </button>
        ),
      )}
    </div>
  );
}
