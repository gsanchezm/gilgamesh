import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Planes } from './Planes';

function renderPlanes() {
  return render(
    <AdminProvider role="platform" wsId="">
      <Planes />
    </AdminProvider>,
  );
}

describe('Planes — plans & live-margin pricing', () => {
  it('renders the three plan cards with their seeded gross margins', () => {
    renderPlanes();
    const margins = screen.getAllByTestId('margin-pct').map((el) => el.textContent);
    // Team (149-28)/149=81% · Business (499-142)/499=72% · Enterprise (2150-460)/2150=79%.
    expect(margins).toEqual(['81%', '72%', '79%']);
  });

  it('recomputes the Team margin live as the price is edited', () => {
    const { container } = renderPlanes();
    const teamCard = container.querySelector('[data-plan="team"]') as HTMLElement;
    const teamMargin = () => teamCard.querySelector('[data-testid="margin-pct"]')?.textContent;
    expect(teamMargin()).toBe('81%');

    // Drop the price to $30: margin (30-28)/30 = 6.67% → 7% (below 45% = red bar).
    const input = screen.getByLabelText('Precio del plan Team') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });

    expect(teamMargin()).toBe('7%');
    const bar = teamCard.querySelector('.gx-adm-meter__fill') as HTMLElement;
    expect(bar.style.background).toBe('rgb(224, 115, 138)'); // #E0738A red

    // Raise it high: margin climbs back into green.
    fireEvent.change(input, { target: { value: '400' } });
    expect(teamMargin()).toBe('93%');
  });

  it('only the edited plan margin changes (others stay put)', () => {
    renderPlanes();
    const input = screen.getByLabelText('Precio del plan Team') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '56' } }); // (56-28)/56 = 50%
    const margins = screen.getAllByTestId('margin-pct').map((el) => el.textContent);
    expect(margins).toEqual(['50%', '72%', '79%']);
  });
});
