'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Buttons for the footer, laid out right-aligned. */
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]';

/**
 * Centred modal dialog.
 *
 * Follows the overlay conventions already used by the 4C slide-over — same
 * backdrop, same fade, same Escape handling — rather than pulling in the
 * unused shadcn dialog, whose default styling does not match these tokens.
 */
export function Modal({
  open, onClose, title, description, children, footer, className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      // Keep Tab inside the dialog: focus escaping to the page behind an open
      // modal is disorienting with a screen reader and lets a click land on
      // controls the backdrop is supposed to be covering.
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    // Focus the first field so the dialog is usable without reaching for a mouse.
    const timer = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handleKey);
      clearTimeout(timer);
    };
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[3px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            'w-full max-w-[520px] rounded-panel border border-line bg-overlay',
            'shadow-overlay animate-fade-up',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
            <div>
              <h2 id={titleId} className="text-[15.5px] font-semibold text-ink">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-chip text-ink-faint transition-colors hover:bg-panel-raised hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
