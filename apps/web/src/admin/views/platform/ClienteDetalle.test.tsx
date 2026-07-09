import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { ClienteDetalle } from './ClienteDetalle';

function Sentinel({ prefix }: { prefix: string }) {
  const { id } = useParams();
  return (
    <div>
      {prefix}:{id}
    </div>
  );
}

function renderDetalle(initialEntries: string[] = ['/admin/clientes/omnipizza']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AdminProvider role="platform" wsId="">
        <Routes>
          <Route path="/admin/clientes" element={<div>CLIENTES LIST</div>} />
          <Route path="/admin/clientes/:id" element={<ClienteDetalle />} />
          <Route path="/admin/proyectos/:id" element={<Sentinel prefix="PROYECTO" />} />
        </Routes>
      </AdminProvider>
    </MemoryRouter>,
  );
}

describe('admin · platform ClienteDetalle', () => {
  it('renders the hero and the platform-only client-margin KPI', () => {
    renderDetalle();
    expect(screen.getByText('OmniPizza Inc')).toBeTruthy();
    // Margin (platform-only) is computed by the service: (499 − 145) / 499 = 70.9%.
    expect(screen.getByText('70.9%')).toBeTruthy();
    // Estimated cost 30d KPI.
    expect(screen.getByText('$145')).toBeTruthy();
  });

  it('toggles the estado chip + action label when Suspender/Reactivar is clicked', () => {
    renderDetalle();
    fireEvent.click(screen.getByRole('button', { name: 'Suspender workspace' }));
    expect(screen.getByRole('button', { name: 'Reactivar workspace' })).toBeTruthy();
    // The hero status chip now reads Suspendido.
    expect(screen.getByText('Suspendido')).toBeTruthy();
  });

  it('renders the recent-invoices and workspace-team panels (§4.4 content)', () => {
    renderDetalle();
    // An invoice row (folio + a paid status chip) and a team member (from EQUIPO_WS).
    expect(screen.getByText('INV-2026-07-004')).toBeTruthy();
    expect(screen.getByText('Sofía Ramírez')).toBeTruthy();
    // The 2FA chip maps through the shared twofa.* labels.
    expect(screen.getAllByText('Activa').length).toBeGreaterThan(0);
  });

  it('opens a project detail from the client projects table', () => {
    renderDetalle();
    fireEvent.click(screen.getByText('Checkout Web'));
    expect(screen.getByText('PROYECTO:p-omni-checkout')).toBeTruthy();
  });

  it('backs to the Clientes list', () => {
    renderDetalle();
    fireEvent.click(screen.getByRole('button', { name: '← Clientes' }));
    expect(screen.getByText('CLIENTES LIST')).toBeTruthy();
  });

  it('shows a not-found fallback for an unknown client id', () => {
    renderDetalle(['/admin/clientes/nope']);
    expect(screen.getByText('Cliente no encontrado.')).toBeTruthy();
  });
});
