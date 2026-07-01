import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';
import type { AuthClient } from '../lib/auth-client';

function fakeClient(overrides?: Partial<AuthClient>): AuthClient {
  return {
    login: vi.fn(async () => ({ activeOrgId: 'org-1' })),
    me: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } });
}

describe('LoginScreen', () => {
  it('shows a validation error and does not call the client for invalid input', async () => {
    const client = fakeClient();
    render(<LoginScreen authClient={client} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect((await screen.findByRole('alert')).textContent).toContain('valid email');
    expect(client.login).not.toHaveBeenCalled();
  });

  it('calls the client and onSuccess with valid credentials', async () => {
    const onSuccess = vi.fn();
    const client = fakeClient();
    render(<LoginScreen authClient={client} onSuccess={onSuccess} />);

    fillCredentials('gil@example.com', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ activeOrgId: 'org-1' }));
    expect(client.login).toHaveBeenCalledWith({
      email: 'gil@example.com',
      password: 'correct horse battery',
    });
  });

  it('surfaces an auth error from the client', async () => {
    const client = fakeClient({
      login: vi.fn(async () => {
        throw new Error('Invalid email or password.');
      }),
    });
    render(<LoginScreen authClient={client} onSuccess={vi.fn()} />);

    fillCredentials('gil@example.com', 'wrong-password');
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email');
  });

  it('toggles password visibility', () => {
    render(<LoginScreen authClient={fakeClient()} onSuccess={vi.fn()} />);
    const pwd = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    expect(pwd.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(pwd.type).toBe('text');
  });
});
