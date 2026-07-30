'use client';

import { ArrowRight, Download } from 'lucide-react';
import Link from 'next/link';
import type { NormProduct } from '@/lib/context';
import type { ActiveFilter } from '@/lib/product-metrics';
import { num } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export interface ExportBandProps {
  products: NormProduct[];
  activeFilters: ActiveFilter[];
  filename: string;
  onFilenameChange: (value: string) => void;
  onDownload: () => void;
}

export function ExportBand({
  products, activeFilters, filename, onFilenameChange, onDownload,
}: ExportBandProps) {
  const disabled = products.length === 0;

  return (
    <section className="rounded-panel border border-line bg-panel p-5">
      <div className="grid items-center gap-5 lg:grid-cols-[1fr_auto_minmax(0,1fr)]">
        <label className="flex items-center gap-3">
          <span className="flex-shrink-0 text-[13px] text-ink-muted">filename:</span>
          <input
            type="text"
            value={filename}
            onChange={(e) => onFilenameChange(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-control border border-line bg-field px-3 font-mono text-[12.5px] text-ink transition-colors focus:border-brand focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={onDownload}
          disabled={disabled}
          className={cn(
            'flex h-9 items-center justify-center gap-2 rounded-control px-5 text-[13px] font-medium transition-transform',
            disabled
              ? 'cursor-not-allowed bg-panel-raised text-ink-faint'
              : 'bg-brand-gradient text-white shadow-brand hover:-translate-y-px',
          )}
        >
          <Download className="h-3.5 w-3.5" />
          Download CSV
          {!disabled && <span className="opacity-80">({num(products.length)})</span>}
        </button>

        <Link
          href="/quadrant-view"
          className="group rounded-control border border-line bg-panel-sunken p-4 transition-colors hover:border-brand"
        >
          <span className="mb-1 flex items-center justify-between gap-3">
            <span className="text-[13.5px] font-medium text-ink">Continue to 4C quadrant</span>
            <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-brand-300" />
          </span>
          <span className="block text-[12.5px] leading-relaxed text-ink-muted">
            Classify these {products.length || '—'} products into Champions, Contenders, Cruisers
            and Casualties.
          </span>
        </Link>
      </div>

      {activeFilters.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3.5">
          <span className="text-[11.5px] text-ink-muted">
            Active filters are recorded in the downloaded sheet:
          </span>
          {activeFilters.map((f, i) => (
            <span
              key={`${f.metric}-${i}`}
              className="rounded bg-brand-tint px-2 py-0.5 font-mono text-[11px] text-brand-200"
            >
              {f.metric} {f.operator} {f.value}
              {f.value2 !== undefined ? ` – ${f.value2}` : ''}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
