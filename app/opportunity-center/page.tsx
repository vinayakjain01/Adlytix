'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Loader2, Megaphone, Package, Sparkles, Target,
  TrendingUp, Zap, ShieldAlert,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useApp } from '@/lib/context';
import { daysToRange } from '@/lib/date-range';
import {
  getOpportunityCenter, type OpportunityEntityType, type Opportunity,
  type OpportunityCategory, type OpportunityCenterResult,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const CATEGORY_META: Record<OpportunityCategory, { label: string; icon: typeof Zap; className: string }> = {
  scale: { label: 'Scale', icon: TrendingUp, className: 'border-ok/30 bg-ok-tint text-ok-soft' },
  'product-opportunity': { label: 'Product opportunity', icon: Sparkles, className: 'border-brand/30 bg-brand-tint text-brand-100' },
  'performance-drop': { label: 'Performance drop', icon: ShieldAlert, className: 'border-warn/30 bg-warn-tint text-warn' },
  'creative-fatigue': { label: 'Creative fatigue', icon: Zap, className: 'border-warn/30 bg-warn-tint text-warn' },
};

const ENTITY_ICON: Record<OpportunityEntityType, typeof Megaphone> = {
  campaign: Megaphone, ad: Target, product: Package,
};

const ENTITY_LINK: Record<OpportunityEntityType, string> = {
  campaign: '/campaigns', ad: '/ads', product: '/product-analysis',
};

const SEVERITY_STYLE: Record<string, string> = {
  high: 'border-bad-line bg-bad-tint text-bad-soft',
  medium: 'border-warn/30 bg-warn-tint text-warn',
  low: 'border-line-subtle bg-panel-sunken text-ink-tertiary',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'text-ok-soft', medium: 'text-warn', low: 'text-ink-faint',
};

export default function OpportunityCenterPage() {
  const { integrationRangeDays } = useApp();
  const [data, setData] = useState<OpportunityCenterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OpportunityCategory | 'all'>('all');

  const load = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getOpportunityCenter(daysToRange(days)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the opportunity center.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(integrationRangeDays);
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [load, integrationRangeDays]);

  const items = data ? (filter === 'all' ? data.opportunities : data.opportunities.filter((o) => o.category === filter)) : [];

  return (
    <AppShell>
      <div className="animate-fade-up">
        <header className="mb-7">
          <h1 className="mb-1.5 text-[27px] font-semibold tracking-[-0.03em]">Opportunity center</h1>
          <p className="text-[14px] text-ink-secondary">
            Where your marketing money is working, where it&apos;s at risk, and what to do next — every
            item below is a real signal from Product Intelligence and Campaign/Ad Audit, not a prediction.
          </p>
        </header>

        {error && (
          <div className="mb-4 flex items-center gap-2.5 rounded-card border border-bad-line bg-bad-tint px-5 py-3.5 text-[13px] text-bad-soft">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2.5 rounded-card border border-line bg-panel py-16 text-[13px] text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding opportunities…
          </div>
        ) : !data || data.opportunities.length === 0 ? (
          <div className="rounded-card border border-line bg-panel px-6 py-16 text-center">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
            <p className="text-[14px] text-ink-tertiary">
              {data ? 'No opportunities detected in this range yet.' : 'No campaign/ad data synced for this range yet.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap gap-2.5">
              <SummaryChip
                active={filter === 'all'}
                onClick={() => setFilter('all')}
                label={`${data.opportunities.length} opportunities`}
                icon={Sparkles}
                className="border-brand/30 bg-brand-tint text-brand-100"
              />
              {(Object.keys(CATEGORY_META) as OpportunityCategory[])
                .filter((cat) => (data.counts[cat] ?? 0) > 0)
                .map((cat) => {
                  const meta = CATEGORY_META[cat];
                  return (
                    <SummaryChip
                      key={cat}
                      active={filter === cat}
                      onClick={() => setFilter(filter === cat ? 'all' : cat)}
                      label={`${data.counts[cat]} ${meta.label}`}
                      icon={meta.icon}
                      className={meta.className}
                    />
                  );
                })}
            </div>

            <div className="space-y-2.5">
              {items.map((o, i) => (
                <OpportunityCard key={`${o.category}-${o.entityType}-${o.entityId}-${i}`} opportunity={o} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function SummaryChip({
  active, onClick, label, icon: Icon, className,
}: { active: boolean; onClick: () => void; label: string; icon: typeof Zap; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-chip border px-3.5 py-2 text-[12.5px] font-medium transition-transform',
        className, active ? 'scale-[1.03]' : 'opacity-80 hover:opacity-100',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function OpportunityCard({ opportunity: o }: { opportunity: Opportunity }) {
  const meta = CATEGORY_META[o.category];
  const EntityIcon = ENTITY_ICON[o.entityType];
  return (
    <div className="rounded-card border border-line bg-panel px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn('flex items-center gap-1.5 rounded-chip border px-2 py-0.5 text-[10.5px] font-medium', meta.className)}>
          <meta.icon className="h-3 w-3" />
          {meta.label.toUpperCase()}
        </span>
        <span className={cn('rounded-chip border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.04em]', SEVERITY_STYLE[o.severity])}>
          {o.severity}
        </span>
        <span className="flex items-center gap-1 rounded-chip border border-line-subtle bg-panel-sunken px-2 py-0.5 text-[10.5px] text-ink-faint">
          <EntityIcon className="h-3 w-3" />
          {o.entityType}
        </span>
        <span className={cn('ml-auto text-[11px] font-medium', CONFIDENCE_STYLE[o.confidence])}>
          {o.confidence.toUpperCase()} CONFIDENCE
        </span>
      </div>

      <h3 className="mb-1 text-[14px] font-medium text-ink">{o.entityName}</h3>
      <p className="mb-2 text-[12.5px] leading-relaxed text-ink-secondary">{o.reason}</p>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-body">
        <span className="font-medium text-ink">Recommendation:</span> {o.recommendedAction}
      </p>

      <div className="flex items-center justify-between border-t border-line-subtle pt-2.5">
        <span className="text-[11.5px] text-ink-faint">
          {o.metric} = {o.metricValue != null ? o.metricValue.toFixed(2) : '—'}
          {o.comparisonMetric != null && <> · benchmark {o.comparisonMetric.toFixed(2)}</>}
        </span>
        <Link href={ENTITY_LINK[o.entityType]} className="text-[11.5px] font-medium text-brand-200 hover:underline">
          View analysis →
        </Link>
      </div>
    </div>
  );
}
