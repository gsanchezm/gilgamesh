import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PricingScreen } from './PricingScreen';

describe('PricingScreen', () => {
  it('renders the four tiers and the pricing hero', () => {
    render(<PricingScreen onStart={vi.fn()} onSignIn={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /Summon the pantheon/i })).toBeTruthy();
    for (const name of ['Free', 'Starter', 'Growth', 'Scale']) {
      expect(screen.getByRole('heading', { name, level: 3 })).toBeTruthy();
    }
  });

  it('shows monthly prices by default', () => {
    render(<PricingScreen onStart={vi.fn()} onSignIn={vi.fn()} />);
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.getByText('$29')).toBeTruthy();
    expect(screen.getByText('$99')).toBeTruthy();
    expect(screen.getByText('$499')).toBeTruthy();
  });

  it('switches to the annual per-month-equivalent prices', () => {
    render(<PricingScreen onStart={vi.fn()} onSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'ANNUAL' }));

    expect(screen.getByText('$24')).toBeTruthy(); // Starter $29 → $24/mo billed annually
    expect(screen.getByText('$416')).toBeTruthy(); // Scale $499 → $416
    expect(screen.getAllByText(/billed annually/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('$29')).toBeNull();
  });

  it('marks Growth as the most popular tier', () => {
    render(<PricingScreen onStart={vi.fn()} onSignIn={vi.fn()} />);
    expect(screen.getByText(/most popular/i)).toBeTruthy();
  });

  it('shows the Scale per-extra-workspace add-on', () => {
    render(<PricingScreen onStart={vi.fn()} onSignIn={vi.fn()} />);
    expect(screen.getByText(/\$99 \/ extra workspace/i)).toBeTruthy();
  });

  it('starts the signup flow from a plan CTA and links to sign in', () => {
    const onStart = vi.fn();
    const onSignIn = vi.fn();
    render(<PricingScreen onStart={onStart} onSignIn={onSignIn} />);

    fireEvent.click(screen.getByRole('button', { name: 'Get started' })); // Free CTA (unique)
    expect(onStart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
