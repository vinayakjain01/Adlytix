'use client';

import Link from 'next/link';
import { FileUp, Plug } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The two ways data gets into Adlytix, made explicit as a single switch
 * rather than two unrelated nav entries. Both modes feed the exact same
 * Overview / Product Analysis / 4C Quadrant / AI Insights screens once their
 * data lands in AppContext via setMergedResult — this toggle only decides
 * which screen collects that data, not how it's used afterward.
 */
export function ModeToggle({ active }: { active: 'upload' | 'integration' }) {
  return (
    <div className="mb-6 inline-flex rounded-control border border-line bg-panel-sunken p-1">
      <Link
        href="/sources"
        className={cn(
          'flex items-center gap-2 rounded-chip px-3.5 py-1.5 text-[13px] font-medium transition-colors',
          active === 'upload' ? 'bg-panel text-ink shadow-sm' : 'text-ink-faint hover:text-ink-tertiary',
        )}
      >
        <FileUp className="h-3.5 w-3.5" />
        Data Source Upload
      </Link>
      <Link
        href="/integrations"
        className={cn(
          'flex items-center gap-2 rounded-chip px-3.5 py-1.5 text-[13px] font-medium transition-colors',
          active === 'integration' ? 'bg-panel text-ink shadow-sm' : 'text-ink-faint hover:text-ink-tertiary',
        )}
      >
        <Plug className="h-3.5 w-3.5" />
        Integration
      </Link>
    </div>
  );
}
