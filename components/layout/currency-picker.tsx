'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Coins, RefreshCw } from 'lucide-react';
import { useApp } from '@/lib/context';
import { CURRENCIES, displayFactor, rateAge } from '@/lib/currency';
import { useClickOutside } from '@/hooks/use-click-outside';
import { cn } from '@/lib/utils';

/**
 * Display-currency selector.
 *
 * Amounts arrive already normalised into the merge's base currency; this
 * converts them for presentation at the live rate. Where a rate is unknown the
 * option is disabled rather than shown converting at an implied 1:1.
 */
export function CurrencyPicker() {
  const { currency, setCurrency, baseCurrency, rates, ratesError, displayRate, refreshRates } = useApp();
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const active = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          currency === baseCurrency
            ? `Amounts are shown in ${currency}, the currency of this analysis`
            : displayRate === null
              ? `No rate available — amounts are still in ${baseCurrency}`
              : `Converted from ${baseCurrency} at 1 ${currency} = ${(1 / displayRate).toFixed(4)} ${baseCurrency}`
        }
        className={cn(
          'flex h-[34px] items-center gap-2 whitespace-nowrap rounded-control border border-line',
          'bg-field px-3 text-[13px] text-ink-body transition-colors hover:border-line-hover',
        )}
      >
        <Coins className="h-3.5 w-3.5 text-ink-muted" />
        <span className="font-mono text-brand-200">{active.symbol}</span>
        {active.code}
        <ChevronDown
          className={cn('h-3 w-3 text-ink-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute right-0 top-[42px] z-[60] w-[250px] rounded-panel border border-line',
            'bg-overlay p-1.5 shadow-overlay animate-fade-up',
          )}
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[10px] font-semibold tracking-[0.12em] text-ink-faint">
            DISPLAY CURRENCY
          </p>

          {CURRENCIES.map((option) => {
            const isActive = option.code === currency;
            const isBase = option.code === baseCurrency;
            const factor = displayFactor(baseCurrency, option.code, rates);
            const unavailable = !isBase && factor === null;

            return (
              <button
                key={option.code}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={unavailable}
                onClick={() => {
                  setCurrency(option.code);
                  setOpen(false);
                  toast.success(
                    isBase
                      ? `Amounts shown in ${option.code}`
                      : `Converted to ${option.code} at 1 ${option.code} = ${(1 / (factor as number)).toFixed(2)} ${baseCurrency}`,
                  );
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2.5 rounded-chip px-2.5 py-2',
                  'text-[13px] transition-colors',
                  unavailable
                    ? 'cursor-not-allowed text-ink-disabled'
                    : 'hover:bg-panel-raised',
                  isActive ? 'bg-brand-tint text-brand-100' : !unavailable && 'text-ink-body',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="w-7 flex-shrink-0 text-left font-mono text-ink-tertiary">
                    {option.symbol}
                  </span>
                  <span className="truncate">{option.label}</span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-muted">
                    {isBase ? 'base' : factor === null ? '—' : (1 / factor).toFixed(2)}
                  </span>
                  {isActive && <Check className="h-3.5 w-3.5 text-brand" />}
                </span>
              </button>
            );
          })}

          <div className="mb-1 mt-1.5 h-px bg-line-subtle" />
          <div className="px-2.5 pb-1">
            <p className="text-[11px] leading-relaxed text-ink-muted">
              {ratesError
                ? `Rates unavailable — showing ${baseCurrency}. ${ratesError}`
                : rates
                  ? `Rates against ${baseCurrency}, refreshed ${rateAge(rates.fetchedAt)}. ` +
                    'Stored data is never changed — only what you see converts.'
                  : `Loading rates against ${baseCurrency}…`}
            </p>

            {/* A failed fetch would otherwise leave every currency disabled with
                no way to try again — the rates are what enable the options. */}
            {ratesError && (
              <button
                type="button"
                onClick={() => {
                  setRetrying(true);
                  void refreshRates(true).finally(() => setRetrying(false));
                }}
                disabled={retrying}
                className={cn(
                  'mt-2 flex items-center gap-1.5 rounded-chip px-2 py-1 text-[11.5px]',
                  'text-brand-200 transition-colors hover:bg-panel-raised disabled:opacity-60',
                )}
              >
                <RefreshCw className={cn('h-3 w-3', retrying && 'animate-spin')} />
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
