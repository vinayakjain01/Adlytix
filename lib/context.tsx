"use client";
import {
  createContext, useContext, useState, useCallback,
  useMemo, useEffect, useRef, ReactNode,
} from "react";
import { setActiveCurrency } from "./formatters";
import {
  displayFactor, fetchRates, isCurrencyCode,
  type CurrencyCode, type RateTable,
} from "./currency";
import { track } from "./analytics/client";
import { errorMessage } from "./errors";
import { useSettledValue } from "@/hooks/use-settled-value";
import { useAuth } from "./auth-context";

/** What /api/analyse reports about the currency of the run it just produced. */
export interface MergeCurrency {
  base: CurrencyCode;
  converted: boolean;
  rateProvider: string;
  ratesFetchedAt: number | null;
  rates: Record<string, number> | null;
  stale: boolean;
  sources: Record<string, { currency: string; factor: number | null; converted: boolean }>;
}

// ── Raw Product shape from API ─────────────────────────────────────────────
export interface Product {
  "Product ID": string;
  "Product Title": string;
  "Variant Title"?: string;
  "Google Item ID"?: string;
  "Month"?: string;
  /** Set by /api/analyse when a discount list was uploaded. */
  "Discounted"?: boolean;
  "Meta Spend": number;
  "Google Cost": number;
  "Total Spend": number;
  "Shopify Revenue": number;
  "Net Items Sold": number;
  "Landing Page Views": number;
  "Conversions": number;
  "CTR": number;
  "CPM": number;
  "ROI": number;
}

// ── Normalised, aggregated product shape ───────────────────────────────────
export interface NormProduct {
  id: string;
  title: string;
  variant: string;
  month?: string;       // undefined after aggregation
  metaSpend: number;
  googleCost: number;
  totalSpend: number;
  revenue: number;
  roi: number;
  itemsSold: number;
  lpv: number;
  conversions: number;
  ctr: number;
  cpm: number;
  /** True when the product ID appears in the uploaded discount list. */
  discounted: boolean;
}

export interface MergedSummary {
  products: number;
  total_spend: number;
  total_rev: number;
  roi: number;
  meta_spend?: number;
  google_cost?: number;
  lpv?: number;
}

export interface QuadrantData {
  q1: Product[]; q2: Product[]; q3: Product[]; q4: Product[];
  all: Product[]; monthly: Product[];
  sp_cut: number; rv_cut: number; avg_sp: number; avg_rv: number;
  total_months: number;
}

interface StoredFile { file: File; name: string; size: number; }

/**
 * A row as it arrives from /api/analyse.
 *
 * The API sends PascalCase keys. The original client also read camelCase
 * fallbacks, and every one of those fallbacks is preserved below exactly as it
 * was — the intersection simply describes both spellings so this boundary does
 * not need `any`.
 */
export type IncomingRow = Product & Partial<NormProduct>;

// ── Pure helpers ───────────────────────────────────────────────────────────
function n(v: unknown): number { return Number(v ?? 0); }

export function normalizeOne(p: IncomingRow): NormProduct {
  const metaSpend  = n(p["Meta Spend"]      ?? p.metaSpend);
  const googleCost = n(p["Google Cost"]     ?? p.googleCost);
  const totalSpend = n(p["Total Spend"]     ?? p.totalSpend ?? metaSpend + googleCost);
  const revenue    = n(p["Shopify Revenue"] ?? p.revenue);
  return {
    id:          String(p["Product ID"]        ?? p.id        ?? ""),
    title:       String(p["Product Title"]     ?? p.title     ?? ""),
    variant:     String(p["Variant Title"]     ?? p.variant   ?? ""),
    month:       p["Month"]                    ?? p.month     ?? undefined,
    metaSpend,  googleCost, totalSpend, revenue,
    roi:         totalSpend > 0 ? revenue / totalSpend : 0,
    itemsSold:   n(p["Net Items Sold"]         ?? p.itemsSold),
    lpv:         n(p["Landing Page Views"]     ?? p.lpv),
    conversions: n(p["Conversions"]            ?? p.conversions),
    ctr:         n(p["CTR"]                    ?? p.ctr),
    cpm:         n(p["CPM"]                    ?? p.cpm),
    discounted:  Boolean(p["Discounted"]       ?? p.discounted ?? false),
  };
}

// FIX 2: single-pass loop instead of 8 separate .reduce() calls
function aggregateGroup(rows: NormProduct[]): NormProduct {
  const first = rows[0];
  let totMeta = 0, totGoog = 0, totSpend = 0, totRev = 0;
  let totItems = 0, totLpv = 0, totConv = 0;
  let ctrAcc = 0, cpmAcc = 0;

  for (const r of rows) {
    totMeta  += r.metaSpend;
    totGoog  += r.googleCost;
    totSpend += r.totalSpend;
    totRev   += r.revenue;
    totItems += r.itemsSold;
    totLpv   += r.lpv;
    totConv  += r.conversions;
    ctrAcc   += r.ctr * r.lpv;
    cpmAcc   += r.cpm * r.metaSpend;
  }

  const lpvW  = totLpv  > 0 ? totLpv  : rows.length;
  const metaW = totMeta > 0 ? totMeta : rows.length;

  return {
    id: first.id, title: first.title, variant: first.variant,
    month: undefined,
    metaSpend: totMeta, googleCost: totGoog, totalSpend: totSpend,
    revenue: totRev,
    roi: totSpend > 0 ? totRev / totSpend : 0,
    itemsSold: totItems, lpv: totLpv, conversions: totConv,
    ctr: ctrAcc / lpvW,
    cpm: cpmAcc / metaW,
    // Discount membership is a property of the product ID, so it is identical
    // across that product's monthly rows — taken from the first, like title.
    discounted: first.discounted,
  };
}

function groupById(rows: NormProduct[]): NormProduct[] {
  const map = new Map<string, NormProduct[]>();
  for (const r of rows) {
    if (!map.has(r.id)) map.set(r.id, []);
    map.get(r.id)!.push(r);
  }
  return Array.from(map.values()).map(aggregateGroup);
}

/** An explicit month selection, tagged with the data set it was made against. */
export interface MonthChoice {
  forData: NormProduct[];
  months: Set<string>;
}

/**
 * The months currently in view.
 *
 * Every month is selected unless the operator narrowed it for exactly this data
 * set — identity of `rows` is the test, so a new merge invalidates a stale
 * choice during render instead of needing an effect to reset it.
 *
 * Exported so the rule is unit-testable: every figure on every screen follows
 * this selection, which makes it the highest-consequence logic in this file.
 */
export function resolveSelectedMonths(
  choice: MonthChoice | null,
  rows: NormProduct[],
  allMonths: string[],
): Set<string> {
  if (choice && choice.forData === rows) return choice.months;
  return new Set(allMonths);
}

function detectMonths(rows: NormProduct[]): string[] {
  const set = new Set<string>();
  for (const r of rows) { if (r.month) set.add(r.month); }
  return Array.from(set).sort((a, b) => {
    const da = new Date(a + " 1"), db = new Date(b + " 1");
    if (!isNaN(da.getTime()) && !isNaN(db.getTime())) return da.getTime() - db.getTime();
    return a.localeCompare(b);
  });
}

// ── Context shape ──────────────────────────────────────────────────────────
interface AppState {
  metaFile: StoredFile | null; shopifyFile: StoredFile | null;
  googleFile: StoredFile | null; discountFile: StoredFile | null;
  setMetaFile: (f: File | null) => void;
  setShopifyFile: (f: File | null) => void;
  setGoogleFile: (f: File | null) => void;
  setDiscountFile: (f: File | null) => void;

  mergedData: Product[] | null;
  mergedSummary: MergedSummary | null;
  hasMonth: boolean; hasGoogle: boolean; warnings: string[];
  setMergedResult: (data: Product[], summary: MergedSummary, hm: boolean, hg: boolean, warns: string[]) => void;
  clearMergedData: () => void;

  // ── Global month selection ───────────────────────────────────────────
  allMonths: string[];
  selectedMonths: Set<string>;
  toggleMonth: (m: string) => void;
  selectAllMonths: () => void;

  // ── Computed: month-filtered + aggregated by product ID ─────────────
  // This is the SINGLE source of truth for all display components.
  aggregatedProducts: NormProduct[];

  // ── One normalised row per product PER MONTH (not month-filtered) ────
  // Exposed so month-series consumers (the Overview chart and the KPI
  // sparklines) can bucket by month without running normalizeOne a second
  // time. Screens that want the month-filtered, per-product view should use
  // aggregatedProducts above.
  normalizedProducts: NormProduct[];

  quadrantData: QuadrantData | null;
  setQuadrantData: (d: QuadrantData) => void;
  clearQuadrantData: () => void;

  // ── Currency ─────────────────────────────────────────────────────────
  /** What the viewer wants to see amounts in. */
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;

  /** What the uploads should be normalised into at merge time. */
  baseCurrency: CurrencyCode;
  setBaseCurrency: (c: CurrencyCode) => void;

  /** Declared currency of each upload, sent with the merge. */
  sourceCurrencies: Record<'meta' | 'shopify' | 'google', CurrencyCode>;
  setSourceCurrency: (source: 'meta' | 'shopify' | 'google', c: CurrencyCode) => void;

  /** Live rates, and what the last merge actually applied. */
  rates: RateTable | null;
  ratesError: string | null;
  refreshRates: (force?: boolean) => Promise<void>;
  mergeCurrency: MergeCurrency | null;
  setMergeCurrency: (c: MergeCurrency | null) => void;

  /**
   * base → display multiplier, or null when the rate is unknown. Screens use
   * the null to say "showing base currency" rather than implying a conversion
   * that did not happen.
   */
  displayRate: number | null;
}

// Deliberately still the original key: renaming it would silently discard the
// display currency every existing user has already chosen. The name is never
// shown anywhere, so the inconsistency with the key below costs nothing.
const CURRENCY_STORAGE_KEY = "roasify_currency";
const BASE_CURRENCY_STORAGE_KEY = "adlytix_base_currency";

function loadStored(key: string): CurrencyCode | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(key);
  // A previously stored code that is no longer offered (AUD) falls back.
  return isCurrencyCode(saved) ? saved : null;
}

const AppContext = createContext<AppState | null>(null);
const toStored = (f: File | null): StoredFile | null =>
  f ? { file: f, name: f.name, size: f.size } : null;

// ── Provider ───────────────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  // Rates come from an authenticated endpoint; see the fetch effect below.
  const { status: authStatus } = useAuth();
  const [metaFile,     setMetaRaw]     = useState<StoredFile | null>(null);
  const [shopifyFile,  setShopifyRaw]  = useState<StoredFile | null>(null);
  const [googleFile,   setGoogleRaw]   = useState<StoredFile | null>(null);
  const [discountFile, setDiscountRaw] = useState<StoredFile | null>(null);

  const [mergedData,    setMergedDataRaw]    = useState<Product[] | null>(null);
  const [mergedSummary, setMergedSummaryRaw] = useState<MergedSummary | null>(null);
  const [hasMonth,   setHasMonth]   = useState(false);
  const [hasGoogle,  setHasGoogle]  = useState(false);
  const [warnings,   setWarnings]   = useState<string[]>([]);
  const [quadrantData, setQRaw]     = useState<QuadrantData | null>(null);

  // ── Month selection — lives here so TopBar and pages share the same state
  /**
   * An explicit month selection, tagged with the data set it was made against.
   *
   * Tagging is what removes the need for a reset effect: a new merge produces a
   * new normalizedProducts array, so the tag no longer matches and the derived
   * selection below falls back to "all months" during render.
   */
  const [monthChoice, setMonthChoice] = useState<MonthChoice | null>(null);

  // ── Currency ─────────────────────────────────────────────────────────
  // Both selections start at "INR" so the first client render matches the
  // server-rendered HTML; the persisted values are applied post-hydration in
  // the effect below. Reading localStorage in a useState initialiser would
  // cause a hydration mismatch.
  const [currency, setCurrencyRaw] = useState<CurrencyCode>("INR");
  const [baseCurrencyRaw, setBaseCurrencyRaw] = useState<CurrencyCode>("INR");
  const [sourceCurrencies, setSourceCurrenciesRaw] = useState<
    Record<'meta' | 'shopify' | 'google', CurrencyCode>
  >({ meta: "INR", shopify: "INR", google: "INR" });

  const [rates, setRates] = useState<RateTable | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [mergeCurrency, setMergeCurrency] = useState<MergeCurrency | null>(null);

  // Amounts are stored in whatever the completed merge normalised them to; only
  // fall back to the picker's base before a merge has run.
  const effectiveBase = mergeCurrency?.base ?? baseCurrencyRaw;

  const displayRate = useMemo(
    () => displayFactor(effectiveBase, currency, rates),
    [effectiveBase, currency, rates],
  );

  // Keep the formatters module in step on every render, so every inr() call
  // below this provider uses the right symbol AND the right factor. A null rate
  // means "unknown", and formatting must not invent one — so it renders the
  // base amount unscaled and the UI says which currency that is.
  setActiveCurrency(currency, displayRate ?? 1);

  const setCurrency = useCallback((c: CurrencyCode) => {
    // Rate availability is recorded for the currency being switched TO, so a
    // switch that silently left amounts in the base is distinguishable.
    track('display_currency_changed', {
      from: currency,
      to: c,
      base_currency: effectiveBase,
      rate_available: displayFactor(effectiveBase, c, rates) !== null,
    });
    setCurrencyRaw(c);
    if (typeof window !== "undefined") window.localStorage.setItem(CURRENCY_STORAGE_KEY, c);
  }, [currency, effectiveBase, rates]);

  const setBaseCurrency = useCallback((c: CurrencyCode) => {
    setBaseCurrencyRaw(c);
    if (typeof window !== "undefined") window.localStorage.setItem(BASE_CURRENCY_STORAGE_KEY, c);
  }, []);

  const setSourceCurrency = useCallback(
    (source: 'meta' | 'shopify' | 'google', c: CurrencyCode) => {
      track('source_currency_declared', { source, currency: c });
      setSourceCurrenciesRaw(prev => ({ ...prev, [source]: c }));
    },
    [],
  );

  const refreshRates = useCallback(async (force = false) => {
    try {
      setRates(await fetchRates(effectiveBase, force));
      setRatesError(null);
    } catch (err: unknown) {
      // Signed-out or offline: keep whatever table we already have rather than
      // dropping to an implied parity rate.
      setRatesError(errorMessage(err, "Could not load exchange rates."));
    }
  }, [effectiveBase]);

  // Apply persisted selections once mounted on the client (post-hydration).
  // Same reason as the sidebar's collapse state: localStorage is not available
  // to the server render, so a stored currency can only be applied after mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const savedDisplay = loadStored(CURRENCY_STORAGE_KEY);
    if (savedDisplay) setCurrencyRaw(savedDisplay);
    const savedBase = loadStored(BASE_CURRENCY_STORAGE_KEY);
    if (savedBase) {
      setBaseCurrencyRaw(savedBase);
      setSourceCurrenciesRaw({ meta: savedBase, shopify: savedBase, google: savedBase });
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Fetches the rate table whenever it is missing or belongs to a different
   * base — NOT only once the display currency already differs from the base.
   *
   * The earlier condition deadlocked: the currency picker disables any option it
   * has no rate for, so `currency` could never move away from the base, so the
   * fetch never ran, so no rates ever arrived. Every currency stayed greyed out
   * permanently. Declaring a *source* file's currency needs no rate, which is
   * why the upload screen looked fine while the header picker was stuck.
   *
   * Gated on a session because /api/rates requires one; without this the sign-in
   * screen would fire a request that can only 401.
   */
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    if (rates && rates.base === effectiveBase) return;
    // refreshRates is async: its setState runs in the fetch callback, not
    // synchronously here. Fetching in response to a dependency change is the
    // external-system synchronisation the rule exists to permit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRates();
  }, [authStatus, effectiveBase, rates, refreshRates]);

  const setMetaFile     = useCallback((f: File | null) => setMetaRaw(toStored(f)),    []);
  const setShopifyFile  = useCallback((f: File | null) => setShopifyRaw(toStored(f)), []);
  const setGoogleFile   = useCallback((f: File | null) => setGoogleRaw(toStored(f)),  []);
  const setDiscountFile = useCallback((f: File | null) => setDiscountRaw(toStored(f)),[]);

  // FIX 1: setMergedResult no longer calls normalizeOne itself.
  // Month auto-selection is handled by the useEffect below that watches
  // normalizedProducts, so we avoid a redundant map(normalizeOne) here.
  const setMergedResult = useCallback((
    data: Product[], summary: MergedSummary,
    hm: boolean, hg: boolean, warns: string[]
  ) => {
    setMergedDataRaw(data);
    setMergedSummaryRaw(summary);
    setHasMonth(hm); setHasGoogle(hg); setWarnings(warns);
    // Month selection derives from the new rows — nothing to set here.
  }, []);

  const clearMergedData = useCallback(() => {
    // Month selection is derived from the data, so dropping the data empties it
    // without a separate reset here.
    setMergedDataRaw(null); setMergedSummaryRaw(null);
    setMonthChoice(null);
  }, []);

  const setQuadrantData   = useCallback((d: QuadrantData) => setQRaw(d), []);
  const clearQuadrantData = useCallback(() => setQRaw(null), []);

  // ── FIX 1: Normalize ONCE, only when raw data changes ─────────────────
  // Previously, normalizeOne ran 3 separate times:
  //   1. inside setMergedResult (detectMonths call)
  //   2. inside allMonths useMemo
  //   3. inside aggregatedProducts useMemo
  // Now it runs exactly once and both allMonths and aggregatedProducts
  // derive from this single normalized array.
  const normalizedProducts = useMemo((): NormProduct[] => {
    if (!mergedData || mergedData.length === 0) return [];
    return mergedData.map(normalizeOne);
  }, [mergedData]);

  // ── Derived: sorted month list — reads from normalizedProducts ─────────
  const allMonths = useMemo(() => {
    if (!normalizedProducts.length) return [];
    return detectMonths(normalizedProducts);
  }, [normalizedProducts]);

  // ── Derived: the months currently in view ──────────────────────────────
  // Every month is selected unless the operator has narrowed it for exactly
  // this data set. Previously an effect wrote this on every new merge; deriving
  // it gives the same values with no state update during mount, and clearing
  // the merge empties it just as clearMergedData used to do explicitly.
  const selectedMonths = useMemo(
    () => resolveSelectedMonths(monthChoice, normalizedProducts, allMonths),
    [monthChoice, normalizedProducts, allMonths],
  );

  // ── Month actions ──────────────────────────────────────────────────────
  const toggleMonth = useCallback((m: string) => {
    const next = new Set(selectedMonths);
    if (next.has(m)) {
      if (next.size === 1) return; // always keep at least one
      next.delete(m);
    } else {
      next.add(m);
    }
    setMonthChoice({ forData: normalizedProducts, months: next });
  }, [selectedMonths, normalizedProducts]);

  const selectAllMonths = useCallback(() => {
    setMonthChoice({ forData: normalizedProducts, months: new Set(allMonths) });
  }, [normalizedProducts, allMonths]);

  // Tracked from a settled effect rather than inside toggleMonth: the toggle
  // runs in a state updater (which React may invoke twice in development) and
  // can legitimately be a no-op, since the last remaining month cannot be
  // deselected. Watching the result avoids both problems, and the debounce
  // groups a burst of toggles into the one selection the operator settled on.
  const monthKey = useMemo(() => [...selectedMonths].sort().join("|"), [selectedMonths]);
  const trackedMonthCount = useRef(0);

  useSettledValue(monthKey, () => {
    const count = selectedMonths.size;
    // The first population after a merge is programmatic, and clearing the
    // merge empties the set — neither is a choice the operator made.
    if (trackedMonthCount.current === 0 || count === 0) {
      trackedMonthCount.current = count;
      return;
    }
    trackedMonthCount.current = count;
    track("months_changed", {
      selected_count: count,
      total_count: allMonths.length,
      is_all: count === allMonths.length,
    });
  }, 400);

  // ── Derived: aggregatedProducts ────────────────────────────────────────
  // Reads from normalizedProducts (already computed above) — no second
  // map(normalizeOne) call here.
  //   1. Keep only rows whose month is in selectedMonths
  //      (if no month column exists, keep all rows)
  //   2. Group by product ID and SUM numeric fields via aggregateGroup
  //      (FIX 2: aggregateGroup now uses a single-pass loop)
  // Result: one row per product with spend/revenue totalled across selected months.
  const aggregatedProducts = useMemo((): NormProduct[] => {
    if (!normalizedProducts.length) return [];
    const hasMonthCol = normalizedProducts.some(r => r.month);
    const filtered = hasMonthCol
      ? normalizedProducts.filter(r => !r.month || selectedMonths.has(r.month))
      : normalizedProducts;
    return groupById(filtered);
  }, [normalizedProducts, selectedMonths]);

  return (
    <AppContext.Provider value={{
      metaFile, shopifyFile, googleFile, discountFile,
      setMetaFile, setShopifyFile, setGoogleFile, setDiscountFile,
      mergedData, mergedSummary, hasMonth, hasGoogle, warnings,
      setMergedResult, clearMergedData,
      allMonths, selectedMonths, toggleMonth, selectAllMonths,
      aggregatedProducts, normalizedProducts,
      quadrantData, setQuadrantData, clearQuadrantData,
      currency, setCurrency,
      baseCurrency: effectiveBase, setBaseCurrency,
      sourceCurrencies, setSourceCurrency,
      rates, ratesError, refreshRates,
      mergeCurrency, setMergeCurrency,
      displayRate,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}