'use client';

import { TrendingUp } from 'lucide-react';
import type { DiscountSplit } from '@/lib/discount-metrics';
import { currencySymbol, inr, num, roi } from '@/lib/formatters';

/**
 * The read-out.
 *
 * The original NarrativeCard stated its conclusions unconditionally — "Discounts
 * are eroding margin faster than they are driving volume" and "Non-discounted
 * products return Nx more per rupee" — regardless of what the numbers said. When
 * discounting outperformed, the screen still reported the opposite and printed a
 * sub-1 "advantage" multiple. Every sentence here is derived from the split.
 */
export function DiscountNarrative({ split }: { split: DiscountSplit }) {
  const { d, nd, winner, roiAdvantage, reallocationAmount } = split;

  const hasBoth = d.count > 0 && nd.count > 0;

  const headline = !hasBoth
    ? d.count === 0
      ? 'No discounted products in this selection, so there is nothing to compare against yet.'
      : 'Every product in this selection is discounted, so there is no full-price cohort to compare against.'
    : winner === 'non-discounted'
      ? `Full-price products return ${roiAdvantage.toFixed(2)}× more per ${currencySymbol()}1 spent — ${roi(nd.roi)} against ${roi(d.roi)}.`
      : winner === 'discounted'
        ? `Discounting is earning its keep: discounted products return ${roiAdvantage.toFixed(2)}× more per unit of spend — ${roi(d.roi)} against ${roi(nd.roi)}.`
        : `Both cohorts return the same ROI (${roi(d.roi)}), so the discount is neither helping nor hurting efficiency.`;

  const points: { label: string; body: string }[] = [];

  if (hasBoth) {
    points.push({
      label: 'WHAT THE NUMBERS SAY',
      body:
        `${num(d.count)} discounted product${d.count === 1 ? '' : 's'} consumed ${inr(d.spend, true)} of ad spend and ` +
        `returned ${inr(d.revenue, true)}. ${num(nd.count)} full-price product${nd.count === 1 ? '' : 's'} spent ` +
        `${inr(nd.spend, true)} and returned ${inr(nd.revenue, true)}.`,
    });

    points.push({
      label: 'BASKET SIZE',
      body:
        d.aov === 0 || nd.aov === 0
          ? 'Average order value cannot be compared — one cohort sold no units in this selection.'
          : d.aov < nd.aov
            ? `Discounted orders are smaller: ${inr(d.aov)} against ${inr(nd.aov)} at full price, across ` +
              `${num(d.items)} and ${num(nd.items)} units respectively.`
            : `Discounted orders are larger: ${inr(d.aov)} against ${inr(nd.aov)} at full price, across ` +
              `${num(d.items)} and ${num(nd.items)} units respectively.`,
    });

    points.push({
      label: 'WHAT TO DO NEXT',
      body:
        winner === 'non-discounted'
          ? `Discounting is costing efficiency here. Consider moving about ${inr(reallocationAmount, true)} — 20% of ` +
            `discounted spend — toward the strongest full-price products, and test reducing discount depth on the ` +
            `weakest discounted lines before cutting them.`
          : winner === 'discounted'
            ? `The discount is pulling its weight. Hold it on the strongest discounted lines and check margin, not just ` +
              `ROI, before widening it — ROI ignores the discount's cost of goods.`
            : 'With ROI level between cohorts, decide on margin rather than ROI: the discounted lines are earning the same return while giving away price.',
    });
  }

  return (
    <section className="rounded-card border border-line border-l-[3px] border-l-brand bg-panel px-6 py-5">
      <h2 className="mb-4 flex items-center gap-2.5 text-[15px] font-medium text-ink">
        <TrendingUp className="h-4 w-4 text-brand-300" />
        What this means
      </h2>

      <p className="mb-5 max-w-3xl text-[14px] leading-relaxed text-ink-body">{headline}</p>

      {points.length > 0 && (
        <dl className="space-y-4">
          {points.map((point) => (
            <div key={point.label}>
              <dt className="mb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-muted">
                {point.label}
              </dt>
              <dd className="max-w-3xl text-[13px] leading-relaxed text-ink-secondary">
                {point.body}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="mt-5 border-t border-line-subtle pt-3.5 text-[11.5px] leading-relaxed text-ink-muted">
        A product counts as discounted if its ID appears in the uploaded discount list. ROI is
        revenue ÷ total spend and does not account for the margin given away by the discount
        itself.
      </p>
    </section>
  );
}
