'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/**
 * Client-side gate around the application shell.
 *
 * This is a UX guard, not the security boundary — the frontend is a static
 * bundle, so anything shipped to the browser is readable. Enforcement lives on
 * the API: every protected route resolves the session cookie and re-checks
 * suspension and subscription expiry against the database, so a bypassed
 * redirect still yields no data.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'authenticated') return <>{children}</>;

  // Shown while the cookie is being validated, and for the instant before the
  // redirect lands. Mirrors the shell's shape so there is no layout jump.
  return (
    <div className="adlytix flex min-h-screen bg-page font-sans text-ink antialiased">
      <div className="hidden w-[238px] flex-shrink-0 border-r border-line-subtle bg-rail md:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[62px] flex-shrink-0 border-b border-line-subtle" />
        <div className="flex-1 space-y-4 px-[30px] pt-[30px]">
          <div className="h-8 w-56 animate-shimmer rounded-chip bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]" />
          <div className="grid gap-3.5 sm:grid-cols-2 2xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[96px] animate-shimmer rounded-panel bg-[linear-gradient(90deg,#1B2337_0%,#232D46_40%,#1B2337_80%)] bg-[length:400px_100%]"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        Checking your session…
      </span>
    </div>
  );
}
