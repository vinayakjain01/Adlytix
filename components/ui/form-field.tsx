'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared form styling.
 *
 * These lived inside the sign-in screen until the admin dialogs needed the same
 * fields; keeping one copy means a field never looks subtly different depending
 * on which screen it is on.
 */
export const FIELD_CLASS =
  'h-11 w-full rounded-control border border-line bg-field px-3.5 text-[14px] text-ink ' +
  'transition-colors focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand-tint';

export const LABEL_CLASS = 'mb-2 block text-[12px] font-medium text-ink-secondary';

export const BUTTON_PRIMARY =
  'inline-flex h-9 items-center justify-center gap-2 rounded-control bg-brand-gradient px-4 ' +
  'text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-90 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const BUTTON_GHOST =
  'inline-flex h-9 items-center justify-center gap-2 rounded-control border border-line bg-field ' +
  'px-4 text-[13px] text-ink-body transition-colors hover:border-line-hover hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const BUTTON_DANGER =
  'inline-flex h-9 items-center justify-center gap-2 rounded-control border border-bad-line ' +
  'bg-bad-tint px-4 text-[13px] text-bad-soft transition-colors hover:bg-bad/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

interface FieldProps {
  label: string;
  htmlFor: string;
  /** Guidance shown under the control — used for role and status meanings. */
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('mb-4', className)}>
      <label htmlFor={htmlFor} className={LABEL_CLASS}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] text-bad-soft" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{hint}</p>
      )}
    </div>
  );
}

/** Inline error banner, matching the sign-in screen's. */
export function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-control border border-bad-line bg-bad-tint px-3.5 py-3 text-[13px] leading-relaxed text-bad-soft animate-fade-in"
    >
      {message}
    </div>
  );
}
