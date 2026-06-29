import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentTile, type AgentTileProps } from './AgentTile';

const base: AgentTileProps = {
  deityName: 'Zeus',
  role: 'QA Lead',
  glyph: 'ZE',
  familyColor: '#A07D2C',
  tool: 'Helix Core',
  status: 'ACTIVE',
  enabled: true,
};

describe('AgentTile', () => {
  it('renders the deity, role and tool', () => {
    render(<AgentTile {...base} />);
    expect(screen.getByText('Zeus')).toBeTruthy();
    expect(screen.getByText('QA Lead')).toBeTruthy();
    expect(screen.getByText('Helix Core')).toBeTruthy();
  });

  it('reflects the enabled state on the toggle switch', () => {
    const { rerender } = render(<AgentTile {...base} enabled />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    rerender(<AgentTile {...base} enabled={false} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });

  it('calls onToggle and onOpen', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(<AgentTile {...base} onToggle={onToggle} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Open Zeus'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('dims when not enabled', () => {
    render(<AgentTile {...base} enabled={false} />);
    const tile = screen.getByText('Zeus').closest('.gx-agent-tile') as HTMLElement;
    expect(tile.getAttribute('data-enabled')).toBe('false');
  });
});
