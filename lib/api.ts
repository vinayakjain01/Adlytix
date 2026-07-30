import { apiJson } from "./http";
import type { MergeCurrency, Product } from "./context";

/**
 * What POST /api/analyse actually returns.
 *
 * This previously declared only `products` and `summary`, while the merge hook
 * read seven more fields off it — the extra keys only type-checked because the
 * response was cast to `any` on the way out. Typing the call properly surfaced
 * every one of them, so the shape below is the endpoint's real contract, read
 * off the return statement in backend/main.py.
 *
 * `hasMonth`/`has_month` and `hasGoogle`/`has_google` both appear because the
 * original client read the snake_case spellings the API never sent; both are
 * accepted so the previous fallback behaviour is preserved exactly.
 */
export interface AnalyseResponse {
  ok?: boolean;
  products?: Product[];
  /** Older alias for `products`, still tolerated by the merge hook. */
  data?: Product[];
  summary?: {
    products?: number;
    total_spend?: number;
    total_rev?: number;
    roi?: number;
    meta_spend?: number;
    google_cost?: number;
    lpv?: number;
  };
  kpis?: Record<string, number>;
  quadrants?: {
    q1: Product[]; q2: Product[]; q3: Product[]; q4: Product[];
    spCut: number; rvCut: number;
  };
  discountData?: unknown;
  hasDiscount?: boolean;
  discountedProducts?: number;
  /** Which rate was applied to each source, so a run can be audited. */
  currency?: MergeCurrency | null;
  hasMonth?: boolean;
  has_month?: boolean;
  hasGoogle?: boolean;
  has_google?: boolean;
  warnings?: string[];
}

// Routed through lib/http so the session cookie is attached and FastAPI's
// {"detail": ...} bodies surface as readable messages rather than raw JSON.
// No Content-Type is set: the browser must add the multipart boundary itself.
function postForm(path: string, body: FormData) {
  return apiJson<AnalyseResponse>(path, { method: "POST", body });
}

// ── Product Analysis ──────────────────────────────────────────────────
export interface MergeCurrencyOptions {
  /** Currency every figure is normalised into before aggregation. */
  base: string;
  meta: string;
  shopify: string;
  google: string;
}

export async function mergeFiles(
  meta: File,
  shopify: File,
  google?: File | null,
  discount?: File | null,
  currency?: MergeCurrencyOptions
) {
  const fd = new FormData();

  fd.append("meta_file", meta);
  fd.append("shopify_file", shopify);

  if (google) {
    fd.append("google_file", google);
  }

  // /api/analyse has always accepted this field and used it to run the
  // discount engine — the client simply never sent it.
  if (discount) {
    fd.append("discount_file", discount);
  }

  // Declared as query parameters, matching the endpoint's signature. Omitted
  // entirely when not supplied, which leaves the server on its defaults.
  const query = currency
    ? "?" + new URLSearchParams({
        base_currency: currency.base,
        meta_currency: currency.meta,
        shopify_currency: currency.shopify,
        google_currency: currency.google,
      }).toString()
    : "";

  return postForm(`/api/analyse${query}`, fd);
}
