'use client';

import { useCallback, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { useApp } from '@/lib/context';
import { useClickOutside } from '@/hooks/use-click-outside';
import { cn } from '@/lib/utils';

/**
 * Global month filter. Reads and writes the existing AppContext selection —
 * the aggregation it drives (context.aggregatedProducts) is unchanged.
 */
export function MonthPicker() {
  const { allMonths, selectedMonths, toggleMonth, selectAllMonths } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const hasMonths = allMonths.length > 0;
  const allSelected = hasMonths && selectedMonths.size === allMonths.length;

  const label = !hasMonths
    ? 'All data'
    : allSelected
      ? `All ${allMonths.length} months`
      : selectedMonths.size === 1
        ? Array.from(selectedMonths)[0]
        : `${selectedMonths.size} of ${allMonths.length} months`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasMonths}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={hasMonths ? 'Filter by month' : 'Merge data first to enable the month filter'}
        className={cn(
          'flex h-[34px] items-center gap-2 whitespace-nowrap rounded-control border px-3',
          'text-[13px] transition-colors',
          hasMonths
            ? 'border-line bg-field text-ink-body hover:border-line-hover'
            : 'cursor-not-allowed border-line bg-field text-ink-disabled',
          !allSelected && hasMonths && 'border-line-strong text-brand-200',
        )}
      >
        <CalendarDays className="h-3.5 w-3.5 text-ink-muted" />
        <span className="max-w-[190px] truncate">{label}</span>
        <ChevronDown
          className={cn('h-3 w-3 text-ink-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && hasMonths && (
        <div
          role="listbox"
          aria-multiselectable
          className={cn(
            'absolute right-0 top-[42px] z-[60] w-[220px] rounded-panel border border-line',
            'bg-overlay p-1.5 shadow-overlay animate-fade-up',
          )}
        >
          <button
            type="button"
            onClick={selectAllMonths}
            className={cn(
              'flex w-full items-center justify-between rounded-chip px-2.5 py-2 text-[13px]',
              'transition-colors hover:bg-panel-raised',
              allSelected ? 'text-brand-200' : 'text-ink-body',
            )}
          >
            All months
            {allSelected && <Check className="h-3.5 w-3.5 text-brand" />}
          </button>

          <div className="my-1.5 h-px bg-line-subtle" />

          {allMonths.map((month) => {
            const active = selectedMonths.has(month);
            return (
              <button
                key={month}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => toggleMonth(month)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-chip px-2.5 py-2 text-[13px]',
                  'transition-colors hover:bg-panel-raised',
                  active ? 'text-ink' : 'text-ink-secondary',
                )}
              >
                <span
                  className={cn(
                    'flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-[5px] border',
                    active ? 'border-brand bg-brand' : 'border-line-strong',
                  )}
                >
                  {active && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                </span>
                {month}
              </button>
            );
          })}

          <div className="mb-1 mt-1.5 h-px bg-line-subtle" />
          <p className="px-2.5 pb-1 text-[11px] leading-relaxed text-ink-muted">
            {selectedMonths.size} of {allMonths.length} selected · data aggregates across months
          </p>
        </div>
      )}
    </div>
  );
}
