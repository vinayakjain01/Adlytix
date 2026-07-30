'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Check, Percent, RefreshCw, Upload, X } from 'lucide-react';
import { useApp } from '@/lib/context';
import { CURRENCIES, type CurrencyCode } from '@/lib/currency';
import { fileSize } from '@/lib/formatters';
import { track } from '@/lib/analytics/client';
import { sizeBucket, type SourceId } from '@/lib/analytics/events';
import { cn } from '@/lib/utils';

/**
 * The formats the backend cleaner can actually read. Single source of truth for
 * both the file picker's `accept` and the drop handler — previously only the
 * picker enforced it, so a dropped PDF was accepted here and failed later as an
 * opaque parse error from pandas.
 */
const ACCEPTED_EXTENSIONS = ['csv', 'xlsx', 'xls'] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

function extensionOf(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function isAccepted(file: File): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file));
}

interface SourceConfig {
  id: SourceId;
  name: string;
  /** Omitted for the discount list, which has no vendor logo. */
  logo?: string;
  required: boolean;
  /** The columns the backend cleaner actually looks for. */
  fields: string;
}

const SOURCES: SourceConfig[] = [
  {
    id: 'meta',
    name: 'Meta Ads',
    logo: '/logos/meta.png',
    required: true,
    fields: 'Product ID · Month · Amount spent · Landing page views · CTR · CPM',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    logo: '/logos/shopify.png',
    required: true,
    fields: 'Product variant ID · Product title · Month · Total sales · Net items sold',
  },
  {
    id: 'google',
    name: 'Google Ads',
    logo: '/logos/google-ads.png',
    required: false,
    fields: 'Item ID · Product title · Month · Cost · Conversions',
  },
  {
    id: 'discount',
    name: 'Discount list',
    required: false,
    fields: 'Product ID — one row per discounted product. Powers the Discounts screen.',
  },
];

interface UploadCardProps {
  source: SourceConfig;
  file: File | null;
  onFile: (file: File | null) => void;
  /** Omitted for the discount list, which carries no amounts. */
  currency?: CurrencyCode;
  onCurrencyChange?: (code: CurrencyCode) => void;
  baseCurrency?: CurrencyCode;
}

function UploadCard({
  source, file, onFile, currency, onCurrencyChange, baseCurrency,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Both the picker and the drop target funnel through here so validation and
  // tracking cannot diverge between the two ways of attaching a file.
  const accept = useCallback(
    (picked: File) => {
      const extension = extensionOf(picked);
      track('upload_started', {
        source: source.id,
        extension,
        size_bucket: sizeBucket(picked.size),
      });

      if (!isAccepted(picked)) {
        track('upload_rejected', { source: source.id, extension, reason: 'unsupported_extension' });
        toast.error(`${source.name}: ${ACCEPTED_EXTENSIONS.join(', ')} files only.`);
        return;
      }
      onFile(picked);
    },
    [onFile, source.id, source.name],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const dropped = event.dataTransfer.files[0];
      if (dropped) accept(dropped);
    },
    [accept],
  );

  return (
    <div
      className={cn(
        'rounded-card border bg-panel p-5 transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-card-hover',
        file ? 'border-ok/30' : 'border-line',
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-chip border border-line bg-panel-sunken">
          {source.logo ? (
            <Image
              src={source.logo}
              alt=""
              width={20}
              height={20}
              className="object-contain"
              style={{ width: 'auto', height: 'auto' }}
            />
          ) : (
            <Percent className="h-4 w-4 text-warn" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14.5px] font-medium text-ink">{source.name}</span>
            <span
              className={cn(
                'flex-shrink-0 rounded-[5px] px-1.5 py-[3px] text-[9.5px] font-semibold tracking-[0.08em]',
                source.required ? 'bg-warn-tint text-warn' : 'bg-white/5 text-ink-tertiary',
              )}
            >
              {source.required ? 'REQUIRED' : 'OPTIONAL'}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">{source.fields}</p>
        </div>

        {file && (
          <button
            type="button"
            onClick={() => onFile(null)}
            title={`Remove ${source.name} file`}
            className="flex-shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-bad"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {file ? (
        <div className="flex items-center gap-3 rounded-control border border-ok/20 bg-ok-tint px-3 py-3">
          <Check className="h-3.5 w-3.5 flex-shrink-0 text-ok" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink">{file.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-tertiary">
              {fileSize(file.size)} — stored, no re-upload needed
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Replace file"
            className="flex-shrink-0 rounded p-1 text-ok transition-colors hover:text-ok-soft"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'w-full rounded-control border-[1.5px] border-dashed px-3 py-6 text-center transition-colors',
            dragging
              ? 'border-brand bg-brand-tint'
              : 'border-line-strong hover:border-brand hover:bg-brand-tint/50',
          )}
        >
          <Upload className="mx-auto mb-2 h-[18px] w-[18px] text-ink-faint" />
          <span className="block text-[12.5px] text-ink-secondary">Drop CSV or Excel</span>
          <span className="mt-0.5 block text-[11px] text-ink-faint">
            or click to browse · max 50 MB
          </span>
        </button>
      )}

      {/* Declared currency of the amounts in this file.
          This is the fix for mixed-currency merges: Meta commonly bills in USD
          while Shopify reports in the store's currency, and the totals add the
          two together. Declaring it here lets the server normalise before it
          sums, rather than after. */}
      {currency && onCurrencyChange && (
        <label className="mt-3.5 flex items-center justify-between gap-3 border-t border-line-subtle pt-3.5">
          <span className="text-[11.5px] text-ink-muted">
            Amounts are in
            {baseCurrency && currency !== baseCurrency && (
              <span className="ml-1.5 rounded bg-warn-tint px-1.5 py-0.5 text-[10px] font-medium text-warn">
                converted
              </span>
            )}
          </span>
          <select
            value={currency}
            onChange={(event) => onCurrencyChange(event.target.value as CurrencyCode)}
            aria-label={`Currency of the ${source.name} amounts`}
            className="h-8 rounded-chip border border-line bg-field px-2 text-[12.5px] text-ink-body transition-colors focus:border-brand focus:outline-none"
          >
            {CURRENCIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.code} · {option.symbol}
              </option>
            ))}
          </select>
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        aria-label={`${source.name} export`}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) accept(picked);
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function SourceUploads() {
  const {
    metaFile, shopifyFile, googleFile, discountFile,
    setMetaFile, setShopifyFile, setGoogleFile, setDiscountFile,
    clearMergedData, baseCurrency, sourceCurrencies, setSourceCurrency,
  } = useApp();

  // Memoised: handleFile depends on this, and a fresh object every render would
  // give that callback a new identity on every render too.
  const files = useMemo<Record<SourceId, File | null>>(
    () => ({
      meta: metaFile?.file ?? null,
      shopify: shopifyFile?.file ?? null,
      google: googleFile?.file ?? null,
      discount: discountFile?.file ?? null,
    }),
    [metaFile, shopifyFile, googleFile, discountFile],
  );

  // Same rule as before: dropping a required file invalidates the merge.
  const handleFile = useCallback(
    (id: SourceId, file: File | null) => {
      if (id === 'meta') setMetaFile(file);
      else if (id === 'shopify') setShopifyFile(file);
      else if (id === 'google') setGoogleFile(file);
      else setDiscountFile(file);

      if (!file && (id === 'meta' || id === 'shopify')) clearMergedData();

      if (!file) {
        track('upload_cleared', { source: id });
        return;
      }
      // Counted here rather than in the card because only this level knows how
      // many slots are filled once the new file lands.
      const ready = Object.entries(files).filter(([key, f]) => (key === id ? true : f !== null)).length;
      track('upload_completed', {
        source: id,
        extension: extensionOf(file),
        size_bucket: sizeBucket(file.size),
        sources_ready: ready,
      });
    },
    [setMetaFile, setShopifyFile, setGoogleFile, setDiscountFile, clearMergedData, files],
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      {SOURCES.map((source) => {
        // The discount list is just product IDs — no amounts to convert.
        const money = source.id !== 'discount';
        return (
          <UploadCard
            key={source.id}
            source={source}
            file={files[source.id]}
            onFile={(file) => handleFile(source.id, file)}
            currency={money ? sourceCurrencies[source.id as 'meta' | 'shopify' | 'google'] : undefined}
            onCurrencyChange={
              money
                ? (code) => setSourceCurrency(source.id as 'meta' | 'shopify' | 'google', code)
                : undefined
            }
            baseCurrency={baseCurrency}
          />
        );
      })}
    </div>
  );
}
