import {
  LayoutGrid, Upload, Table2, Grid2X2, Percent, Users, Sparkles, Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * Wordmark shown in the sidebar and on the sign-in screen.
 * Single source of truth so the product name is a one-line change.
 */
export const BRAND = 'Adlytix';

export type NavGroupId = 'workspace' | 'admin';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroupId;
  /**
   * Hidden from anyone who is not a platform administrator.
   *
   * Presentation only — the API is the boundary. A non-admin who navigates to
   * the route directly gets a refusal from the server, not data.
   */
  adminOnly?: boolean;
  /**
   * Other routes that are this same nav entry in disguise — e.g. Integration
   * mode lives at its own route, switched to from Data Source Upload via an
   * in-page toggle rather than a second sidebar link, so both routes should
   * highlight (and breadcrumb as) one sidebar item, not two.
   */
  aliases?: string[];
}

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'admin', label: 'Admin' },
];

/**
 * Only routes that actually exist are listed — a sidebar link that 404s is
 * worse than a sidebar that grows. Each migration phase appends its entry:
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: LayoutGrid, group: 'workspace' },
  { href: '/sources', label: 'Data sources', icon: Upload, group: 'workspace', aliases: ['/integrations'] },
  { href: '/product-analysis', label: 'Product analysis', icon: Table2, group: 'workspace' },
  { href: '/quadrant-view', label: '4C quadrant', icon: Grid2X2, group: 'workspace' },
  { href: '/discount-analysis', label: 'Discounts', icon: Percent, group: 'workspace' },
  { href: '/insights', label: 'AI insights', icon: Sparkles, group: 'workspace' },
  { href: '/settings', label: 'Settings', icon: Settings, group: 'admin' },
  { href: '/users', label: 'Users & access', icon: Users, group: 'admin', adminOnly: true },
];

export function navItemsFor(group: NavGroupId, isPlatformAdmin = false): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.group === group && (!item.adminOnly || isPlatformAdmin),
  );
}

/** True if `pathname` is this item's own route or one of its aliases (see NavItem.aliases). */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return [item.href, ...(item.aliases ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** Longest-prefix match (own route or alias) so nested/aliased routes still highlight their parent. */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS
    .filter((item) => isNavItemActive(item, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function groupLabel(group: NavGroupId): string {
  return NAV_GROUPS.find((g) => g.id === group)?.label ?? '';
}
