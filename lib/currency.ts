import { apiJson } from './http';

/**
 * The six currencies the product supports, matching backend/currency.py.
 *
 * AUD was replaced by AED here — the previous list offered AUD, which was not
 * one of the requested currencies, and omitted AED, which was.
 */
export type CurrencyCode = 'INR' | 'USD' | 'AED' | 'EUR' | 'GBP' | 'CAD';

export interface CurrencyOption {
  code: CurrencyCode;
  symbol: string;
  label: string;
  locale: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', label: 'US Dollar', locale: 'en-US' },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham', locale: 'en-AE' },
  { code: 'EUR', symbol: '€', label: 'Euro', locale: 'en-IE' },
  { code: 'GBP', symbol: '£', label: 'British Pound', locale: 'en-GB' },
  { code: 'CAD', symbol: 'CA$', label: 'Canadian Dollar', locale: 'en-CA' },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as string[]).includes(value);
}

export function currencyOption(code: CurrencyCode): CurrencyOption {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/** Rates quoted as "1 <code> = N <base>". */
export interface RateTable {
  base: CurrencyCode;
  rates: Record<string, number>;
  fetchedAt: number | null;
  provider: string;
}

export function fetchRates(base: CurrencyCode, refresh = false) {
  const query = new URLSearchParams({ base, ...(refresh ? { refresh: 'true' } : {}) });
  return apiJson<RateTable>(`/api/rates?${query.toString()}`);
}

/**
 * Multiplier converting an amount held in `base` into `display`.
 *
 * ── The rate convention, which is easy to get backwards ──────────────────
 * `table.rates[X]` is **how many table.base units one X is worth**, exactly as
 * the RateTable doc above says and exactly what /api/rates returns. With a table
 * based on INR, `rates.USD` is ≈95.76, because one dollar is worth about 95.76
 * rupees. `rates[table.base]` is therefore always 1.
 *
 * Converting an amount OUT of a currency is a division, not a multiplication:
 *   1 X    = rates[X] tableBase
 *   1 base = rates[base] tableBase = (rates[base] / rates[display]) display
 *
 * So the factor is `rates[base] / rates[display]`, and because `rates[base]` is
 * 1 when the amounts are already in the table's own base, that single expression
 * covers both cases. It is written as one formula deliberately: this used to be
 * two branches, and they disagreed with each other and with the API — turning a
 * ₹20.5 lakh total into "$196 million" when the display currency changed.
 *
 * Returns null when the rate is unknown — callers must not fall back to 1,
 * which is precisely the assumption that corrupted the merged totals before.
 */
export function displayFactor(
  base: CurrencyCode,
  display: CurrencyCode,
  table: RateTable | null,
): number | null {
  if (base === display) return 1;
  if (!table) return null;

  const perBase = table.base === base ? 1 : table.rates[base];
  const perDisplay = table.rates[display];

  if (!perBase || !perDisplay || perBase <= 0 || perDisplay <= 0) return null;
  return perBase / perDisplay;
}

/** "1 USD = ₹95.86" — the phrasing used in the design. */
export function rateSentence(
  from: CurrencyCode,
  to: CurrencyCode,
  table: RateTable | null,
): string | null {
  const factor = displayFactor(from, to, table);
  if (factor === null) return null;
  const target = currencyOption(to);
  // Two decimals reads cleanly for ordinary rates; sub-unit rates (1 INR =
  // 0.0104 USD) need more precision or they round away to nothing.
  const decimals = factor >= 1 ? 2 : 6;
  return `1 ${from} = ${target.symbol}${factor.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  })}`;
}

export function rateAge(fetchedAt: number | null, now = Date.now()): string {
  if (!fetchedAt) return 'not fetched yet';
  const seconds = Math.max(0, Math.round(now / 1000 - fetchedAt));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
