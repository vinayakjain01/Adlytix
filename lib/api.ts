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
 * Asks the API to work through queued sync jobs now. A deployment without an
 * always-on worker (Vercel) relies on this; with a worker running it is
 * harmless, because jobs are claimed one at a time. Fire-and-forget: progress
 * is reported by polling the jobs, so a failure here is not surfaced twice.
 */
function kickSyncProcessing(): void {
  void apiFetch("/api/v1/sync/process", { method: "POST" }).catch(() => undefined);
}

/**
 * Queues products_sync + orders_sync for the caller's connected Shopify
 * store. Returns as soon as the jobs are queued; they are then processed by
 * the background worker (sync/worker.py) or by the kick below.
 */
export function triggerShopifySync() {
  return apiFetch("/api/v1/shopify/sync", { method: "POST" })
    .then((r) => r.json() as Promise<{ jobIds: string[] }>)
    .then((queued) => { kickSyncProcessing(); return queued; });
}

/** Queues campaigns_sync + insights_sync for the caller's connected Meta ad account. */
export function triggerMetaSync() {
  return apiFetch("/api/v1/meta/sync", { method: "POST" })
    .then((r) => r.json() as Promise<{ jobIds: string[] }>)
    .then((queued) => { kickSyncProcessing(); return queued; });
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

// ── Campaign / Ad Audit + Product × Ad Matrix ──────────────────────────
// Figures here are Meta's own native-currency numbers (like getUnifiedOverview)
// — not run through the CSV-merge currency system, and not converted.
export interface EntityMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  conversions: number;
  conversionValue: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  platformRoas: number | null;
}

export interface ProductMixEntry {
  productId: string | null;
  title: string;
  spend: number;
  conversionValue: number | null;
  platformRoas: number | null;
}

export interface CampaignAuditRow extends EntityMetrics {
  campaignId: string;
  name: string;
  productAttributedSpend: number;
  unattributedSpend: number;
  productMix: ProductMixEntry[];
  primaryDriver: string | null;
}

export interface AdTrend {
  platformRoas: number | null;
  cpm: number | null;
  ctr: number | null;
  frequency: number | null;
  spend: number | null;
}

export interface AdAuditRow extends EntityMetrics {
  adId: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  trend: AdTrend | null;
  productMix: ProductMixEntry[];
  score: number;
  scoreReasons: string[];
}

export interface ProductAdMatrixCell {
  productId: string;
  adId: string;
  spend: number;
  conversionValue: number | null;
  platformRoas: number | null;
}

export interface ProductAdMatrix {
  since: string;
  until: string;
  products: { id: string; title: string }[];
  ads: { id: string; name: string }[];
  cells: ProductAdMatrixCell[];
  productLevelConversionsAvailable: boolean;
}

function rangeQuery(range?: { since: string; until: string }): string {
  return range ? `?${new URLSearchParams(range).toString()}` : "";
}

export function getCampaignAudit(range?: { since: string; until: string }) {
  return apiJson<{ since: string; until: string; campaigns: CampaignAuditRow[]; productLevelConversionsAvailable: boolean }>(
    `/api/v1/analytics/campaigns${rangeQuery(range)}`,
  );
}

export function getAdAudit(range?: { since: string; until: string }) {
  return apiJson<{ since: string; until: string; ads: AdAuditRow[]; productLevelConversionsAvailable: boolean }>(
    `/api/v1/analytics/ads${rangeQuery(range)}`,
  );
}

export function getProductAdMatrix(range?: { since: string; until: string }) {
  return apiJson<ProductAdMatrix>(`/api/v1/analytics/product-ad-matrix${rangeQuery(range)}`);
}

export type OpportunityTag =
  | 'winner' | 'emerging' | 'declining' | 'inefficient'
  | 'high-revenue-low-efficiency' | 'low-spend-high-efficiency' | 'no-ad-spend' | 'steady';

export interface ProductIntelligenceRow {
  productId: string;
  title: string;
  revenue: number;
  units: number;
  orders: number;
  metaSpend: number;
  roi: number | null;
  revenueTrendPct: number | null;
  spendTrendPct: number | null;
  campaignCount: number;
  adCount: number;
  bestCampaignId: string | null;
  bestCampaignRoas: number | null;
  bestAdId: string | null;
  bestAdRoas: number | null;
  opportunityScore: number;
  opportunityTag: OpportunityTag;
  opportunityReasons: string[];
}

export interface ProductIntelligenceResult {
  since: string;
  until: string;
  products: ProductIntelligenceRow[];
  accountAverages: { roi: number; spend: number; revenue: number };
  productLevelConversionsAvailable: boolean;
  bestEntityRankedBy: 'platformRoas' | 'spend';
}

/** Integration-mode-only — see backend/reporting/product_intelligence.py. */
export function getProductIntelligence(range?: { since: string; until: string }) {
  return apiJson<ProductIntelligenceResult>(`/api/v1/analytics/product-intelligence${rangeQuery(range)}`);
}

export type OpportunitySeverity = 'high' | 'medium' | 'low';
export type OpportunityEntityType = 'campaign' | 'ad' | 'product';

export type OpportunityCategory = 'scale' | 'product-opportunity' | 'performance-drop' | 'creative-fatigue';
export type OpportunityConfidence = 'high' | 'medium' | 'low';

export interface Opportunity {
  category: OpportunityCategory;
  severity: OpportunitySeverity;
  entityType: OpportunityEntityType;
  entityId: string;
  entityName: string;
  title: string;
  metric: string;
  metricValue: number | null;
  comparisonMetric: number | null;
  reason: string;
  recommendedAction: string;
  evidence: Record<string, number | string | null>;
  confidence: OpportunityConfidence;
}

export interface OpportunityCenterResult {
  since: string;
  until: string;
  opportunities: Opportunity[];
  counts: Partial<Record<OpportunityCategory, number>>;
}

/** Every item here is a real signal already computed by Product Intelligence / Campaign & Ad Audit — see backend/reporting/opportunity_center.py. */
export function getOpportunityCenter(range?: { since: string; until: string }) {
  return apiJson<OpportunityCenterResult>(`/api/v1/analytics/opportunity-center${rangeQuery(range)}`);
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
