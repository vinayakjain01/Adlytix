'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Megaphone, TrendingDown, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AuditToggle } from '@/components/audit/audit-toggle';
import { useApp } from '@/lib/context';
import { daysToRange } from '@/lib/date-range';
import { getAdAudit, type AdAuditRow } from '@/lib/api';
import { pct, roi } from '@/lib/formatters';
import { cn } from '@/lib/utils';

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function scoreTone(score: number): string {
  if (score >= 65) return 'border-ok/30 bg-ok-tint text-ok-soft';
  if (score >= 45) return 'border-warn/30 bg-warn-tint text-warn';
  return 'border-bad-line bg-bad-tint text-bad-soft';
}

export default function AdAuditPage() {
  const { integrationRangeDays } = useApp();
  const [rows, setRows] = useState<AdAuditRow[] | null>(null);
  const [conversionsAvailable, setConversionsAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdAudit(daysToRange(d));
      setRows(result.ads);
      setConversionsAvailable(result.productLevelConversionsAvailable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load ad audit.');
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

  return (
    <AppShell>
      <div className="animate-fade-up">
        <AuditToggle active="ads" />

        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Ad audit</h1>
          <p className="text-[14px] text-ink-secondary">
            Per-ad performance, trend vs. the prior period, and a health score built only from
            metrics shown here — no invented signals.
          </p>
        </header>

        {error && (
          <div className="mb-4 flex items-center gap-2.5 rounded-card border border-bad-line bg-bad-tint px-5 py-3.5 text-[13px] text-bad-soft">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {!conversionsAvailable && rows && rows.length > 0 && (
          <div className="mb-4 rounded-card border border-warn/25 bg-warn-tint px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-body">
            Meta doesn&apos;t report purchase actions at the per-product breakdown level for this account —
            product mix below shows real attributed spend only, not conversion value/ROAS per product.
          </div>
        )}

        {loading && !rows ? (
          <div className="flex items-center justify-center gap-2.5 rounded-card border border-line bg-panel py-16 text-[13px] text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading ad audit…
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <Megaphone className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
            <p className="text-[14px] text-ink-tertiary">No ad data synced for this range yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-panel">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b border-line-subtle text-left text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-3 font-medium">Ad</th>
                  <th className="px-3 py-3 text-right font-medium">Spend</th>
                  <th className="px-3 py-3 text-right font-medium">CTR</th>
                  <th className="px-3 py-3 text-right font-medium">CPC</th>
                  <th className="px-3 py-3 text-right font-medium">CPM</th>
                  <th className="px-3 py-3 text-right font-medium">Frequency</th>
                  <th className="px-3 py-3 text-right font-medium">Platform ROAS</th>
                  <th className="px-3 py-3 text-right font-medium">Trend</th>
                  <th className="px-3 py-3 text-center font-medium">Score</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <Fragment key={a.adId}>
                    <tr
                      onClick={() => setExpanded(expanded === a.adId ? null : a.adId)}
                      className="cursor-pointer border-b border-line-subtle transition-colors hover:bg-panel-raised"
                    >
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="truncate font-medium text-ink" title={a.name}>{a.name}</div>
                        <div className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                          {a.campaignName ?? 'Unknown campaign'}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{fmtMoney(a.spend)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{pct(a.ctr)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{fmtMoney(a.cpc)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{fmtMoney(a.cpm)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">
                        {a.frequency != null ? a.frequency.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{roi(a.platformRoas)}</td>
                      <td className="px-3 py-3 text-right">
                        {a.trend?.platformRoas != null ? (
                          <span className={cn('inline-flex items-center gap-1 font-mono text-[12px]',
                            a.trend.platformRoas >= 0 ? 'text-ok' : 'text-bad')}>
                            {a.trend.platformRoas >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.abs(a.trend.platformRoas)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={cn('rounded-chip border px-2 py-0.5 font-mono text-[11.5px] font-medium', scoreTone(a.score))}>
                          {a.score}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-ink-faint">
                        {expanded === a.adId ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                    </tr>
                    {expanded === a.adId && (
                      <tr className="border-b border-line-subtle bg-panel-sunken">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="grid gap-5 md:grid-cols-2">
                            <div>
                              <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-faint">WHY THIS SCORE</p>
                              {a.scoreReasons.length === 0 ? (
                                <p className="text-[12.5px] text-ink-faint">Not enough signal yet for a strong read either way.</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {a.scoreReasons.map((reason, i) => (
                                    <li key={i} className="flex gap-2 text-[12.5px] text-ink-body">
                                      <span className="text-ink-faint">·</span>
                                      {reason}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-faint">PRODUCT MIX</p>
                              {a.productMix.length === 0 ? (
                                <p className="text-[12.5px] text-ink-faint">No product-level attribution for this ad in range.</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {a.productMix.slice(0, 8).map((p) => (
                                    <li key={p.productId ?? p.title} className="flex items-center justify-between gap-3 text-[12.5px]">
                                      <span className="min-w-0 truncate text-ink-body">{p.title}</span>
                                      <span className="flex-shrink-0 font-mono text-ink-tertiary">
                                        {fmtMoney(p.spend)}{p.platformRoas != null && <> · {roi(p.platformRoas)}</>}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
