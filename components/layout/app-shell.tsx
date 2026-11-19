'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  /**
   * Opt-in: when set, the right panel gets a titled header with an
   * open/close toggle (state remembered in localStorage). Without it the
   * panel renders exactly as before.
   */
  rightPanelTitle?: string;
}

/**
 * The Adlytix application chrome: collapsible rail, sticky blurred header,
 * scrolling content column and the toast host.
 *
 * `.adlytix` scopes the dark design system to this subtree, which is what
 * lets screens that have not been migrated yet keep rendering correctly.
 */
export function AppShell({ children, rightPanel, rightPanelTitle, ...headerProps }: AppShellProps) {
  return (
    <RequireAuth>
      <AppShellFrame rightPanel={rightPanel} rightPanelTitle={rightPanelTitle} {...headerProps}>
        {children}
      </AppShellFrame>
    </RequireAuth>
  );
}

const COLLAPSE_KEY = 'adlytix_right_panel_collapsed';

const flagListeners = new Set<() => void>();
const memoryFlags = new Map<string, boolean>();

/**
 * Boolean kept in localStorage. Reads through useSyncExternalStore so the
 * server render and first client render agree (`initial`), then the saved
 * value is adopted without an effect-driven state update.
 */
function usePersistedFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const subscribe = useCallback((notify: () => void) => {
    flagListeners.add(notify);
    window.addEventListener('storage', notify);
    return () => {
      flagListeners.delete(notify);
      window.removeEventListener('storage', notify);
    };
  }, []);

  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const saved = window.localStorage.getItem(key);
        if (saved !== null) return saved === '1';
      } catch {
        /* storage unavailable — fall through to the in-memory value */
      }
      return memoryFlags.get(key) ?? initial;
    },
    () => initial,
  );

  const update = useCallback(
    (next: boolean) => {
      memoryFlags.set(key, next); // keeps the toggle working when storage is blocked
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* not persisted across visits */
      }
      flagListeners.forEach((notify) => notify());
    },
    [key],
  );

  return [value, update];
}

function AppShellFrame({ children, rightPanel, rightPanelTitle, ...headerProps }: AppShellProps) {
  const [collapsed, setCollapsed] = usePersistedFlag(COLLAPSE_KEY, false);
  const collapsible = Boolean(rightPanelTitle);
  const isCollapsed = collapsible && collapsed;

  return (
    <div className="adlytix flex min-h-screen bg-page font-sans text-[14px] text-ink antialiased">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader {...headerProps} />

        {rightPanel ? (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-4 px-[30px] pb-16 pt-[30px] xl:flex-row">
            <main className="min-w-0 flex-1">{children}</main>
            <aside
              className={cn(
                'w-full flex-shrink-0 xl:sticky xl:top-[86px]',
                isCollapsed ? 'xl:w-[44px]' : 'xl:w-[300px]',
              )}
            >
              {collapsible ? (
                <div className="rounded-card border border-line bg-panel">
                  <div
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5',
                      isCollapsed ? 'xl:justify-center xl:px-0' : 'justify-between',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[11px] font-semibold uppercase tracking-widest text-ink-muted',
                        isCollapsed && 'xl:hidden',
                      )}
                    >
                      {rightPanelTitle}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCollapsed(!collapsed)}
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                      className="flex h-7 w-7 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-field hover:text-ink"
                    >
                      {isCollapsed ? (
                        <PanelRightOpen className="h-4 w-4" />
                      ) : (
                        <PanelRightClose className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {!isCollapsed && <div className="border-t border-line-subtle p-4">{rightPanel}</div>}
                </div>
              ) : (
                rightPanel
              )}
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
