// ── Display currency ────────────────────────────────────────────────────────
// Money values arriving from /api/analyse are already normalised into the
// merge's BASE currency (see backend/currency.py — that conversion happens
// before any summing, which is what makes Total Spend and ROI meaningful).
//
// What happens here is the second, cosmetic step: rendering those base-currency
// amounts in whichever currency the viewer picked. Only `inr()` scales.
// Ratios (ROI, CTR) and counts (units, views) are currency-free and must never
// be touched.
//
// The active factor is pushed in from lib/context.tsx. It is 1 whenever the
// display currency equals the base, or whenever no rate is available — and in
// that second case the UI says so rather than showing a converted-looking
// figure that isn't.
import { CURRENCIES, currencyOption, type CurrencyCode, type CurrencyOption } from "./currency";

export { CURRENCIES };
export type { CurrencyCode, CurrencyOption };

let activeCurrency: CurrencyOption = CURRENCIES[0];
let activeFactor = 1;

export function setActiveCurrency(code: CurrencyCode, factor = 1): void {
  activeCurrency = currencyOption(code);
  activeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function getActiveCurrency(): CurrencyOption {
  return activeCurrency;
}

export function getActiveFactor(): number {
  return activeFactor;
}

export function currencySymbol(): string {
  return activeCurrency.symbol;
}

/**
 * Formats a base-currency amount for display, with everything passed in.
 *
 * The pure core of `inr()`. It exists so a React memo can depend on the actual
 * currency and rate: `inr()` reads them from module state, which React cannot
 * observe, so a memoised figure would keep whatever currency it was first
 * formatted in. See hooks/use-money.ts.
 */
export function formatMoney(
  value: number | null | undefined,
  code: CurrencyCode,
  factor: number,
  compact = false,
): string {
  if (value == null || isNaN(value)) return "—";
  const { symbol, locale } = currencyOption(code);
  // The only place a display conversion is applied.
  const n = value * (Number.isFinite(factor) && factor > 0 ? factor : 1);

  // Rounding straight to whole units makes any genuine amount under ~0.5
  // display as a misleading "0" — this shows up constantly on per-product
  // averages/values once a catalog is large enough that spend or revenue
  // per item drops below one currency unit. Keep cents for small amounts;
  // large totals still render as clean whole units.
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 10 ? 2 : 0;
  const v = decimals ? n : Math.round(n);

  if (compact) {
    const absV = Math.abs(v);
    if (code === "INR") {
      if (absV >= 1_00_00_000) return `${symbol}${(v / 1_00_00_000).toFixed(1).replace(/\.0$/, "")}Cr`;
      if (absV >= 1_00_000)    return `${symbol}${(v / 1_00_000).toFixed(1).replace(/\.0$/, "")}L`;
      if (absV >= 1_000)       return `${symbol}${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      return `${symbol}${v.toFixed(decimals)}`;
    }
    if (absV >= 1_000_000_000) return `${symbol}${(v / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
    if (absV >= 1_000_000)     return `${symbol}${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (absV >= 1_000)         return `${symbol}${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    return `${symbol}${v.toFixed(decimals)}`;
  }

  return symbol + v.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Formats using the currently active display currency.
 *
 * Correct anywhere the call happens during render, which is the vast majority of
 * uses. Inside a `useMemo`, use `useMoney()` instead — this function's result
 * depends on module state that React cannot see, so a memo would go stale.
 */
export function inr(value: number | null | undefined, compact = false): string {
  return formatMoney(value, activeCurrency.code, activeFactor, compact);
}

export function roi(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(1) + "x";
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return (n * 100).toFixed(digits) + "%";
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Semantic tone for an ROI value, using the same thresholds as roiColor()
 * below. Returns a tone rather than Tailwind classes so the dark screens can
 * map it to their own palette without duplicating the business thresholds.
 */
export function roiTone(r: number): 'good' | 'bad' | 'neutral' {
  if (r >= 8) return 'good';
  if (r < 3)  return 'bad';
  return 'neutral';
}

// Returns a CSS class string for coloring ROI values
export function roiColor(r: number): string {
  if (r >= 8) return "text-emerald-600 font-semibold";
  if (r < 3)  return "text-red-600 font-semibold";
  return "text-gray-800";
}

// Returns a formatted ROI string (use this in PanelRow values)
export function roiFormatted(r: number): string {
  return roi(r);
}

export function getQuadrantColor(quadrant: string) {
  switch (quadrant?.toLowerCase()) {
    case "champions":  return { bg: "bg-green-100", text: "text-green-700",  border: "border-green-300"  };
    case "contenders": return { bg: "bg-blue-100",  text: "text-blue-700",  border: "border-blue-300"   };
    case "cruisers":   return { bg: "bg-gray-100",  text: "text-gray-700",  border: "border-gray-300"   };
    case "casualties": return { bg: "bg-red-100",   text: "text-red-700",  border: "border-red-300"    };
    default:           return { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300"  };
  }
}