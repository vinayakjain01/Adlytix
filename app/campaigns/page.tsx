'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Megaphone } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AuditToggle } from '@/components/audit/audit-toggle';
import { useApp } from '@/lib/context';
import { daysToRange } from '@/lib/date-range';
import { getCampaignAudit, type CampaignAuditRow } from '@/lib/api';
import { num, pct, roi } from '@/lib/formatters';

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CampaignAuditPage() {
  const { integrationRangeDays } = useApp();
  const [rows, setRows] = useState<CampaignAuditRow[] | null>(null);
  const [conversionsAvailable, setConversionsAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCampaignAudit(daysToRange(d));
      setRows(result.campaigns);
      setConversionsAvailable(result.productLevelConversionsAvailable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaign audit.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Follows the global date-range control in the header (Section 12) — no
  // local range picker here, so there's exactly one control to keep in sync.
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
        <AuditToggle active="campaigns" />

        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Campaign audit</h1>
          <p className="text-[14px] text-ink-secondary">
            Spend, reach and platform ROAS per campaign — with the product mix actually driving it.
            Figures are Meta&apos;s own reported numbers, not converted.
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
            product mix below shows real attributed spend, but conversion value/ROAS per product isn&apos;t
            available (campaign-level conversion value above is still real).
          </div>
        )}

        {loading && !rows ? (
          <div className="flex items-center justify-center gap-2.5 rounded-card border border-line bg-panel py-16 text-[13px] text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading campaign audit…
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <Megaphone className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
            <p className="text-[14px] text-ink-tertiary">No campaign data synced for this range yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-panel">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-line-subtle text-left text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-3 py-3 text-right font-medium">Spend</th>
                  <th className="px-3 py-3 text-right font-medium">Conversions</th>
                  <th className="px-3 py-3 text-right font-medium">Conv. value</th>
                  <th className="px-3 py-3 text-right font-medium">Platform ROAS</th>
                  <th className="px-3 py-3 text-right font-medium">CTR</th>
                  <th className="px-3 py-3 text-right font-medium">CPM</th>
                  <th className="px-3 py-3 text-right font-medium">Product-attributed</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Fragment key={c.campaignId}>
                    <tr
                      onClick={() => setExpanded(expanded === c.campaignId ? null : c.campaignId)}
                      className="cursor-pointer border-b border-line-subtle transition-colors hover:bg-panel-raised"
                    >
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="truncate font-medium text-ink" title={c.name}>{c.name}</div>
                        {c.primaryDriver && (
                          <div className="mt-0.5 truncate text-[11.5px] text-ink-faint" title={c.primaryDriver}>
                            {c.primaryDriver}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{fmtMoney(c.spend)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{num(c.conversions)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{fmtMoney(c.conversionValue)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{roi(c.platformRoas)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{pct(c.ctr)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-body">{fmtMoney(c.cpm)}</td>
                      <td className="px-3 py-3 text-right font-mono text-ink-tertiary">
                        {fmtMoney(c.productAttributedSpend)}
                        {c.unattributedSpend > 0 && (
                          <span className="ml-1.5 text-[11px] text-ink-faint">
                            (+{fmtMoney(c.unattributedSpend)} unattributed)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-faint">
                        {expanded === c.campaignId ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                    </tr>
                    {expanded === c.campaignId && (
                      <tr className="border-b border-line-subtle bg-panel-sunken">
                        <td colSpan={9} className="px-4 py-4">
                          {c.productMix.length === 0 ? (
                            <p className="text-[12.5px] text-ink-faint">No product-level attribution for this campaign in range.</p>
                          ) : (
                            <div className="max-w-2xl">
                              <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-faint">PRODUCT MIX</p>
                              <ul className="space-y-1.5">
                                {c.productMix.slice(0, 10).map((p) => (
                                  <li key={p.productId ?? p.title} className="flex items-center justify-between gap-3 text-[12.5px]">
                                    <span className="min-w-0 truncate text-ink-body">{p.title}</span>
                                    <span className="flex-shrink-0 font-mono text-ink-tertiary">
                                      {fmtMoney(p.spend)} spend
                                      {p.platformRoas != null && <> · {roi(p.platformRoas)} ROAS</>}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
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
