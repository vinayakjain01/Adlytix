import { apiFetch, apiJson, API_BASE, postJson } from "./http";
import type { MergeCurrency, Product } from "./context";

// ── Integrations ─────────────────────────────────────────────────────
// Connect/OAuth-start is a plain browser navigation (the provider redirects
// the whole page, then redirects back), never a fetch — these return the URL
// to navigate to, not a promise of one.

export type IntegrationProvider = "shopify" | "meta" | "google" | "tiktok";
export type IntegrationState = "available" | "pending" | "connected" | "error" | "disconnected";

export interface IntegrationStatusInfo {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationState;
  displayName: string | null;
  externalAccountId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export function listIntegrations() {
  return apiJson<IntegrationStatusInfo[]>("/api/v1/integrations");
}

export function disconnectIntegration(id: string) {
  return apiFetch(`/api/v1/integrations/${id}/disconnect`, { method: "POST" })
    .then((r) => r.json() as Promise<IntegrationStatusInfo>);
}

export function shopifyConnectHref(shop: string): string {
  return `${API_BASE}/api/v1/shopify/connect?shop=${encodeURIComponent(shop)}`;
}

/**
 * Queues products_sync + orders_sync for the caller's connected Shopify
 * store. Returns immediately — the sync itself runs in the background
 * worker (sync/worker.py), not this request.
 */
export function triggerShopifySync() {
  return apiFetch("/api/v1/shopify/sync", { method: "POST" })
    .then((r) => r.json() as Promise<{ jobIds: string[] }>);
}

/** Queues campaigns_sync + insights_sync for the caller's connected Meta ad account. */
export function triggerMetaSync() {
  return apiFetch("/api/v1/meta/sync", { method: "POST" })
    .then((r) => r.json() as Promise<{ jobIds: string[] }>);
}

// ── Unified analytics (synced data only — see reporting/service.py for why
// this is date-level, not product-level like the CSV-upload analysis) ──
export interface UnifiedDailyRow {
  date: string;
  revenue: number;
  spend: number;
  roas: number | null;
  orders: number;
  impressions: number;
  clicks: number;
}

export interface UnifiedOverview {
  since: string;
  until: string;
  daily: UnifiedDailyRow[];
  totals: Omit<UnifiedDailyRow, "date">;
  hasShopifyData: boolean;
  hasMetaData: boolean;
}

export function getUnifiedOverview(range?: { since: string; until: string }) {
  const query = range ? `?${new URLSearchParams(range).toString()}` : "";
  return apiJson<UnifiedOverview>(`/api/v1/analytics/overview${query}`);
}

/** The actual currency each connected source's synced data is in — pre-fills the Integration currency step. */
export function getAnalyticsSources() {
  return apiJson<{ shopify: string | null; meta: string | null }>("/api/v1/analytics/sources");
}

export interface IntegrationAnalysisOptions {
  since?: string;
  until?: string;
  base: string;
  meta: string;
  shopify: string;
}

/**
 * Integration-mode equivalent of mergeFiles(): same response shape
 * (AnalyseResponse), same merge/quadrant engine, built from synced Shopify +
 * Meta data instead of an upload. Never triggers a re-fetch from Shopify/Meta
 * — always reads what's already stored for the given range.
 */
export function getIntegrationAnalysis(opts: IntegrationAnalysisOptions) {
  const params = new URLSearchParams({
    base_currency: opts.base, meta_currency: opts.meta, shopify_currency: opts.shopify,
  });
  if (opts.since) params.set("since", opts.since);
  if (opts.until) params.set("until", opts.until);
  return apiJson<AnalyseResponse>(`/api/v1/analytics/products?${params.toString()}`);
}

export type SyncJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface SyncJobInfo {
  id: string;
  provider: string;
  syncType: string;
  status: SyncJobStatus;
  recordsFetched: number;
  attempt: number;
  maxAttempts: number;
  error: string | null;
}

/** Status for a set of job ids returned by triggerShopifySync()/triggerMetaSync() — for polling sync progress. */
export function getSyncJobs(ids: string[]) {
  if (ids.length === 0) return Promise.resolve<SyncJobInfo[]>([]);
  return apiJson<SyncJobInfo[]>(`/api/v1/sync/jobs?ids=${ids.map(encodeURIComponent).join(",")}`);
}

export function metaConnectHref(): string {
  return `${API_BASE}/api/v1/meta/connect`;
}

export interface MetaAdAccount {
  id: string;
  name: string | null;
  accountStatus: number | null;
  currency: string | null;
  businessName: string | null;
}

export function listMetaAccounts() {
  return apiJson<MetaAdAccount[]>("/api/v1/meta/accounts");
}

export function selectMetaAccount(accountId: string, accountName?: string | null) {
  return postJson<{ ok: boolean }>("/api/v1/meta/accounts/select", { accountId, accountName });
}

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
  /** Real Meta spend in-range that isn't attributable to a specific product — see reporting/merge_adapter.py. */
  unattributedMetaSpend?: number;
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
