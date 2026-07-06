import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResetPasswordScreen } from './ResetPasswordScreen';
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

function fillPasswords(value: string, confirm = value) {
  const inputs = screen.getAllByPlaceholderText('••••••••');
  fireEvent.change(inputs[0]!, { target: { value } });
  fireEvent.change(inputs[1]!, { target: { value: confirm } });
}

describe('ResetPasswordScreen', () => {
  it('shows the invalid-link state (with a request-new path) when the token is missing', () => {
    const onRequestNew = vi.fn();
    render(<ResetPasswordScreen authClient={fakeClient()} token={null} onRequestNew={onRequestNew} />);

    expect(screen.getByRole('alert').textContent).toContain('invalid or has expired');
    fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
    expect(onRequestNew).toHaveBeenCalledTimes(1);
  });

  it('rejects a short password client-side without calling the client', async () => {
    const client = fakeClient();
    render(<ResetPasswordScreen authClient={client} token="tok-1" />);

    fillPasswords('short');
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('at least 12 characters');
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords client-side', async () => {
    const client = fakeClient();
    render(<ResetPasswordScreen authClient={client} token="tok-1" />);

    fillPasswords('N3w-Passphrase!!', 'Different-Pass!!');
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it('submits the token + new password and offers the way back to sign in', async () => {
    const client = fakeClient();
    const onSignIn = vi.fn();
    render(<ResetPasswordScreen authClient={client} token="tok-1" onSignIn={onSignIn} />);

    fillPasswords('N3w-Passphrase!!');
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Your password has been reset');
    expect(client.resetPassword).toHaveBeenCalledWith({ token: 'tok-1', newPassword: 'N3w-Passphrase!!' });

    fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('surfaces the 422 detail for an invalid/expired token with the request-new path', async () => {
    const onRequestNew = vi.fn();
    const client = fakeClient({
      resetPassword: vi.fn(async () => {
        throw new Error('That reset link is invalid or has expired.');
      }),
    });
    render(<ResetPasswordScreen authClient={client} token="stale-token" onRequestNew={onRequestNew} />);

    fillPasswords('N3w-Passphrase!!');
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('invalid or has expired');
    fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
    expect(onRequestNew).toHaveBeenCalledTimes(1);
  });

  it('toggles visibility for both password fields together', () => {
    render(<ResetPasswordScreen authClient={fakeClient()} token="tok-1" />);
    const [pwd, confirm] = screen.getAllByPlaceholderText('••••••••') as HTMLInputElement[];
    expect(pwd!.type).toBe('password');
    expect(confirm!.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(pwd!.type).toBe('text');
    expect(confirm!.type).toBe('text');
  });
});
