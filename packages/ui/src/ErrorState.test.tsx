import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('is an alert carrying the title and message', () => {
    render(<ErrorState title="Could not load" message="The server is unreachable." />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load');
    expect(alert.textContent).toContain('The server is unreachable.');
  });

  it('falls back to a generic default title', () => {
    render(<ErrorState message="Boom." />);
    expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i);
  });

  it('renders no retry button when onRetry is absent', () => {
    render(<ErrorState message="Boom." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a retry action that fires onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Boom." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('lets the retry label be overridden', () => {
    render(<ErrorState message="Boom." onRetry={() => {}} retryLabel="Reload" />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
