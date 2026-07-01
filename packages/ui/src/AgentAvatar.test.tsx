import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentAvatar } from './AgentAvatar';

describe('AgentAvatar', () => {
  it('shows the glyph fallback when no portrait is provided', () => {
    render(<AgentAvatar glyph="ZE" familyColor="#A07D2C" status="ACTIVE" />);
    expect(screen.getByText('ZE')).toBeTruthy();
  });

  it('renders the portrait image and drops the glyph when portraitSrc is given', () => {
    const { container } = render(
      <AgentAvatar glyph="ZE" familyColor="#A07D2C" status="IDLE" portraitSrc="/assets/agents/god-lead.png" />,
    );
    expect(screen.queryByText('ZE')).toBeNull();
    const portrait = container.querySelector('.gx-avatar__portrait') as HTMLElement;
    expect(portrait.style.backgroundImage).toContain('god-lead.png');
  });

  it('paints the frame with the family color', () => {
    const { container } = render(<AgentAvatar glyph="QC" familyColor="#3F6FA3" status="ACTIVE" />);
    const frame = container.querySelector('.gx-avatar') as HTMLElement;
    // jsdom normalizes the hex to rgb(); #3F6FA3 → rgb(63, 111, 163).
    expect(frame.style.background).toBe('rgb(63, 111, 163)');
  });

  it('renders the status dot (active → pulsing) with an accessible label', () => {
    render(<AgentAvatar glyph="ZE" familyColor="#A07D2C" status="ACTIVE" deityName="Zeus" />);
    expect(screen.getByRole('status', { name: 'Active' })).toBeTruthy();
  });

  it('maps size presets to the handoff dimensions', () => {
    const { container } = render(<AgentAvatar glyph="ZE" familyColor="#A07D2C" status="IDLE" size="nav" />);
    const frame = container.querySelector('.gx-avatar') as HTMLElement;
    expect(frame.style.width).toBe('26px');
    expect(frame.style.height).toBe('28px');
  });
});
