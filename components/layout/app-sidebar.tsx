'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { BRAND, NAV_GROUPS, navItemsFor } from '@/lib/nav';
import { useAuth } from '@/lib/auth-context';
import { initialsOf, roleLabel } from '@/lib/auth';
import { useStoredPreference } from '@/hooks/use-stored-preference';
import { LogoMark } from './logo-mark';
import { cn } from '@/lib/utils';

const EXPANDED = 238;
const COLLAPSED = 74;
const STORAGE_KEY = 'adlytix_sidebar_collapsed';

/** Module-level so the snapshot reader keeps a stable identity. */
function parseCollapsed(raw: string | null): boolean | null {
  return raw === null ? null : raw === '1';
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  // localStorage is the source of truth, read through useSyncExternalStore so
  // the server render sees the default and the client picks up the saved value
  // after hydration — no mount effect, and no hydration mismatch.
  const [collapsed, setCollapsed] = useStoredPreference(STORAGE_KEY, parseCollapsed, false);

  function toggle() {
    setCollapsed(!collapsed, (next) => (next ? '1' : '0'));
  }

  return (
    <aside
      className={cn(
        'sticky top-0 z-50 flex h-screen flex-shrink-0 flex-col',
        'border-r border-line-subtle bg-rail',
        'transition-[width] duration-300 ease-[cubic-bezier(.4,0,.2,1)]',
      )}
      style={{ width: collapsed ? COLLAPSED : EXPANDED }}
    >
      {/* Brand */}
      <div className="flex h-[62px] items-center gap-3 overflow-hidden border-b border-line-subtle px-[18px]">
        <LogoMark size={30} />
        <span
          className={cn(
            'whitespace-nowrap text-[16px] font-semibold tracking-[-0.02em] text-ink',
            'transition-opacity duration-200',
            collapsed && 'pointer-events-none opacity-0',
          )}
        >
          {BRAND}
        </span>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-hidden px-2.5 py-4">
        {NAV_GROUPS.map((group) => {
          const items = navItemsFor(group.id, user?.isPlatformAdmin ?? false);
          if (items.length === 0) return null;

          return (
            <div key={group.id} className="contents">
              <p
                className={cn(
                  'whitespace-nowrap px-2.5 pb-2 pt-1.5 text-[10px] font-semibold',
                  'tracking-[0.14em] text-ink-faint transition-opacity duration-200',
                  collapsed && 'opacity-0',
                )}
              >
                {group.label.toUpperCase()}
              </p>

              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 whitespace-nowrap rounded-chip px-2.5 py-2.5',
                      'text-[13.5px] transition-colors',
                      active
                        ? 'bg-brand-tint text-ink'
                        : 'text-ink-secondary hover:bg-sidebar-accent hover:text-ink',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-[18px] w-[18px] flex-shrink-0',
                        active ? 'text-brand-300' : 'text-ink-faint',
                      )}
                    />
                    <span
                      className={cn(
                        'flex-1 transition-opacity duration-200',
                        collapsed && 'opacity-0',
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Signed-in account */}
      {user && (
        <div className="border-t border-line-subtle px-2.5 pt-2.5">
          <div className="flex items-center gap-2.5 overflow-hidden rounded-chip px-2.5 py-2">
            <span
              title={user.email}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[linear-gradient(140deg,#34D399,#5B7CFF)] text-[10.5px] font-semibold text-[#08121F]"
            >
              {initialsOf(user)}
            </span>
            <span
              className={cn(
                'min-w-0 transition-opacity duration-200',
                collapsed && 'pointer-events-none opacity-0',
              )}
            >
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {user.name || user.email}
              </span>
              <span className="block truncate text-[11px] text-ink-muted">
                {user.client ? `${user.client.name} · ` : ''}
                {roleLabel(user.role)}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            title="Sign out"
            className={cn(
              'flex w-full items-center gap-3 whitespace-nowrap rounded-chip px-2.5 py-2.5',
              'text-[13px] text-ink-tertiary transition-colors hover:bg-sidebar-accent hover:text-bad',
            )}
          >
            <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
            <span className={cn('transition-opacity duration-200', collapsed && 'opacity-0')}>
              Sign out
            </span>
          </button>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-line-subtle p-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-3 whitespace-nowrap rounded-chip px-2.5 py-2.5',
            'text-[13px] text-ink-tertiary transition-colors',
            'hover:bg-sidebar-accent hover:text-ink',
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-[18px] w-[18px] flex-shrink-0" />
          ) : (
            <ChevronsLeft className="h-[18px] w-[18px] flex-shrink-0" />
          )}
          <span className={cn('transition-opacity duration-200', collapsed && 'opacity-0')}>
            Collapse
          </span>
        </button>
      </div>
    </aside>
  );
}
