import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('is a status region named by its (visually-hidden) label', () => {
    render(<Spinner label="Loading billing" />);
    const status = screen.getByRole('status', { name: 'Loading billing' });
    expect(status).toBeTruthy();
  });

  it('defaults to a generic loading label', () => {
    render(<Spinner />);
    // The default label is announced (accessible name resolves via the hidden node).
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
  });

  it('hides the animated ring from assistive tech', () => {
    render(<Spinner label="Loading" />);
    const ring = screen.getByRole('status').querySelector('.gx-spinner__ring');
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
  });

  it('sizes the ring from the size preset', () => {
    render(<Spinner label="Loading" size="lg" />);
    const ring = screen.getByRole('status').querySelector<HTMLElement>('.gx-spinner__ring');
    expect(ring?.style.width).toBe('34px');
    expect(ring?.style.height).toBe('34px');
  });

  it('accepts an explicit numeric size', () => {
    render(<Spinner label="Loading" size={48} />);
    const ring = screen.getByRole('status').querySelector<HTMLElement>('.gx-spinner__ring');
    expect(ring?.style.width).toBe('48px');
  });
});
