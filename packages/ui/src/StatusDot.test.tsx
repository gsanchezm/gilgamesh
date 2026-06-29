import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('labels each status for assistive tech', () => {
    const { rerender } = render(<StatusDot status="ACTIVE" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Active');
    rerender(<StatusDot status="BUSY" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Busy');
    rerender(<StatusDot status="IDLE" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Idle');
  });

  it('exposes the status as a data attribute', () => {
    render(<StatusDot status="ACTIVE" />);
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('ACTIVE');
  });
});
