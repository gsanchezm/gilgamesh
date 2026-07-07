import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and hint', () => {
    render(<EmptyState title="No documents yet" hint="Upload a file to get started." />);
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.getByText('Upload a file to get started.')).toBeTruthy();
  });

  it('is static content — not an alert or status live region', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders no CTA when action is absent', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a CTA that fires the action', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing here" action={{ label: 'Add one', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
