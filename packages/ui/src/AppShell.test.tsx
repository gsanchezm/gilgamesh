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
});
