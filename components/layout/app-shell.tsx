'use client';

import type { ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';
import { AppHeader, type AppHeaderProps } from './app-header';
import { RequireAuth } from '@/components/auth/require-auth';
import { Toaster } from '@/components/ui/sonner';

export interface AppShellProps extends AppHeaderProps {
  children: ReactNode;
  /**
   * Sticky companion column, used by the quadrant screen for its threshold
   * controls. Collapses below the main content on narrow viewports.
   */
  rightPanel?: ReactNode;
}

/**
 * The Adlytix application chrome: collapsible rail, sticky blurred header,
 * scrolling content column and the toast host.
 *
 * `.adlytix` scopes the dark design system to this subtree, which is what
 * lets screens that have not been migrated yet keep rendering correctly.
 */
export function AppShell({ children, rightPanel, ...headerProps }: AppShellProps) {
  return (
    <RequireAuth>
      <AppShellFrame rightPanel={rightPanel} {...headerProps}>
        {children}
      </AppShellFrame>
    </RequireAuth>
  );
}

function AppShellFrame({ children, rightPanel, ...headerProps }: AppShellProps) {
  return (
    <div className="adlytix flex min-h-screen bg-page font-sans text-[14px] text-ink antialiased">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader {...headerProps} />

        {rightPanel ? (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-4 px-[30px] pb-16 pt-[30px] xl:flex-row">
            <main className="min-w-0 flex-1">{children}</main>
            <aside className="w-full flex-shrink-0 xl:sticky xl:top-[86px] xl:w-[300px]">
              {rightPanel}
            </aside>
          </div>
        ) : (
          <main className="min-w-0 flex-1 px-[30px] pb-16 pt-[30px]">{children}</main>
        )}
      </div>

      <Toaster />
    </div>
  );
}
