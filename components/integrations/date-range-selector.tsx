'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RangePreset {
  label: string;
  days: number;
}

export const RANGE_PRESETS: RangePreset[] = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
];

/**
 * Coarse range control for Integration mode: each press re-queries the
 * already-synced data stored in Postgres (GET /api/v1/analytics/products
 * with a different since/until) — never Shopify or Meta's own APIs. The
 * existing per-month picker in the app header still narrows further within
 * whatever range is loaded, with zero extra requests of any kind.
 */
export function DateRangeSelector({
  activeDays, loading, onSelect,
}: { activeDays: number; loading: boolean; onSelect: (days: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          disabled={loading}
          onClick={() => onSelect(preset.days)}
          className={cn(
            'flex items-center gap-1.5 rounded-chip border px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-60',
            activeDays === preset.days
              ? 'border-brand/40 bg-brand-tint text-brand-100'
              : 'border-line-subtle bg-panel-sunken text-ink-tertiary hover:border-line-hover',
          )}
        >
          {loading && activeDays === preset.days && <Loader2 className="h-3 w-3 animate-spin" />}
          {preset.label}
        </button>
      ))}
    </div>
  );
}
