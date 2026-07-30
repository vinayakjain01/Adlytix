import type { UserRole, UserStatus } from '@/lib/auth';
import type { CurrencyCode } from '@/lib/currency';

/**
 * The analytics event contract.
 *
 * ── What may leave the browser ───────────────────────────────────────────
 * Volume and shape only: counts, durations, buckets, enum-like choices, and
 * the signed-in operator's own identity.
 *
 * ── What may NEVER leave the browser ─────────────────────────────────────
 * Client business data. That means no money values (spend, revenue, ROI, CPM),
 * no product titles or product IDs, no search terms, no uploaded filenames,
 * and no cell contents of any kind. This app is multi-tenant: a client's
 * revenue figures reaching a third party is a data-governance incident, not a
 * cosmetic issue.
 *
 * Filenames are excluded specifically because they routinely carry the client
 * name ("AcmeCorp_meta_july.csv"), and search terms are excluded because an
 * operator searching a product is typing that product's name.
 *
 * This is enforced structurally rather than by convention: `track()` accepts
 * only the property shapes declared below, so adding a money field to an event
 * is a compile error rather than a silent leak. Keep it that way.
 */

/** Coarse size buckets — the exact byte count of an upload is a fingerprint. */
export type SizeBucket = '<100KB' | '100KB-1MB' | '1-5MB' | '5-20MB' | '>20MB';

export function sizeBucket(bytes: number): SizeBucket {
  const kb = bytes / 1024;
  if (kb < 100) return '<100KB';
  if (kb < 1024) return '100KB-1MB';
  if (kb < 5 * 1024) return '1-5MB';
  if (kb < 20 * 1024) return '5-20MB';
  return '>20MB';
}

export type SourceId = 'meta' | 'shopify' | 'google' | 'discount';
export type ExportKind = 'products' | 'quadrant' | 'all-quadrants' | 'scale-plan';

/** Properties attached to every event by `client.ts`. */
export interface BaseProperties {
  screen: string;
  app_version: string;
}

export interface EventMap {
  // ── Authentication ──────────────────────────────────────────────────────
  login_submitted: { remember: boolean };
  login_succeeded: {
    remember: boolean;
    role: UserRole;
    status: UserStatus;
    is_platform_admin: boolean;
    /** Null on a first-ever login, which is itself worth being able to see. */
    had_previous_login: boolean;
    duration_ms: number;
  };
  /** No email, and no password length — a failure reason is enough to debug. */
  login_failed: { reason: string; status_code: number | null; duration_ms: number };
  logout: { scope: 'this_device' | 'all_devices' };
  /** Fired when the API rejects a live session, i.e. expiry or revocation. */
  session_invalidated: { reason: string };

  // ── Uploads ─────────────────────────────────────────────────────────────
  upload_started: { source: SourceId; extension: string; size_bucket: SizeBucket };
  upload_completed: {
    source: SourceId;
    extension: string;
    size_bucket: SizeBucket;
    /** How many source slots are filled once this one lands. */
    sources_ready: number;
  };
  upload_rejected: { source: SourceId; extension: string; reason: string };
  upload_cleared: { source: SourceId };

  // ── Merge ───────────────────────────────────────────────────────────────
  merge_started: {
    source_count: number;
    has_google: boolean;
    has_discount: boolean;
    base_currency: CurrencyCode;
    /** True when any source is declared in a currency other than the base. */
    needs_conversion: boolean;
  };
  merge_completed: {
    source_count: number;
    has_google: boolean;
    has_discount: boolean;
    /** Row counts are volume, not business value. */
    product_rows: number;
    months_detected: number;
    warning_count: number;
    base_currency: CurrencyCode;
    converted_sources: number;
    duration_ms: number;
  };
  merge_failed: { source_count: number; reason: string; status_code: number | null; duration_ms: number };

  // ── Analysis surfaces ───────────────────────────────────────────────────
  /** Satisfies "Dashboard Visits" with the screen label, not just a URL. */
  page_viewed: { path: string; is_first_view: boolean };
  /** Satisfies "Time on page" — emitted on route change and on tab close. */
  page_time_spent: { path: string; seconds: number; exited_app: boolean };

  filters_applied: {
    /** Which metrics are filtered — a column name, never a threshold value. */
    metrics: string[];
    filter_count: number;
    /** Result size after filtering, so we can see filters that match nothing. */
    rows_matched: number;
    rows_total: number;
  };
  filters_cleared: { filter_count: number; had_search: boolean };
  /** Term length only — the term itself is a product name. */
  product_searched: { term_length: number; rows_matched: number; rows_total: number };
  columns_changed: { visible_count: number; added: string | null; removed: string | null };
  /** Reports the resulting selection — how much of the range operators view. */
  months_changed: { selected_count: number; total_count: number; is_all: boolean };

  // ── Quadrant ────────────────────────────────────────────────────────────
  quadrant_thresholds_changed: { spend_pct: number; revenue_pct: number };
  /**
   * Carries how many of the four quadrants are populated: asking for the
   * explainer with an empty Champions bucket is a different situation from
   * asking with a full one, and only one of those is a product problem.
   */
  quadrant_explainer_opened: { populated_quadrants: number };

  // ── AI insights ─────────────────────────────────────────────────────────
  /** Scale of the request, never the products or figures in it. */
  ai_analysis_requested: {
    product_count: number;
    populated_quadrants: number;
    currency: CurrencyCode;
  };
  ai_analysis_completed: {
    model: string;
    cached: boolean;
    quadrants_returned: number;
    /**
     * Invented product IDs the API rejected. Worth watching: a rise here means
     * the model is drifting off the data it was given.
     */
    dropped_product_ids: number;
    duration_ms: number;
  };
  ai_analysis_failed: { reason: string; duration_ms: number };

  // ── Currency ────────────────────────────────────────────────────────────
  display_currency_changed: {
    from: CurrencyCode;
    to: CurrencyCode;
    base_currency: CurrencyCode;
    /** False when no live rate existed, i.e. amounts stayed in the base. */
    rate_available: boolean;
  };
  source_currency_declared: { source: SourceId; currency: CurrencyCode };

  // ── Exports ─────────────────────────────────────────────────────────────
  csv_downloaded: {
    kind: ExportKind;
    row_count: number;
    /** Whether the export was filtered, not what the filters were. */
    was_filtered: boolean;
    filter_count: number;
    /**
     * Length only — an operator-set filename routinely carries the client name.
     * Null when the app generates the name, which is most exports.
     */
    filename_length: number | null;
  };

  // ── Administration ──────────────────────────────────────────────────────
  /** Role and status are configuration, not client data. No email is sent. */
  admin_user_created: { role: UserRole; status: string; has_client: boolean };
  admin_user_updated: {
    /** Which fields the administrator actually changed. */
    changed: string[];
    role: UserRole;
    status: string;
  };
  admin_user_password_set: { revoked_sessions: true };
  admin_user_sessions_revoked: Record<string, never>;
  admin_client_created: { has_expiry: boolean };
  admin_client_updated: { changed: string[]; has_expiry: boolean };

  // ── Errors ──────────────────────────────────────────────────────────────
  /**
   * `message` is the API's or the runtime's own message. Backend messages are
   * operator-facing strings ("Session expired"), not row data.
   */
  app_error: {
    source: 'api' | 'render' | 'window' | 'promise';
    message: string;
    endpoint: string | null;
    status_code: number | null;
    /** Present for render errors only. */
    component: string | null;
  };
}

export type EventName = keyof EventMap;

/**
 * Screen labels are derived from the nav so a route rename cannot leave the
 * analytics reading a stale name. Routes with no nav entry fall back to their
 * path, which is how /login and /404 report.
 */
export const SCREEN_FALLBACK = 'unknown';
