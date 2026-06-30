import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentCard, type AgentCardProps } from './AgentCard';

const base: AgentCardProps = {
  slot: 'lead',
  deityName: 'Zeus',
  role: 'QA Lead',
  culture: 'Grecia',
  glyph: 'ZE',
  familyColor: '#A07D2C',
  tool: 'Helix Core',
  status: 'ACTIVE',
  enabled: true,
};

describe('AgentCard', () => {
  it('renders identity, tool tag and culture', () => {
    render(<AgentCard {...base} />);
    expect(screen.getByText('Zeus')).toBeTruthy();
    expect(screen.getByText('QA Lead')).toBeTruthy();
    expect(screen.getByText('Grecia')).toBeTruthy();
    expect(screen.getByText('HE')).toBeTruthy(); // "Helix Core" → "HE"
  });

  it('shows Open + Chat when awake', () => {
    const onOpen = vi.fn();
    const onChat = vi.fn();
    render(<AgentCard {...base} onOpen={onOpen} onChat={onChat} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Chat'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onChat).toHaveBeenCalledOnce();
    expect(screen.queryByText('Awaken')).toBeNull();
  });

  it('shows Awaken when asleep and dims the card', () => {
    const onWake = vi.fn();
    const { container } = render(<AgentCard {...base} enabled={false} status="IDLE" onWake={onWake} />);
    fireEvent.click(screen.getByText('Awaken'));
    expect(onWake).toHaveBeenCalledOnce();
    expect((container.querySelector('.gx-agentcard') as HTMLElement).getAttribute('data-enabled')).toBe('false');
  });

  it('toggles via the switch with an accessible label', () => {
    const onToggle = vi.fn();
    render(<AgentCard {...base} enabled={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Zeus' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
