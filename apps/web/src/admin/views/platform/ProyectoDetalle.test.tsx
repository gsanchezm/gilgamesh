import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { ProyectoDetalle } from './ProyectoDetalle';

function Sentinel({ prefix }: { prefix: string }) {
  const { id } = useParams();
  return (
    <div>
      {prefix}:{id}
    </div>
  );
}

function renderPD(initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AdminProvider role="platform" wsId="">
        <Routes>
          <Route path="/admin/proyectos" element={<div>PROYECTOS LIST</div>} />
          <Route path="/admin/proyectos/:id" element={<ProyectoDetalle />} />
          <Route path="/admin/clientes/:id" element={<Sentinel prefix="CLIENTE" />} />
        </Routes>
      </AdminProvider>
    </MemoryRouter>,
  );
}

describe('admin · platform ProyectoDetalle', () => {
  it('renders the header, the runs table and the Ver sesión action', () => {
    renderPD(['/admin/proyectos/p-omni-checkout']);
    expect(screen.getByText('Checkout Web')).toBeTruthy();
    expect(screen.getByText('RUN-4821')).toBeTruthy();
    expect(screen.getAllByText('Ver sesión →').length).toBeGreaterThan(0);
    // Assigned-agent chips render deity names.
    expect(screen.getAllByText('Quetzalcóatl').length).toBeGreaterThan(0);
  });

  it('backs to Proyectos when there is no cliente origin', () => {
    renderPD(['/admin/proyectos/p-omni-checkout']);
    fireEvent.click(screen.getByRole('button', { name: '← Proyectos' }));
    expect(screen.getByText('PROYECTOS LIST')).toBeTruthy();
  });

  it('backs to the client detail when opened from a client (router-state origin)', () => {
    renderPD([{ pathname: '/admin/proyectos/p-omni-checkout', state: { from: 'cliente', clienteId: 'omnipizza' } }]);
    // The back label adopts the client name.
    fireEvent.click(screen.getByRole('button', { name: '← OmniPizza Inc' }));
    expect(screen.getByText('CLIENTE:omnipizza')).toBeTruthy();
  });

  it('shows a not-found fallback for an unknown project id', () => {
    renderPD(['/admin/proyectos/nope']);
    expect(screen.getByText('Proyecto no encontrado.')).toBeTruthy();
  });
});
