import type { NormProduct } from './context';

export interface CohortStats {
  count: number;
  spend: number;
  revenue: number;
  roi: number;
  items: number;
  avgCtr: number;
  avgCpm: number;
  /** Revenue per unit sold. */
  aov: number;
}

/**
 * Per-cohort totals, lifted from computeStats in the original
 * app/discount-analysis/page.tsx.
 *
 * NOTE — avgCtr and avgCpm are UNWEIGHTED means here (sum ÷ product count),
 * which is what the discount screen has always shown. The product screen
 * weights CTR by landing-page views and CPM by Meta spend
 * (lib/product-metrics.computeTotals), so the same label can differ between
 * the two screens. Preserved rather than silently unified, because changing it
 * would move numbers users may be reconciling against. Worth unifying, but as
 * a deliberate decision.
 */
export function computeCohortStats(products: NormProduct[]): CohortStats {
  if (products.length === 0) {
    return { count: 0, spend: 0, revenue: 0, roi: 0, items: 0, avgCtr: 0, avgCpm: 0, aov: 0 };
  }

  const spend = products.reduce((s, p) => s + p.totalSpend, 0);
  const revenue = products.reduce((s, p) => s + p.revenue, 0);
  const items = products.reduce((s, p) => s + p.itemsSold, 0);

  return {
    count: products.length,
    spend,
    revenue,
    roi: spend > 0 ? revenue / spend : 0,
    items,
    avgCtr: products.reduce((s, p) => s + p.ctr, 0) / products.length,
    avgCpm: products.reduce((s, p) => s + p.cpm, 0) / products.length,
    aov: items > 0 ? revenue / items : 0,
  };
}

export interface DiscountSplit {
  discounted: NormProduct[];
  nonDiscounted: NormProduct[];
  d: CohortStats;
  nd: CohortStats;
  /**
   * How many times better the winning cohort's ROI is. Always >= 1, with
   * `winner` naming which side it favours — the original always divided
   * non-discounted by discounted and asserted non-discounted won, which
   * produced sentences like "returns 0.42x more" when the reverse was true.
   */
  roiAdvantage: number;
  winner: 'discounted' | 'non-discounted' | 'tie';
  /** 20% of discounted spend — the original reallocation suggestion. */
  reallocationAmount: number;
}

export function splitByDiscount(products: NormProduct[]): DiscountSplit {
  const discounted = products.filter((p) => p.discounted);
  const nonDiscounted = products.filter((p) => !p.discounted);

  const d = computeCohortStats(discounted);
  const nd = computeCohortStats(nonDiscounted);

  let winner: DiscountSplit['winner'] = 'tie';
  let roiAdvantage = 0;
  if (d.roi > 0 && nd.roi > 0) {
    if (nd.roi > d.roi) {
      winner = 'non-discounted';
      roiAdvantage = nd.roi / d.roi;
    } else if (d.roi > nd.roi) {
      winner = 'discounted';
      roiAdvantage = d.roi / nd.roi;
    } else {
      roiAdvantage = 1;
    }
  }

  return {
    discounted,
    nonDiscounted,
    d,
    nd,
    roiAdvantage,
    winner,
    reallocationAmount: d.spend * 0.2,
  };
}
