import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Proyectos } from './Proyectos';

function Sentinel({ prefix }: { prefix: string }) {
  const { id } = useParams();
  return (
    <div>
      {prefix}:{id}
    </div>
  );
}

function renderProyectos() {
  return render(
    <MemoryRouter initialEntries={['/admin/proyectos']}>
      <AdminProvider role="platform" wsId="">
        <Routes>
          <Route path="/admin/proyectos" element={<Proyectos />} />
          <Route path="/admin/proyectos/:id" element={<Sentinel prefix="PROYECTO" />} />
        </Routes>
      </AdminProvider>
    </MemoryRouter>,
  );
}

describe('admin · platform Proyectos', () => {
  it('renders the cross-tenant table with deity agent pills and formato chips', () => {
    renderProyectos();
    expect(screen.getByText('Checkout Web')).toBeTruthy();
    // Agent ids map to deity names (web → Quetzalcóatl, visual → Xochiquetzal).
    expect(screen.getAllByText('Quetzalcóatl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Xochiquetzal').length).toBeGreaterThan(0);
    // Formato chips (BDD / Casos) resolve from common.*.
    expect(screen.getAllByText('BDD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Casos').length).toBeGreaterThan(0);
    // Cost is platform-visible.
    expect(screen.getByText('$190')).toBeTruthy();
  });

  it('drills into the project detail on row click', () => {
    renderProyectos();
    fireEvent.click(screen.getByText('Checkout Web'));
    expect(screen.getByText('PROYECTO:p-omni-checkout')).toBeTruthy();
  });
});
