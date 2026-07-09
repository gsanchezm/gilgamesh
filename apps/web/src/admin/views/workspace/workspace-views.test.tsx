import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Ajustes } from './Ajustes';
import { Facturacion } from './Facturacion';
import { Proyectos } from './Proyectos';
import { Resumen } from './Resumen';
import { Uso } from './Uso';
import { Usuarios } from './Usuarios';

// Renders a workspace-role view inside the real AdminProvider (mock service) + a router. Admin i18n
// defaults to Spanish in jsdom (localStorage empty), so assertions use language-neutral DATA
// (numbers, names, deities) — never English button copy.
function renderWs(node: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/w/omnipizza/admin']}>
      <AdminProvider role="workspace" wsId="omnipizza">
        {node}
      </AdminProvider>
    </MemoryRouter>,
  );
}

describe('workspace views — cost-visibility rule (README §1/§5)', () => {
  it('Proyectos shows NO internal cost: no "$" amount and no cost/margin/client column', () => {
    const { container } = renderWs(<Proyectos />);
    // Project data renders…
    expect(screen.getByText('Checkout Web')).toBeTruthy();
    // …but never a dollar amount or a cost/margin/client-cost header.
    const text = container.textContent ?? '';
    expect(text).not.toContain('$');
    expect(text.toLowerCase()).not.toContain('costo');
    expect(text.toLowerCase()).not.toContain('margen');
    expect(text.toLowerCase()).not.toContain('cliente');
  });

  it('Uso shows workspace totals + tokens but NO token cost ("$")', () => {
    const { container } = renderWs(<Uso />);
    expect(screen.getByText('10,450')).toBeTruthy(); // minutes total
    expect(screen.getByText('Quetzalcóatl')).toBeTruthy(); // an agent row
    expect(screen.getByText('8.2M')).toBeTruthy(); // tokens (millions), no cost beside it
    const text = container.textContent ?? '';
    expect(text).not.toContain('$');
    expect(text.toLowerCase()).not.toContain('costo');
  });
});

describe('workspace views — render + interactions', () => {
  it('Resumen shows the workspace name, success rate and a next-charge card', () => {
    renderWs(<Resumen />);
    expect(screen.getByRole('heading', { name: 'OmniPizza Inc' })).toBeTruthy();
    expect(screen.getByText('93.1%')).toBeTruthy();
    // The workspace's OWN next charge ($499) is legitimate billing, not an internal cost.
    expect(screen.getByText(/\$499/)).toBeTruthy();
  });

  it('Facturación shows the workspace OWN plan price and an invoice folio (allowed billing)', () => {
    renderWs(<Facturacion />);
    expect(screen.getAllByText(/\$499/).length).toBeGreaterThan(0);
    expect(screen.getByText('INV-2026-07-004')).toBeTruthy();
  });

  it('Usuarios lists the team and the invite control does not throw', () => {
    renderWs(<Usuarios />);
    expect(screen.getByText('Sofía Ramírez')).toBeTruthy();
    const invite = screen.getByRole('button', { name: /Invitar usuario/ });
    expect(() => fireEvent.click(invite)).not.toThrow();
  });

  it('Ajustes seeds the form, toggles a switch, selects retention, and saves without throwing', async () => {
    renderWs(<Ajustes />);
    // Seeded from the service (effect runs after mount).
    await waitFor(() => expect(screen.getByDisplayValue('OmniPizza Inc')).toBeTruthy());
    expect(screen.getByDisplayValue('omnipizza.com')).toBeTruthy();

    // Weekly report starts OFF; toggling flips aria-checked.
    const weekly = screen.getByRole('switch', { name: 'Reporte semanal' });
    expect(weekly.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(weekly);
    expect(weekly.getAttribute('aria-checked')).toBe('true');

    // Retention chip selection updates the active state.
    const chip90 = screen.getByRole('button', { name: /90 días/ });
    fireEvent.click(chip90);
    expect(chip90.getAttribute('data-active')).toBe('true');

    // Save is a mock toast — must not throw.
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Guardar ajustes' }))).not.toThrow();
  });
});
