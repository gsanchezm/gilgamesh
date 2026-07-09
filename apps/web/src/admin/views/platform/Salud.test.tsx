import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Salud } from './Salud';

function renderSalud() {
  return render(
    <AdminProvider role="platform" wsId="">
      <Salud />
    </AdminProvider>,
  );
}

describe('Salud — system health', () => {
  it('renders the KPIs with a tone-coloured uptime value', () => {
    renderSalud();
    const uptime = screen.getByText('99.96%');
    expect(uptime).toBeTruthy();
    expect((uptime as HTMLElement).style.color).toBe('rgb(63, 176, 122)'); // #3FB07A green
    expect(screen.getByText('TOM v2.4.1')).toBeTruthy();
  });

  it('renders the runner pools including the attenuated external row', () => {
    const { container } = renderSalud();
    expect(screen.getByText('Chromium')).toBeTruthy();
    expect(screen.getByText(/6 \/ 8/)).toBeTruthy();
    expect(container.querySelector('[data-ext="true"]')).toBeTruthy();
  });

  it('renders a 30-cell uptime strip with exactly 2 degraded days', () => {
    const { container } = renderSalud();
    const cells = container.querySelectorAll('.gx-adm-salud-cell');
    expect(cells.length).toBe(30);
    const degraded = container.querySelectorAll('.gx-adm-salud-cell[data-state="degradado"]');
    expect(degraded.length).toBe(2);
  });

  it('lists incidents with the monitoring one first', () => {
    renderSalud();
    expect(screen.getByText('INC-214')).toBeTruthy();
    expect(screen.getByText('Cola del emulador Android degradada')).toBeTruthy();
    expect(screen.getByText('Monitoreando')).toBeTruthy();
  });
});
