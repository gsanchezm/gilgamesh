import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { subscribeConnectivity } from '../lib/connection-status';

interface ConnectionStatusValue {
  /** `false` while connectivity looks lost (a network/timeout report, `offline` event, or `navigator.onLine`). */
  online: boolean;
}

const ConnectionStatusContext = createContext<ConnectionStatusValue>({ online: true });

/** `navigator.onLine` is a coarse hint (a captive portal can lie); the HTTP reports refine it. */
function initialOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Global connection-status provider (slice 32). Subscribes to the HTTP layer's connectivity reports
 * AND to the browser `online`/`offline` events, seeds from `navigator.onLine`, and renders the banner.
 *
 * `online` is a primitive boolean so `setOnline(true)` on every successful request is idempotent —
 * React bails on an unchanged value, so a burst of successful GETs causes no app-wide re-render churn.
 * A `dismissed` flag hides the banner manually; it resets on the next recovery so a fresh outage
 * re-shows it (a repeated offline report during the SAME outage keeps it dismissed).
 *
 * Mounted high in `App.tsx`, OUTSIDE the top-level `ErrorBoundary` (connectivity is orthogonal to
 * render crashes) and inside `ThemeProvider`, so the banner survives a screen/router render crash.
 */
export function ConnectionStatusProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean>(initialOnline);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const goOffline = () => setOnline(false);
    const goOnline = () => {
      setOnline(true);
      // Recovery ends the outage: clear any manual dismissal so the next drop shows the banner again.
      setDismissed(false);
    };

    const unsubscribe = subscribeConnectivity((event) => {
      if (event === 'offline') goOffline();
      else goOnline();
    });
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      unsubscribe();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const value = useMemo<ConnectionStatusValue>(() => ({ online }), [online]);

  return (
    <ConnectionStatusContext.Provider value={value}>
      <ConnectionBanner online={online} dismissed={dismissed} onDismiss={() => setDismissed(true)} />
      {children}
    </ConnectionStatusContext.Provider>
  );
}

export function useConnectionStatus(): ConnectionStatusValue {
  return useContext(ConnectionStatusContext);
}
