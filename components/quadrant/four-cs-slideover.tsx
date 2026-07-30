'use client';

import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { QUADRANT_ORDER, QUADRANTS, type QuadrantKey } from '@/lib/quadrants';
import { cn } from '@/lib/utils';

/** Guidance per quadrant, unchanged in substance from the original slide-over. */
const ADVICE: Record<QuadrantKey, string> = {
  champions:
    'Your best scaling opportunities — high revenue on relatively low investment. Increase budget deliberately while the creative holds.',
  contenders:
    'These carry the revenue base at real cost. Defend ROI rather than chase more volume.',
  cruisers:
    'Cheap to run and cheap to retire. Refresh the creative, bundle them, or retire the SKU.',
  casualties:
    'Burning budget without adequate return. Pause immediately and restructure before re-testing.',
};

/** Grid position mirrors the scatter plot: revenue up, spend right. */
const GRID_ORDER: QuadrantKey[] = ['champions', 'contenders', 'cruisers', 'casualties'];

export function FourCsSlideover({ open, onClose }: { open: boolean; onClose: () => void }) {
  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[3px] animate-fade-in"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="How the 4Cs work"
        className="fixed right-0 top-0 z-[90] h-full w-full max-w-[480px] overflow-y-auto border-l border-line bg-overlay px-8 py-7 shadow-overlay animate-fade-in"
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">
              How the 4Cs work
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              A 2×2 of revenue against spend that classifies every product
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded p-1.5 text-ink-muted transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* 2x2 diagram */}
        <div className="mb-7 flex gap-3">
          <div className="flex w-4 items-center justify-center">
            <span className="whitespace-nowrap text-[10px] font-semibold tracking-[0.12em] text-ink-muted [writing-mode:vertical-rl] rotate-180">
              REVENUE →
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-2">
              {GRID_ORDER.map((key) => {
                const meta = QUADRANTS[key];
                return (
                  <div
                    key={key}
                    className={cn('rounded-control border border-line p-3.5', meta.tintClass)}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className={cn('text-[13px] font-medium', meta.textClass)}>
                        {meta.label}
                      </span>
                      <span
                        className={cn(
                          'rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em]',
                          meta.textClass,
                        )}
                      >
                        {meta.tag.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-ink-secondary">{meta.rule}</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2.5 text-center text-[10px] font-semibold tracking-[0.12em] text-ink-muted">
              SPEND →
            </p>
          </div>
        </div>

        {/* Per-quadrant guidance */}
        <div className="space-y-3">
          {QUADRANT_ORDER.map((key) => {
            const meta = QUADRANTS[key];
            return (
              <div key={key} className="rounded-control border border-line bg-panel p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2.5">
                  <span className={cn('h-2 w-2 rounded-sm', meta.dotClass)} />
                  <span className="text-[13.5px] font-medium text-ink">{meta.label}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em]',
                      meta.tintClass,
                      meta.textClass,
                    )}
                  >
                    {meta.tag.toUpperCase()}
                  </span>
                </div>
                <p className="mb-2 text-[12px] text-ink-muted">{meta.rule}</p>
                <p className="text-[12.5px] leading-relaxed text-ink-body">{ADVICE[key]}</p>
              </div>
            );
          })}
        </div>

        <p className="mt-6 border-t border-line-subtle pt-4 text-[12.5px] leading-relaxed text-ink-secondary">
          Cut-offs default to the <strong className="font-medium text-ink">mean total spend</strong>{' '}
          and <strong className="font-medium text-ink">mean revenue</strong> of the products in view
          — 100% on both sliders. Move them to explore other scenarios; every figure recalculates
          live against the months you have selected.
        </p>
      </aside>
    </>
  );
}
