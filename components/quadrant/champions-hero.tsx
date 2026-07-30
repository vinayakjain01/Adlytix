'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, Download, Star, X } from 'lucide-react';
import type { NormProduct } from '@/lib/context';
import { buildScalePlan, selectScalableChampions } from '@/lib/quadrants';
import { buildScalePlanExportRows, downloadCsv } from '@/lib/csv-export';
import { track } from '@/lib/analytics/client';
import { currencySymbol, inr, num, roi, roiTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const TONE_CLASS = { good: 'text-ok', bad: 'text-bad', neutral: 'text-ink' } as const;

/**
 * "Where to act first" — the top Champions and the budget recommendation.
 *
 * All coefficients live in lib/quadrants.buildScalePlan and are unchanged:
 * +50% budget, 15% conservative ROI decay, and an estimated additional
 * revenue of (champion spend x 0.5 x blended champion ROI).
 */
export function ChampionsHero({
  products,
  spendThreshold,
  revenueThreshold,
}: {
  products: NormProduct[];
  spendThreshold: number;
  revenueThreshold: number;
}) {
  const [planOpen, setPlanOpen] = useState(false);

  const champions = selectScalableChampions(products, spendThreshold, revenueThreshold);

  if (champions.length === 0) {
    return (
      <section className="rounded-card border border-line bg-panel px-6 py-8 text-center">
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          No scalable Champions at these cut-offs — that needs revenue ≥{' '}
          <span className="text-ink">{inr(revenueThreshold, true)}</span> with spend between 0 and{' '}
          <span className="text-ink">{inr(spendThreshold, true)}</span>.
          <br />
          Adjust the threshold sliders to explore other cut-offs.
        </p>
      </section>
    );
  }

  const plan = buildScalePlan(champions);

  function downloadPlan() {
    downloadCsv(
      'roasify_scale_plan.csv',
      buildScalePlanExportRows(plan.rows, currencySymbol(), roi),
    );
    track('csv_downloaded', {
      kind: 'scale-plan',
      row_count: plan.rows.length,
      was_filtered: false,
      filter_count: 0,
      filename_length: null,
    });
    toast.success('Scale-spend plan exported');
  }

  return (
    <section className="overflow-hidden rounded-card border border-line bg-[linear-gradient(180deg,rgb(52_211_153_/_0.08),transparent_60%)]">
      <div className="px-6 py-6">
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <Star className="h-3.5 w-3.5 text-q-champions" />
          <span className="text-[11px] font-semibold tracking-[0.12em] text-q-champions">
            WHERE TO ACT FIRST
          </span>
          <span className="rounded border border-q-champions/25 bg-q-champions-tint px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.06em] text-q-champions">
            SCALE
          </span>
        </div>

        <h2 className="mb-6 max-w-3xl text-[21px] font-medium leading-snug tracking-[-0.02em] text-ink">
          <span className="text-q-champions">
            {champions.length} Champion{champions.length > 1 ? 's' : ''}
          </span>{' '}
          together return <span className="text-q-champions">{roi(plan.roi)}</span> on{' '}
          {inr(plan.totalSpend)} of spend.
        </h2>

        <div className="mb-5 grid gap-3.5 lg:grid-cols-3">
          {champions.map((product) => (
            <div key={product.id} className="rounded-control border border-line bg-panel p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <span className="flex-1 text-[13.5px] font-medium leading-snug text-ink">
                  {product.title}
                  {product.variant ? ` — ${product.variant}` : ''}
                </span>
                <span
                  className={cn(
                    'flex-shrink-0 text-[17px] font-semibold tabular-nums',
                    TONE_CLASS[roiTone(product.roi)],
                  )}
                >
                  {roi(product.roi)}
                </span>
              </div>
              <p className="text-[11.5px] text-ink-muted">
                Meta {inr(product.metaSpend)} · Total spend {inr(product.totalSpend)}
              </p>
              <p className="mb-2 text-[11.5px] text-ink-muted">
                Revenue {inr(product.revenue)} · {num(product.itemsSold)} units
              </p>
              <p className="line-clamp-2 text-[11.5px] leading-relaxed text-ink-secondary">
                Returns {roi(product.roi)} per {currencySymbol()}1 spent — scale while the creative
                performs.
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-control border border-line bg-panel-sunken px-4 py-3.5">
          <p className="text-[13px] text-ink-secondary">
            Estimated additional revenue at +50% spend:{' '}
            <span className="font-medium text-ink">{inr(plan.estimatedAdditionalRevenue)}</span>
          </p>
          <button
            type="button"
            onClick={() => setPlanOpen(true)}
            className="flex h-9 items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-transform hover:-translate-y-px"
          >
            Create scale-spend plan
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {planOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scale-spend plan for Champions"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px] animate-fade-in"
          onClick={() => setPlanOpen(false)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-card border border-line-strong bg-overlay shadow-overlay animate-fade-up"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-6 py-4">
              <div>
                <h3 className="text-[16px] font-semibold text-ink">Scale-spend plan — Champions</h3>
                <p className="mt-1 text-[11.5px] text-ink-muted">
                  +50% budget · 15% conservative ROI decay
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                title="Close"
                className="rounded p-1 text-ink-muted transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="overflow-x-auto px-6 py-5">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line-subtle text-[10.5px] font-semibold tracking-[0.1em] text-ink-muted">
                    <th scope="col" className="pb-2.5 text-left">PRODUCT</th>
                    <th scope="col" className="pb-2.5 text-right">CURRENT SPEND</th>
                    <th scope="col" className="pb-2.5 text-right">SUGGESTED BUDGET</th>
                    <th scope="col" className="pb-2.5 text-right">EXPECTED REVENUE</th>
                    <th scope="col" className="pb-2.5 text-right">EST. ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.product} className="border-b border-line-subtle last:border-b-0">
                      <td className="max-w-[220px] truncate py-3 font-medium text-ink">{row.product}</td>
                      <td className="py-3 text-right text-ink-secondary tabular-nums">{inr(row.currentSpend)}</td>
                      <td className="py-3 text-right font-semibold text-ink tabular-nums">{inr(row.suggestedBudget)}</td>
                      <td className="py-3 text-right text-ok tabular-nums">{inr(row.expectedRevenue)}</td>
                      <td className="py-3 text-right text-ok tabular-nums">{roi(row.roiAtScale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-[11.5px] leading-relaxed text-ink-muted">
                * Conservative estimate: 15% ROI decay at 1.5× spend. Actual results may vary.
              </p>
            </div>

            <footer className="flex justify-end gap-3 border-t border-line-subtle px-6 py-4">
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="h-9 rounded-control border border-line px-4 text-[13px] text-ink-body transition-colors hover:border-line-hover"
              >
                Close
              </button>
              <button
                type="button"
                onClick={downloadPlan}
                className="flex h-9 items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-transform hover:-translate-y-px"
              >
                <Download className="h-3.5 w-3.5" />
                Download plan CSV
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
