import { ThemeProvider } from '@gilgamesh/ui';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/AppRoutes';
import { ClientsProvider } from './app/clients';
import { ConnectionStatusProvider } from './app/connection-status';
import { SessionProvider } from './app/session';
import { ErrorBoundary } from './components/ErrorBoundary';
import { httpAuthClient } from './lib/auth-client';

export function App() {
  return (
    <ThemeProvider>
      {/* Global connection banner (slice 32) — mounted OUTSIDE the error boundary so a screen/router
          render crash never takes the "connection lost" signal down with it (connectivity is
          orthogonal to render errors). */}
      <ConnectionStatusProvider>
        {/* Top-level catch-all: a render crash in a pre-auth screen, the router, or a provider degrades
            to the recoverable panel instead of a blank page. `alwaysDark` because pre-auth is always
            dark. The inner boundary (AppLayout) keeps the shell usable for authed-screen crashes. */}
        <ErrorBoundary alwaysDark>
          <SessionProvider bootstrap={() => httpAuthClient.me()}>
            <ClientsProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </ClientsProvider>
          </SessionProvider>
        </ErrorBoundary>
      </ConnectionStatusProvider>
    </ThemeProvider>
  );
}
