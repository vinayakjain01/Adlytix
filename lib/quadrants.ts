/**
 * The 4C framework.
 *
 * Thresholds and the classify() rules are lifted verbatim from
 * app/quadrant-view/page.tsx and components/quadrant-view/quadrant-cards.tsx.
 *
 * Two details are load-bearing and deliberately preserved:
 *
 *  1. Cut-offs are the ARITHMETIC MEAN of the values on screen, scaled by the
 *     slider percentages — not the median. (The Adlytix prototype used a
 *     median, which would move products between quadrants.)
 *
 *  2. Spend is `totalSpend` (Meta + Google), matching what the screens have
 *     always displayed. The backend's own run_product_analysis computes its
 *     quadrants from Meta spend alone and its payload is never read by the UI,
 *     so the two do not agree — the front-end figures are the ones users see.
 */

import type { NormProduct } from './context';

export type QuadrantKey = 'champions' | 'contenders' | 'cruisers' | 'casualties';

export const QUADRANT_ORDER: QuadrantKey[] = [
  'champions', 'contenders', 'cruisers', 'casualties',
];

export interface QuadrantMeta {
  key: QuadrantKey;
  label: string;
  /** The recommended action. */
  tag: string;
  rule: string;
  /** Design-token class names, so callers don't re-derive the palette. */
  textClass: string;
  tintClass: string;
  borderClass: string;
  dotClass: string;
}

export const QUADRANTS: Record<QuadrantKey, QuadrantMeta> = {
  champions: {
    key: 'champions', label: 'Champions', tag: 'Scale',
    rule: 'High revenue · low spend',
    textClass: 'text-q-champions', tintClass: 'bg-q-champions-tint',
    borderClass: 'border-l-q-champions', dotClass: 'bg-q-champions',
  },
  contenders: {
    key: 'contenders', label: 'Contenders', tag: 'Protect',
    rule: 'High revenue · high spend',
    textClass: 'text-q-contenders', tintClass: 'bg-q-contenders-tint',
    borderClass: 'border-l-q-contenders', dotClass: 'bg-q-contenders',
  },
  cruisers: {
    key: 'cruisers', label: 'Cruisers', tag: 'Decide',
    rule: 'Low revenue · low spend',
    textClass: 'text-q-cruisers', tintClass: 'bg-q-cruisers-tint',
    borderClass: 'border-l-q-cruisers', dotClass: 'bg-q-cruisers',
  },
  casualties: {
    key: 'casualties', label: 'Casualties', tag: 'Cut',
    rule: 'Low revenue · high spend',
    textClass: 'text-q-casualties', tintClass: 'bg-q-casualties-tint',
    borderClass: 'border-l-q-casualties', dotClass: 'bg-q-casualties',
  },
};

export interface Thresholds {
  /** Mean total spend across the products on screen. */
  avgSpend: number;
  /** Mean revenue across the products on screen. */
  avgRevenue: number;
  /** avgSpend × spendPct / 100 */
  spend: number;
  /** avgRevenue × revPct / 100 */
  revenue: number;
}

export function computeThresholds(
  products: NormProduct[],
  spendPct = 100,
  revPct = 100,
): Thresholds {
  const avgSpend =
    products.length > 0
      ? products.reduce((s, p) => s + p.totalSpend, 0) / products.length
      : 0;
  const avgRevenue =
    products.length > 0
      ? products.reduce((s, p) => s + p.revenue, 0) / products.length
      : 0;

  return {
    avgSpend,
    avgRevenue,
    spend: avgSpend * (spendPct / 100),
    revenue: avgRevenue * (revPct / 100),
  };
}

/** Verbatim from quadrant-cards.tsx / quadrant-view/page.tsx. */
export function classify(
  product: NormProduct,
  spendThreshold: number,
  revenueThreshold: number,
): QuadrantKey {
  const hr = product.revenue >= revenueThreshold;
  const hs = product.totalSpend >= spendThreshold;
  if (hr && !hs) return 'champions';
  if (hr && hs) return 'contenders';
  if (!hr && !hs) return 'cruisers';
  return 'casualties';
}

export interface QuadrantBucket {
  key: QuadrantKey;
  meta: QuadrantMeta;
  products: NormProduct[];
  count: number;
  spend: number;
  revenue: number;
  roi: number;
  /** Share of the catalogue on screen, 0–100. */
  share: number;
}

/**
 * Champions eligible for a scale-spend plan.
 *
 * Note the extra `totalSpend > 0` condition, copied from the original
 * ChampionsHero: classify() alone would include high-revenue products with no
 * ad spend at all (organic sellers), which cannot be "scaled" by raising a
 * budget. So this list can legitimately be shorter than the Champions count on
 * the quadrant card — that was true before and is preserved.
 */
export function selectScalableChampions(
  products: NormProduct[],
  spendThreshold: number,
  revenueThreshold: number,
  limit = 3,
): NormProduct[] {
  return products
    .filter(
      (p) =>
        p.revenue >= revenueThreshold &&
        p.totalSpend < spendThreshold &&
        p.totalSpend > 0, // exclude organic / zero-spend products
    )
    .sort((a, b) => b.roi - a.roi)
    .slice(0, limit);
}

export interface ScalePlanRow {
  product: string;
  currentSpend: number;
  /** +50% of current spend. */
  suggestedBudget: number;
  /** 15% conservative ROI decay at 1.5x spend. */
  roiAtScale: number;
  expectedRevenue: number;
}

export interface ScalePlan {
  champions: NormProduct[];
  rows: ScalePlanRow[];
  totalSpend: number;
  totalRevenue: number;
  roi: number;
  /** Estimated extra revenue from a +50% budget at the blended ROI. */
  estimatedAdditionalRevenue: number;
}

/** Budget recommendations. Every coefficient is unchanged from the original. */
export function buildScalePlan(champions: NormProduct[]): ScalePlan {
  const totalSpend = champions.reduce((s, p) => s + p.totalSpend, 0);
  const totalRevenue = champions.reduce((s, p) => s + p.revenue, 0);
  const roi = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  return {
    champions,
    totalSpend,
    totalRevenue,
    roi,
    estimatedAdditionalRevenue: totalSpend * 0.5 * roi,
    rows: champions.map((p) => ({
      product: p.title,
      currentSpend: p.totalSpend,
      suggestedBudget: Math.round(p.totalSpend * 1.5),
      roiAtScale: p.roi * 0.85,
      expectedRevenue: Math.round(p.totalSpend * 1.5 * p.roi * 0.85),
    })),
  };
}

export function bucketByQuadrant(
  products: NormProduct[],
  spendThreshold: number,
  revenueThreshold: number,
): Record<QuadrantKey, QuadrantBucket> {
  const grouped: Record<QuadrantKey, NormProduct[]> = {
    champions: [], contenders: [], cruisers: [], casualties: [],
  };

  for (const product of products) {
    grouped[classify(product, spendThreshold, revenueThreshold)].push(product);
  }

  const out = {} as Record<QuadrantKey, QuadrantBucket>;
  for (const key of QUADRANT_ORDER) {
    const list = grouped[key];
    const spend = list.reduce((s, p) => s + p.totalSpend, 0);
    const revenue = list.reduce((s, p) => s + p.revenue, 0);
    out[key] = {
      key,
      meta: QUADRANTS[key],
      products: list,
      count: list.length,
      spend,
      revenue,
      roi: spend > 0 ? revenue / spend : 0,
      share: products.length > 0 ? (list.length / products.length) * 100 : 0,
    };
  }
  return out;
}
