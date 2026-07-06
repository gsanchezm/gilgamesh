import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import type { AuthClient } from '../lib/auth-client';

function fakeClient(overrides?: Partial<AuthClient>): AuthClient {
  return {
    login: vi.fn(async () => ({ activeOrgId: 'org-1' })),
    register: vi.fn(async () => ({ userId: 'u-1' })),
    me: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    forgotPassword: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ForgotPasswordScreen', () => {
  it('rejects an invalid email client-side without calling the client', async () => {
    const client = fakeClient();
    render(<ForgotPasswordScreen authClient={client} />);

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('valid email');
    expect(client.forgotPassword).not.toHaveBeenCalled();
  });

  it('submits the email and swaps to the generic confirmation (never outcome-specific)', async () => {
    const client = fakeClient();
    render(<ForgotPasswordScreen authClient={client} />);

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'ishtar@uruk.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('If an account exists for that email, a reset link is on its way.');
    expect(client.forgotPassword).toHaveBeenCalledWith({ email: 'ishtar@uruk.io' });
    // The form is gone — no retry-probing UI on the confirmation.
    expect(screen.queryByPlaceholderText('name@company.com')).toBeNull();
  });

  it('surfaces a transport error (e.g. rate limited) as an alert', async () => {
    const client = fakeClient({
      forgotPassword: vi.fn(async () => {
        throw new Error('Too many requests. Please retry later.');
      }),
    });
    render(<ForgotPasswordScreen authClient={client} />);

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'ishtar@uruk.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Too many requests');
  });

  it('routes back to sign in from both states', async () => {
    const onSignIn = vi.fn();
    render(<ForgotPasswordScreen authClient={fakeClient()} onSignIn={onSignIn} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'ishtar@uruk.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => expect(onSignIn).toHaveBeenCalledTimes(2));
  });
});
