import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/AppRoutes';
import { ClientsProvider } from './app/clients';
import { SessionProvider } from './app/session';
import { httpAuthClient } from './lib/auth-client';

export function App() {
  return (
    <SessionProvider bootstrap={() => httpAuthClient.me()}>
      <ClientsProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ClientsProvider>
    </SessionProvider>
  );
}
