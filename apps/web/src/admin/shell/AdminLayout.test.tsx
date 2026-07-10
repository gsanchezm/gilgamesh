import { ThemeProvider } from '@gilgamesh/ui';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SessionProvider } from '../../app/session';
import { AdminLayout } from './AdminLayout';

// The admin console renders MOCK data, so the shell shows a persistent "Demo data" warning. Admin
// i18n defaults to Spanish in jsdom (localStorage empty), so this asserts the ES copy.
describe('AdminLayout — demo-data indicator', () => {
  it('shows the "Datos de demostración" badge once the guard grants access', async () => {
    render(
      <ThemeProvider>
        <SessionProvider bootstrap={async () => ({ activeOrgId: 'org-1' })}>
          <MemoryRouter initialEntries={['/w/org-1/admin']}>
            <Routes>
              <Route path="/w/:wsId/admin" element={<AdminLayout role="workspace" />}>
                <Route index element={<div>WS VIEW</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </ThemeProvider>,
    );

    // Access is granted (wsId === activeOrgId), so the routed view AND the demo badge both render.
    expect(await screen.findByText('WS VIEW')).toBeTruthy();
    expect(screen.getByText('Datos de demostración')).toBeTruthy();
  });
});
