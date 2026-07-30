'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import {
  DEFAULT_COLUMNS, FILTERABLE_METRICS, FIXED_COLUMNS,
  TOGGLEABLE_COLUMNS, columnDef, orderColumns, type ColumnKey,
} from '@/lib/product-columns';
import type { ActiveFilter, FilterOperator } from '@/lib/product-metrics';
import { useClickOutside } from '@/hooks/use-click-outside';
import { cn } from '@/lib/utils';

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: '>', label: 'is greater than' },
  { value: '<', label: 'is less than' },
  { value: '=', label: 'is exactly' },
  { value: '>=', label: 'is at least' },
  { value: '<=', label: 'is at most' },
  { value: 'between', label: 'is between' },
];

/** A filter row being edited — values stay strings until Apply. */
interface FilterDraft {
  id: string;
  metric: string;
  operator: FilterOperator;
  value: string;
  value2?: string;
}

const SELECT_CLASS =
  'h-9 rounded-control border border-line bg-field px-2.5 text-[13px] text-ink-body ' +
  'transition-colors focus:border-brand focus:outline-none';

export interface ColumnsAndFiltersProps {
  visibleColumns: ColumnKey[];
  onVisibleColumnsChange: (columns: ColumnKey[]) => void;
  activeFilters: ActiveFilter[];
  onActiveFiltersChange: (filters: ActiveFilter[]) => void;
}

export function ColumnsAndFilters({
  visibleColumns,
  onVisibleColumnsChange,
  activeFilters,
  onActiveFiltersChange,
}: ColumnsAndFiltersProps) {
  const [drafts, setDrafts] = useState<FilterDraft[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useClickOutside(addRef, useCallback(() => setAddOpen(false), []), addOpen);

  const shownToggleable = TOGGLEABLE_COLUMNS.filter((c) => visibleColumns.includes(c.key));
  const hidden = TOGGLEABLE_COLUMNS.filter((c) => !visibleColumns.includes(c.key));

  function removeColumn(key: ColumnKey) {
    onVisibleColumnsChange(visibleColumns.filter((k) => k !== key));
  }

  function addColumn(key: ColumnKey) {
    onVisibleColumnsChange(orderColumns([...visibleColumns, key]));
    setAddOpen(false);
  }

  function resetAll() {
    onVisibleColumnsChange([...DEFAULT_COLUMNS]);
    setDrafts([]);
    onActiveFiltersChange([]);
  }

  function apply() {
    // Same guard as before: a row needs a metric and a value to count.
    const next: ActiveFilter[] = drafts
      .filter((d) => d.metric && d.value !== '')
      .map((d) => ({
        metric: d.metric,
        operator: d.operator,
        value: parseFloat(d.value) || 0,
        value2: d.value2 ? parseFloat(d.value2) : undefined,
      }));
    onActiveFiltersChange(next);
    setExpanded(false);
  }

  function clearFilters() {
    setDrafts([]);
    onActiveFiltersChange([]);
  }

  function updateDraft(id: string, patch: Partial<FilterDraft>) {
    setDrafts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <section className="overflow-hidden rounded-panel border border-line bg-panel">
      {/* Columns */}
      <div className="border-b border-line-subtle px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[10.5px] font-semibold tracking-[0.12em] text-ink-muted">
            COLUMNS SHOWN
          </h2>
          <div className="flex items-center gap-4">
            {hidden.length > 0 && (
              <div className="relative" ref={addRef}>
                <button
                  type="button"
                  onClick={() => setAddOpen((o) => !o)}
                  aria-expanded={addOpen}
                  className="flex items-center gap-1 text-[12.5px] font-medium text-brand-300 transition-colors hover:text-brand-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add column
                </button>
                {addOpen && (
                  <div className="absolute right-0 top-6 z-[60] min-w-[190px] rounded-panel border border-line bg-overlay p-1.5 shadow-overlay animate-fade-up">
                    {hidden.map((col) => (
                      <button
                        key={col.key}
                        type="button"
                        onClick={() => addColumn(col.key)}
                        className="flex w-full items-center justify-between gap-3 rounded-chip px-2.5 py-2 text-[13px] text-ink-body transition-colors hover:bg-panel-raised"
                      >
                        {col.label}
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-tertiary">
                          {col.source}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={resetAll}
              className="whitespace-nowrap text-[12.5px] text-brand-300 transition-colors hover:text-brand-100"
            >
              Reset to default
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Product ID and Title are always present, so they read as locked. */}
          {FIXED_COLUMNS.map((key) => (
            <span
              key={key}
              title="Always shown"
              className="inline-flex items-center gap-2 rounded-chip border border-line bg-panel-sunken px-2.5 py-1.5 text-[12.5px] text-ink-tertiary"
            >
              {columnDef(key).label}
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9.5px] text-ink-muted">
                {columnDef(key).source}
              </span>
            </span>
          ))}

          {shownToggleable.map((col) => (
            <button
              key={col.key}
              type="button"
              onClick={() => removeColumn(col.key)}
              title={`Hide ${col.label}`}
              className="inline-flex items-center gap-2 rounded-chip border border-brand-tint bg-brand-tint px-2.5 py-1.5 text-[12.5px] text-ink transition-colors hover:border-line-hover"
            >
              {col.label}
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9.5px] text-ink-tertiary">
                {col.source}
              </span>
              <X className="h-3 w-3 text-ink-muted" />
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-panel-raised"
        >
          <span className="flex items-center gap-2.5">
            <span className="text-[13px] font-medium text-ink">Metric filters</span>
            {activeFilters.length > 0 && (
              <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white">
                {activeFilters.length} active
              </span>
            )}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 text-ink-muted transition-transform', expanded && 'rotate-180')}
          />
        </button>

        {expanded && (
          <div className="space-y-3 px-5 pb-5 animate-fade-in">
            {drafts.length === 0 && (
              <p className="py-1 text-[13px] text-ink-muted">
                No filters yet — add one below. Filters combine with AND.
              </p>
            )}

            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="grid items-center gap-2"
                style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,150px) minmax(0,1fr) 34px' }}
              >
                <select
                  aria-label="Metric"
                  value={draft.metric}
                  onChange={(e) => updateDraft(draft.id, { metric: e.target.value })}
                  className={SELECT_CLASS}
                >
                  <option value="">Select metric</option>
                  {FILTERABLE_METRICS.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>

                <select
                  aria-label="Operator"
                  value={draft.operator}
                  onChange={(e) =>
                    updateDraft(draft.id, { operator: e.target.value as FilterOperator })
                  }
                  className={SELECT_CLASS}
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>

                {draft.operator === 'between' ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      placeholder="Min"
                      aria-label="Minimum"
                      value={draft.value}
                      onChange={(e) => updateDraft(draft.id, { value: e.target.value })}
                      className={cn(SELECT_CLASS, 'min-w-0 flex-1')}
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      aria-label="Maximum"
                      value={draft.value2 ?? ''}
                      onChange={(e) => updateDraft(draft.id, { value2: e.target.value })}
                      className={cn(SELECT_CLASS, 'min-w-0 flex-1')}
                    />
                  </div>
                ) : (
                  <input
                    type="number"
                    placeholder="Value"
                    aria-label="Value"
                    value={draft.value}
                    onChange={(e) => updateDraft(draft.id, { value: e.target.value })}
                    className={cn(SELECT_CLASS, 'min-w-0')}
                  />
                )}

                <button
                  type="button"
                  onClick={() => setDrafts((rows) => rows.filter((r) => r.id !== draft.id))}
                  title="Remove filter"
                  className="flex h-9 w-[34px] items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-panel-raised hover:text-bad"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setDrafts((rows) => [
                  ...rows,
                  { id: `f${rows.length}_${Date.now()}`, metric: '', operator: '>', value: '' },
                ])
              }
              className="flex items-center gap-2 text-[13px] text-brand-300 transition-colors hover:text-brand-100"
            >
              <Plus className="h-4 w-4" />
              Add filter
            </button>

            <div className="flex items-center justify-end gap-3 border-t border-line-subtle pt-3.5">
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 rounded-control px-3.5 text-[13px] text-ink-secondary transition-colors hover:text-ink"
              >
                Clear filters
              </button>
              <button
                type="button"
                onClick={apply}
                className="h-9 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-transform hover:-translate-y-px"
              >
                Apply filters
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
