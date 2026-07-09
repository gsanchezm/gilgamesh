import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Clientes } from './Clientes';

function Sentinel({ prefix }: { prefix: string }) {
  const { id } = useParams();
  return (
    <div>
      {prefix}:{id}
    </div>
  );
}

function renderClientes() {
  return render(
    <MemoryRouter initialEntries={['/admin/clientes']}>
      <AdminProvider role="platform" wsId="">
        <Routes>
          <Route path="/admin/clientes" element={<Clientes />} />
          <Route path="/admin/clientes/:id" element={<Sentinel prefix="CLIENTE" />} />
        </Routes>
      </AdminProvider>
    </MemoryRouter>,
  );
}

describe('admin · platform Clientes', () => {
  it('renders the workspace table with plan, seats and MRR from the service', () => {
    renderClientes();
    expect(screen.getByText('OmniPizza Inc')).toBeTruthy();
    expect(screen.getByText('Vector Bank')).toBeTruthy();
    // MRR + seats render from the mock (language-neutral values).
    expect(screen.getByText('$2,400')).toBeTruthy();
    expect(screen.getByText('14 / 20')).toBeTruthy();
    // Plan chips resolve through the shared common.* dict.
    expect(screen.getAllByText('Business').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enterprise').length).toBeGreaterThan(0);
  });

  it('flags cycle usage over 85% and shows every account status', () => {
    renderClientes();
    // Helios Energy is at 91% (amber threshold) and estado "Riesgo".
    expect(screen.getByText('91%')).toBeTruthy();
    expect(screen.getByText('Riesgo')).toBeTruthy();
    expect(screen.getByText('Moroso')).toBeTruthy();
  });

  it('drills into the client detail on row click (sets selection + navigates)', () => {
    renderClientes();
    fireEvent.click(screen.getByText('OmniPizza Inc'));
    expect(screen.getByText('CLIENTE:omnipizza')).toBeTruthy();
  });
});
