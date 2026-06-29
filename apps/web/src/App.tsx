import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/AppRoutes';
import { ClientsProvider } from './app/clients';
import { SessionProvider } from './app/session';

export function App() {
  return (
    <SessionProvider>
      <ClientsProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ClientsProvider>
    </SessionProvider>
  );
}
