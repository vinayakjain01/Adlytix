import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AppProvider } from '@/lib/context'
import { AiInsightsProvider } from '@/lib/insights-context'
import { AuthProvider } from '@/lib/auth-context'
import { BRAND } from '@/lib/nav'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'
import { ErrorBoundary } from '@/components/analytics/error-boundary'

// Self-hosted at build time, so this works under `output: 'export'` with no
// external request and no layout shift. Both are variable fonts, so the full
// 300–700 range the design uses comes from a single file each.
const geistSans = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  // Reads from the same constant as the sidebar wordmark, so the browser tab
  // and the UI can never disagree about the product's name again.
  title: `${BRAND} — Product ROAS Analytics for D2C Brands`,
  description: 'Analyze return on ad spend at the product level. Built for Indian D2C brands.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png',  media: '(prefers-color-scheme: dark)'  },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0F1A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The page colour is applied literally rather than through bg-page: the
  // --page token lives inside the .adlytix scope, which starts below <body>.
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} bg-[#0B0F1A]`}
    >
      <body className="font-sans antialiased">
        <AuthProvider>
          <AppProvider>
            {/* Inside the providers so a render error still reports with the
                signed-in operator attached, and outside the pages so it catches
                every screen. */}
            <AnalyticsProvider />
            {/* Inside AppProvider: the analysis is built from the merged data,
                and its result is shared by Overview, the sidebar badge and the
                insights screen. */}
            <AiInsightsProvider>
              <ErrorBoundary name="root">{children}</ErrorBoundary>
            </AiInsightsProvider>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  )
}