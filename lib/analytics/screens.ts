import { findNavItem } from '@/lib/nav';
import { SCREEN_FALLBACK } from './events';

/**
 * Human-readable screen name for a route.
 *
 * Derived from the nav so renaming a screen in one place renames it in the
 * analytics too — a hardcoded second list would drift and silently split one
 * screen's numbers across two labels.
 */
export function screenFor(pathname: string): string {
  const item = findNavItem(pathname);
  if (item) return item.label;
  if (pathname === '/login') return 'Sign in';
  if (pathname === '/') return 'Root redirect';
  return pathname.length > 0 ? pathname : SCREEN_FALLBACK;
}
