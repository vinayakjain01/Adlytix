'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Grid3x3, Loader2, Search } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useApp } from '@/lib/context';
import { daysToRange } from '@/lib/date-range';
import { getProductAdMatrix, type ProductAdMatrix } from '@/lib/api';
import { roi } from '@/lib/formatters';
import { cn } from '@/lib/utils';

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Darker = more spend, relative to this matrix's own busiest cell — a quick visual read, not a metric. */
function heatClass(spend: number, maxSpend: number): string {
  if (maxSpend <= 0 || spend <= 0) return '';
  const ratio = spend / maxSpend;
  if (ratio > 0.66) return 'bg-brand-tint-strong';
  if (ratio > 0.33) return 'bg-brand-tint';
  return 'bg-brand-tint/40';
}

export default function ProductAdMatrixPage() {
  const { integrationRangeDays } = useApp();
  const [data, setData] = useState<ProductAdMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getProductAdMatrix(daysToRange(d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the product × ad matrix.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Follows the global date-range control in the header (Section 12).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(integrationRangeDays);
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [load, integrationRangeDays]);

  const { rows, ads, maxSpend } = useMemo(() => {
    if (!data) return { rows: [], ads: [], maxSpend: 0 };
    const cellsByProduct = new Map<string, Map<string, { spend: number; platformRoas: number | null }>>();
    const totalByProduct = new Map<string, number>();
    let peak = 0;
    for (const cell of data.cells) {
      if (!cellsByProduct.has(cell.productId)) cellsByProduct.set(cell.productId, new Map());
      cellsByProduct.get(cell.productId)!.set(cell.adId, { spend: cell.spend, platformRoas: cell.platformRoas });
      totalByProduct.set(cell.productId, (totalByProduct.get(cell.productId) ?? 0) + cell.spend);
      if (cell.spend > peak) peak = cell.spend;
    }
    const filtered = data.products.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()));
    const sorted = filtered
      .map((p) => ({ ...p, total: totalByProduct.get(p.id) ?? 0, cells: cellsByProduct.get(p.id) ?? new Map() }))
      .sort((a, b) => b.total - a.total);
    return { rows: sorted, ads: data.ads, maxSpend: peak };
  }, [data, search]);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Product × Ad matrix</h1>
          <p className="text-[14px] text-ink-secondary">
            Which ads are actually spending on which products. Cell shading is relative spend within
            this view, not a metric on its own.
          </p>
        </header>

        {error && (
          <div className="mb-4 flex items-center gap-2.5 rounded-card border border-bad-line bg-bad-tint px-5 py-3.5 text-[13px] text-bad-soft">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {data && !data.productLevelConversionsAvailable && data.cells.length > 0 && (
          <div className="mb-4 rounded-card border border-warn/25 bg-warn-tint px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-body">
            Meta doesn&apos;t report purchase actions at this breakdown level for this account — cells show
            real attributed spend; ROAS per cell isn&apos;t available.
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2.5 rounded-card border border-line bg-panel py-16 text-[13px] text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading matrix…
          </div>
        ) : !data || data.products.length === 0 ? (
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <Grid3x3 className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
            <p className="text-[14px] text-ink-tertiary">No product-level ad attribution synced for this range yet.</p>
          </div>
        ) : (
          <>
            <div className="relative mb-3 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="h-9 w-full rounded-control border border-line bg-field pl-9 pr-3 text-[13px] text-ink-body placeholder:text-ink-faint focus:border-brand focus:outline-none"
              />
            </div>

            <div className="overflow-x-auto rounded-card border border-line bg-panel">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line-subtle text-left text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="sticky left-0 z-10 bg-panel px-4 py-3 font-medium">Product</th>
                    <th className="px-3 py-3 text-right font-medium">Total spend</th>
                    {ads.map((ad) => (
                      <th key={ad.id} className="max-w-[140px] truncate px-3 py-3 text-right font-medium" title={ad.name}>
                        {ad.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-line-subtle">
                      <td className="sticky left-0 z-10 max-w-[220px] truncate bg-panel px-4 py-2.5 font-medium text-ink" title={p.title}>
                        {p.title}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-body">{fmtMoney(p.total)}</td>
                      {ads.map((ad) => {
                        const cell = p.cells.get(ad.id);
                        return (
                          <td
                            key={ad.id}
                            className={cn('px-3 py-2.5 text-right font-mono text-ink-body', cell && heatClass(cell.spend, maxSpend))}
                          >
                            {cell ? (
                              <>
                                {fmtMoney(cell.spend)}
                                {cell.platformRoas != null && (
                                  <span className="ml-1 text-[11px] text-ink-tertiary">{roi(cell.platformRoas)}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
