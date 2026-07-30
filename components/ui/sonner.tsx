'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Toast host, styled to the Adlytix design.
 *
 * The theme is pinned to `dark` rather than read from next-themes: the app
 * renders a single dark theme and no ThemeProvider is mounted, so `useTheme()`
 * would have fallen back to `system` and produced light toasts on a
 * light-mode OS.
 *
 * Mounted inside the `.adlytix` subtree — sonner renders in place rather than
 * through a portal, so the scoped design tokens below resolve.
 */
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    position="bottom-right"
    className="toaster group"
    style={
      {
        '--normal-bg': 'var(--overlay)',
        '--normal-text': 'var(--ink-body)',
        '--normal-border': 'var(--line-strong)',
        '--border-radius': '14px',
      } as React.CSSProperties
    }
    toastOptions={{
      classNames: {
        toast:
          'group !gap-3 !rounded-panel !border-line-strong !bg-overlay !px-4 !py-3.5 ' +
          '!text-[13px] !text-ink-body !shadow-toast',
        title: '!font-normal !text-ink-body',
        description: '!text-ink-muted',
        icon: '!mr-0',
        success: '[&_[data-icon]]:!text-ok',
        error: '[&_[data-icon]]:!text-bad',
        warning: '[&_[data-icon]]:!text-warn',
        info: '[&_[data-icon]]:!text-brand-300',
      },
    }}
    {...props}
  />
)

export { Toaster }
