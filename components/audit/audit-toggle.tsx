'use client';

import Link from 'next/link';
import { Megaphone, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Campaign Audit and Ad Audit share one sidebar entry ("Audit") — this switches between them in-page. */
export function AuditToggle({ active }: { active: 'campaigns' | 'ads' }) {
  return (
    <div className="mb-6 inline-flex rounded-control border border-line bg-panel-sunken p-1">
      <Link
        href="/campaigns"
        className={cn(
          'flex items-center gap-2 rounded-chip px-3.5 py-1.5 text-[13px] font-medium transition-colors',
          active === 'campaigns' ? 'bg-panel text-ink shadow-sm' : 'text-ink-faint hover:text-ink-tertiary',
        )}
      >
        <Megaphone className="h-3.5 w-3.5" />
        Campaign audit
      </Link>
      <Link
        href="/ads"
        className={cn(
          'flex items-center gap-2 rounded-chip px-3.5 py-1.5 text-[13px] font-medium transition-colors',
          active === 'ads' ? 'bg-panel text-ink shadow-sm' : 'text-ink-faint hover:text-ink-tertiary',
        )}
      >
        <Target className="h-3.5 w-3.5" />
        Ad audit
      </Link>
    </div>
  );
}
