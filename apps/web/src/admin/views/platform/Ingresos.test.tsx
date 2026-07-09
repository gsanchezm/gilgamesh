import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Ingresos } from './Ingresos';

function renderIngresos() {
  return render(
    <AdminProvider role="platform" wsId="">
      <Ingresos />
    </AdminProvider>,
  );
}

describe('Ingresos — revenue, margin, infra costs, invoices', () => {
  it('renders MRR-by-plan, the margin figure and infra total', () => {
    renderIngresos();
    expect(screen.getByRole('heading', { name: 'Ingresos' })).toBeTruthy();
    expect(screen.getByText('79.4%')).toBeTruthy(); // donut centre
    expect(screen.getAllByText('$6,942').length).toBeGreaterThan(0); // gross profit
    expect(screen.getByText('$6,450')).toBeTruthy(); // Enterprise MRR
  });

  it('resolves client names for invoices via the service', () => {
    renderIngresos();
    // INV-2026-07-001 belongs to Vector Bank.
    expect(screen.getByText('INV-2026-07-001')).toBeTruthy();
    expect(screen.getAllByText('Vector Bank').length).toBeGreaterThan(0);
  });

  it('filters invoices in-memory by status chip', () => {
    renderIngresos();
    // Baseline: a paid invoice is visible.
    expect(screen.queryByText('INV-2026-07-001')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Vencidas' }));
    // Only the overdue Kappa invoice survives; the paid one is gone.
    expect(screen.getByText('INV-2026-07-006')).toBeTruthy();
    expect(screen.queryByText('INV-2026-07-001')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pagadas' }));
    expect(screen.queryByText('INV-2026-07-006')).toBeNull();
    expect(screen.getByText('INV-2026-07-001')).toBeTruthy();
  });
});
