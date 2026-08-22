'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw } from 'lucide-react';
import { getSyncJobs, type SyncJobInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 3000;

const SYNC_TYPE_LABEL: Record<string, string> = {
  products_sync: 'Products',
  orders_sync: 'Orders',
  campaigns_sync: 'Campaigns',
  insights_sync: 'Ad spend',
  product_insights_sync: 'Product-level ad spend',
};

function isTerminal(status: SyncJobInfo['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Polls a fixed set of job ids (returned by triggerShopifySync()/triggerMetaSync())
 * until every one reaches a terminal state, then reports the outcome once via
 * onSettled. Progress is deliberately shown as "records processed so far" per
 * job rather than a percentage — the total record count isn't known until a
 * job finishes paginating, so a fabricated percentage would be a guess (same
 * reasoning as components/sources/merge-pipeline.tsx's indeterminate bar).
 */
/**
 * Give this a `key` derived from jobIds (e.g. jobIds.join(',')) from the
 * caller — a fresh key remounts the component so its state resets naturally
 * for a new sync run, rather than this effect reaching back to reset state
 * itself on every jobIds change.
 */
export function SyncProgress({
  jobIds, onSettled,
}: { jobIds: string[]; onSettled: (jobs: SyncJobInfo[]) => void }) {
  const [jobs, setJobs] = useState<SyncJobInfo[] | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (jobIds.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const rows = await getSyncJobs(jobIds);
        if (cancelled) return;
        setJobs(rows);
        if (rows.length > 0 && rows.every((j) => isTerminal(j.status)) && !settledRef.current) {
          settledRef.current = true;
          onSettled(rows);
          return; // stop polling — every job is done
        }
      } catch {
        // A transient network blip mid-poll isn't a sync failure — just retry.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds.join(',')]);

  if (!jobs) {
    return (
      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-tertiary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Starting sync…
      </div>
    );
  }

  return (
    <ul className="mt-3 space-y-1.5">
      {jobs.map((job) => (
        <li
          key={job.id}
          className={cn(
            'flex items-center gap-2.5 rounded-panel border px-3 py-2 text-[12.5px]',
            job.status === 'failed'
              ? 'border-bad-line bg-bad-tint text-bad-soft'
              : job.status === 'completed'
                ? 'border-ok/25 bg-ok-tint text-ok-soft'
                : 'border-line-subtle bg-panel-sunken text-ink-tertiary',
          )}
        >
          <StatusIcon status={job.status} />
          <span className="min-w-0 flex-1 truncate">
            {SYNC_TYPE_LABEL[job.syncType] ?? job.syncType}
          </span>
          <span className="flex-shrink-0 text-[11.5px] text-ink-faint">
            {statusLabel(job)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatusIcon({ status }: { status: SyncJobInfo['status'] }) {
  if (status === 'completed') return <Check className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={3} />;
  if (status === 'failed') return <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />;
  if (status === 'pending') return <RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />;
  return <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />;
}

function statusLabel(job: SyncJobInfo): string {
  if (job.status === 'completed') return `Completed · ${job.recordsFetched.toLocaleString()} records`;
  if (job.status === 'failed') return `Failed after ${job.attempt} attempt${job.attempt === 1 ? '' : 's'}`;
  if (job.status === 'running') return job.recordsFetched > 0 ? `Syncing · ${job.recordsFetched.toLocaleString()} so far` : 'Syncing…';
  if (job.status === 'pending' && job.attempt > 0) return `Retrying (attempt ${job.attempt + 1})…`;
  return 'Queued';
}
