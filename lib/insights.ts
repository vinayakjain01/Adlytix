import { postJson } from './http';
import type { NormProduct } from './context';
import type { CurrencyCode } from './currency';
import { QUADRANT_ORDER, type QuadrantBucket, type QuadrantKey } from './quadrants';

/**
 * The AI insights client.
 *
 * The brief is assembled from the buckets the 4C screen is already displaying,
 * so the model comments on exactly the figures on screen. Nothing is
 * recomputed here — that is what would let the advice describe a different view
 * from the one the operator is reading.
 *
 * Note what is NOT in the response type: no amount, no ROI, no count. The model
 * returns words and product IDs only, and the UI renders the real figures from
 * local data. A fabricated number has nowhere to appear.
 */

/** Example products per quadrant. Must match the API's cap. */
export const EXAMPLES_PER_QUADRANT = 8;

export interface BriefProduct {
  id: string;
  title: string;
  spend: number;
  revenue: number;
  roi: number;
}

export interface InsightsBrief {
  currency: CurrencyCode;
  monthLabel: string | null;
  thresholds: { spend: number; revenue: number };
  totals: { products: number; spend: number; revenue: number; roi: number };
  quadrants: {
    key: QuadrantKey;
    productCount: number;
    spend: number;
    revenue: number;
    roi: number;
    topProducts: BriefProduct[];
  }[];
}

export interface QuadrantAdvice {
  quadrant: QuadrantKey;
  action: string;
  rationale: string;
  productIds: string[];
}

export interface Insights {
  headline: string;
  quadrants: QuadrantAdvice[];
  watchOuts: string[];
  model: string;
  generatedAt: string;
  cached: boolean;
  /** Invented IDs the API removed. Non-zero is worth showing the operator. */
  droppedProductIds: number;
}

/**
 * Builds the brief from the displayed buckets.
 *
 * Aggregates cover every product; only the per-product examples are capped, and
 * they are the biggest spenders because that is what a budget decision turns on.
 */
export function buildBrief(
  buckets: Record<QuadrantKey, QuadrantBucket>,
  thresholds: { spend: number; revenue: number },
  totals: { count: number; totalSpend: number; revenue: number; roi: number },
  currency: CurrencyCode,
  monthLabel: string | null,
): InsightsBrief {
  return {
    currency,
    monthLabel,
    thresholds: { spend: thresholds.spend, revenue: thresholds.revenue },
    totals: {
      products: totals.count,
      spend: totals.totalSpend,
      revenue: totals.revenue,
      roi: totals.roi,
    },
    // bucketByQuadrant already computed these totals for the cards on screen.
    // Reusing them is the point: recomputing here is how the advice would end
    // up describing figures that differ from the ones being displayed.
    quadrants: QUADRANT_ORDER.map((key) => {
      const bucket = buckets[key];
      return {
        key,
        productCount: bucket.count,
        spend: bucket.spend,
        revenue: bucket.revenue,
        roi: bucket.roi,
        topProducts: bucket.products
          .slice()
          .sort((a, b) => b.totalSpend - a.totalSpend)
          .slice(0, EXAMPLES_PER_QUADRANT)
          .map(toBriefProduct),
      };
    }),
  };
}

function toBriefProduct(product: NormProduct): BriefProduct {
  return {
    id: product.id,
    title: product.title,
    spend: product.totalSpend,
    revenue: product.revenue,
    roi: product.roi,
  };
}

export function requestInsights(brief: InsightsBrief) {
  return postJson<Insights>('/api/ai-insights', brief);
}
