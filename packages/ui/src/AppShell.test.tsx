import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell, type AppShellProps } from './AppShell';
import { IconAgentRoom, IconReports } from './icons';

function makeProps(over: Partial<AppShellProps> = {}): AppShellProps {
  return {
    items: [
      { key: 'dashboard', label: 'Agent room', icon: <IconAgentRoom /> },
      { key: 'reports', label: 'Reports', icon: <IconReports /> },
    ],
    activeKey: 'dashboard',
    onNavigate: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onLogout: vi.fn(),
    project: { name: 'OmniPizza', branch: 'main', repo: 'a1b2c3d' },
    user: { initials: 'GS' },
    theme: 'dark',
    onToggleTheme: vi.fn(),
    children: <p>view content</p>,
    ...over,
  };
}

describe('AppShell', () => {
  it('renders nav items, the active row, project, user and content', () => {
    render(<AppShell {...makeProps()} />);
    expect(screen.getByText('Agent room')).toBeTruthy();
    expect(screen.getByText('OmniPizza')).toBeTruthy();
    expect(screen.getByText('GS')).toBeTruthy();
    expect(screen.getByText('view content')).toBeTruthy();
    const active = screen.getByText('Agent room').closest('.gx-sidebar__item') as HTMLElement;
    expect(active.getAttribute('data-active')).toBe('true');
  });

  it('navigates on nav click', () => {
    const onNavigate = vi.fn();
    render(<AppShell {...makeProps({ onNavigate })} />);
    fireEvent.click(screen.getByText('Reports'));
    expect(onNavigate).toHaveBeenCalledWith('reports');
  });

  it('toggles theme from the top bar and logs out from the sidebar', () => {
    const onToggleTheme = vi.fn();
    const onLogout = vi.fn();
    render(<AppShell {...makeProps({ onToggleTheme, onLogout })} />);
    fireEvent.click(screen.getByLabelText('Switch to light theme'));
    expect(onToggleTheme).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Log out'));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('hides labels and the agents rail when collapsed', () => {
    render(
      <AppShell
        {...makeProps({
          collapsed: true,
          agents: [
            { slot: 'lead', deityName: 'Zeus', glyph: 'ZE', familyColor: '#A07D2C', tool: 'Helix Core', status: 'ACTIVE' },
          ],
        })}
      />,
    );
    // Collapsed: nav labels and the agents rail are not rendered.
    expect(screen.queryByText('Agent room')).toBeNull();
    expect(screen.queryByText('Zeus')).toBeNull();
  });

  describe('mobile off-canvas nav', () => {
    // A tiny stateful host wiring the mobile-nav callbacks to state, so a hamburger click actually
    // flips the shell's `data-mobileopen` (the CSS slide-in keys off exactly that attribute).
    function Controlled(props: Partial<AppShellProps> = {}) {
      const [open, setOpen] = useState(false);
      return (
        <AppShell
          {...makeProps(props)}
          mobileNavOpen={open}
          onToggleMobileNav={() => setOpen((o) => !o)}
          onCloseMobileNav={() => setOpen(false)}
        />
      );
    }

    it('the hamburger toggles the shell `data-mobileopen` and renders the backdrop', () => {
      const { container } = render(<Controlled />);
      const shell = container.querySelector('.gx-shell') as HTMLElement;
      expect(shell.getAttribute('data-mobileopen')).toBe('false');
      expect(screen.queryByLabelText('Close navigation')).toBeNull();

      const burger = screen.getByLabelText('Open navigation');
      expect(burger.getAttribute('aria-expanded')).toBe('false');
      expect(burger.getAttribute('aria-controls')).toBe('gx-sidebar');
      fireEvent.click(burger);

      expect(shell.getAttribute('data-mobileopen')).toBe('true');
      expect(burger.getAttribute('aria-expanded')).toBe('true');
      // The drawer id the hamburger controls actually exists.
      expect(container.querySelector('#gx-sidebar')).not.toBeNull();
      // The backdrop appears only while open.
      expect(screen.getByLabelText('Close navigation')).toBeTruthy();
    });

    it('clicking the backdrop closes the drawer', () => {
      const { container } = render(<Controlled />);
      const shell = container.querySelector('.gx-shell') as HTMLElement;
      fireEvent.click(screen.getByLabelText('Open navigation'));
      expect(shell.getAttribute('data-mobileopen')).toBe('true');

      fireEvent.click(screen.getByLabelText('Close navigation'));
      expect(shell.getAttribute('data-mobileopen')).toBe('false');
      expect(screen.queryByLabelText('Close navigation')).toBeNull();
    });

    it('Escape closes the drawer', () => {
      const { container } = render(<Controlled />);
      const shell = container.querySelector('.gx-shell') as HTMLElement;
      fireEvent.click(screen.getByLabelText('Open navigation'));
      expect(shell.getAttribute('data-mobileopen')).toBe('true');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(shell.getAttribute('data-mobileopen')).toBe('false');
    });

    it('desktop-only usage (no mobile props) renders no hamburger or backdrop and stays closed', () => {
      const { container } = render(<AppShell {...makeProps()} />);
      const shell = container.querySelector('.gx-shell') as HTMLElement;
      // The additive channel is inert: attribute present but false, no controls in the a11y tree.
      expect(shell.getAttribute('data-mobileopen')).toBe('false');
      expect(screen.queryByLabelText('Open navigation')).toBeNull();
      expect(screen.queryByLabelText('Close navigation')).toBeNull();
    });
  });
});
