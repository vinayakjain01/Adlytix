'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { captureError } from '@/lib/analytics/client';

interface Props {
  children: ReactNode;
  /** Names the boundary in the error report, e.g. "app-shell". */
  name: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single broken component cannot blank the app.
 *
 * Before this existed a thrown render error left an empty page with the cause
 * only visible in the console — which nobody watching production would see.
 * The error is reported to analytics and the user gets a way out.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureError(error, {
      source: 'render',
      endpoint: null,
      status_code: null,
      // The React component stack is far more useful than the boundary name
      // alone; first frame is the component that actually threw.
      component: info.componentStack?.trim().split('\n')[0]?.trim() ?? this.props.name,
    });
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      // `.adlytix` is applied here on purpose. This boundary sits above the
      // pages in the layout, so when a page throws before its AppShell mounts
      // there is no `.adlytix` ancestor — and every token below it (bg-panel,
      // text-ink, border-line) is scoped to that class. Without this the error
      // screen renders unstyled, which is the worst possible moment for it.
      <div className="adlytix flex min-h-[60vh] items-center justify-center bg-page p-6 font-sans text-ink">
        <div className="w-full max-w-[440px] rounded-panel border border-line bg-panel p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-bad-tint">
            <AlertTriangle className="h-5 w-5 text-bad" />
          </div>
          <h2 className="mb-1.5 text-[16px] font-semibold text-ink">Something broke on this screen</h2>
          <p className="mb-1 text-[13px] leading-relaxed text-ink-muted">
            The rest of the app is still fine. Your uploaded data and merge results are untouched.
          </p>
          <p className="mb-5 font-mono text-[11.5px] leading-relaxed text-ink-faint">{error.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex h-9 items-center gap-2 rounded-control bg-brand-gradient px-4 text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      </div>
    );
  }
}
