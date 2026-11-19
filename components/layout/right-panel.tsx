import type { ReactNode } from 'react';
import { num } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <h4 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-ink-muted">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function PanelRow({
  label, value, mono,
}: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-ink-body">{label}</span>
      <span className={cn('text-right text-[13px] text-ink tabular-nums', mono && 'font-mono text-[12.5px]')}>
        {value}
      </span>
    </div>
  );
}

export function SourceItem({
  name, rows, connected,
}: { name: string; rows: number; connected: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span
        aria-hidden
        className={cn('h-2 w-2 flex-shrink-0 rounded-full', connected ? 'bg-emerald-500' : 'bg-ink-faint')}
      />
      <span className="text-[13px] text-ink">{name}</span>
      <span className="ml-auto text-[13px] text-ink-muted tabular-nums">{num(rows)} rows</span>
    </div>
  );
}
