import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Uso } from './Uso';

function renderUso() {
  return render(
    <AdminProvider role="platform" wsId="">
      <Uso />
    </AdminProvider>,
  );
}

describe('Uso — agent & runner usage', () => {
  it('renders the KPI figures and the runner-minute targets', () => {
    renderUso();
    expect(screen.getByText('72,500')).toBeTruthy();
    expect(screen.getByText('56.8%')).toBeTruthy(); // Chromium share
    expect(screen.getByText('41,200 min')).toBeTruthy();
  });

  it('lists the top token agent and the corpus totals', () => {
    renderUso();
    expect(screen.getByText('Quetzalcóatl')).toBeTruthy();
    expect(screen.getByText('142M')).toBeTruthy();
    expect(screen.getByText('486M')).toBeTruthy(); // total
  });

  it('shows the external Safari·iOS target as a capability note (dotted bar)', () => {
    const { container } = renderUso();
    const external = container.querySelector('[data-ext="true"]');
    expect(external).toBeTruthy();
    expect(external?.textContent).toContain('capability externa');
    expect(container.querySelector('.gx-adm-uso-dotted')).toBeTruthy();
  });
});
