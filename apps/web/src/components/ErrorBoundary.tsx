import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card } from '@gilgamesh/ui';

/** Props handed to a fallback: `reset` clears the caught error and re-mounts the children. */
export interface ErrorFallbackProps {
  reset: () => void;
}

/**
 * On-brand recovery panel shown when a descendant throws during render/lifecycle. It shows only a
 * fixed, generic message — never the underlying error text — so no stack trace or PII reaches the
 * user (details go to the console in dev; see `ErrorBoundary.componentDidCatch`). It reuses the
 * design-system `Card`/`Button` + CSS tokens; no new visual language.
 *
 * `alwaysDark` pins the dark palette on the panel root for the top-level (pre-auth) boundary, which
 * is contractually always-dark regardless of the persisted theme. The inner boundary leaves it off
 * so the panel is theme-aware inside the app shell.
 */
export function ErrorFallback({
  reset,
  alwaysDark = false,
}: ErrorFallbackProps & { alwaysDark?: boolean }) {
  return (
    <div
      className="gx-errpanel"
      role="alert"
      aria-live="assertive"
      {...(alwaysDark ? { 'data-theme': 'dark' } : {})}
    >
      <Card className="gx-errpanel__card">
        <h1 className="gx-errpanel__title">Something went wrong</h1>
        <p className="gx-errpanel__msg">
          This view hit an unexpected error. Your work is safe — try again, or reload the page.
        </p>
        <div className="gx-errpanel__actions">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </Card>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Render-prop override for the fallback UI (defaults to the on-brand `ErrorFallback`). */
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Pin the fallback to the dark palette regardless of the active theme (pre-auth top-level). */
  alwaysDark?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a runtime render/lifecycle error thrown by any descendant and swaps in a recoverable
 * fallback panel instead of letting React unmount the whole tree (the blank white screen). React
 * error boundaries catch errors during render/lifecycle ONLY — never event handlers or async work.
 *
 * Two live instances: a top-level catch-all around the router (`App.tsx`, `alwaysDark`) and an inner
 * one around the routed `<Outlet/>` keyed by `pathname` (`AppLayout.tsx`) so the app shell stays
 * usable on a screen crash and a later navigation auto-recovers.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Details go to the console in DEV only — never to the rendered UI (no stack/PII leak).
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] caught a render error', error, info.componentStack);
    }
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      const { fallback, alwaysDark } = this.props;
      if (fallback) return fallback({ reset: this.reset });
      return <ErrorFallback reset={this.reset} alwaysDark={alwaysDark} />;
    }
    return this.props.children;
  }
}
