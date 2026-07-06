import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from '../lib/auth-client';
import { RegisterScreen } from './RegisterScreen';

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

const GOOD_PASSWORD = 'correct horse battery'; // ≥ 12 chars, matches the API @MinLength(12)

function fillForm(over?: Partial<Record<string, string>>) {
  const values: Record<string, string> = {
    'First name': 'Gabriel',
    'Middle name': 'de Jesús',
    'Last name': 'Sánchez',
    Company: 'Acme Inc.',
    'Corporate email': 'gabriel@acme.com',
    Password: GOOD_PASSWORD,
    'Confirm password': GOOD_PASSWORD,
    ...over,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('RegisterScreen', () => {
  it('registers, then reports the company for onboarding', async () => {
    const onSuccess = vi.fn();
    const client = fakeClient();
    render(<RegisterScreen authClient={client} onSuccess={onSuccess} />);

    fillForm();
    submit();

    await waitFor(() =>
      expect(client.register).toHaveBeenCalledWith({
        firstName: 'Gabriel',
        middleName: 'de Jesús',
        lastName: 'Sánchez',
        email: 'gabriel@acme.com',
        password: GOOD_PASSWORD,
      }),
    );
    expect(onSuccess).toHaveBeenCalledWith('Acme Inc.');
  });

  it('omits the optional middle name when left blank', async () => {
    const client = fakeClient();
    render(<RegisterScreen authClient={client} onSuccess={vi.fn()} />);

    fillForm({ 'Middle name': '' });
    submit();

    await waitFor(() => expect(client.register).toHaveBeenCalledTimes(1));
    expect((client.register as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      middleName: undefined,
    });
  });

  it('rejects a password shorter than 12 characters without calling the client', async () => {
    const client = fakeClient();
    render(<RegisterScreen authClient={client} onSuccess={vi.fn()} />);

    fillForm({ Password: 'short', 'Confirm password': 'short' });
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/12/);
    expect(client.register).not.toHaveBeenCalled();
  });

  it('rejects when the passwords do not match', async () => {
    const client = fakeClient();
    render(<RegisterScreen authClient={client} onSuccess={vi.fn()} />);

    fillForm({ 'Confirm password': 'a different one 123' });
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/match/i);
    expect(client.register).not.toHaveBeenCalled();
  });

  it('requires the company (an org needs a name)', async () => {
    const client = fakeClient();
    render(<RegisterScreen authClient={client} onSuccess={vi.fn()} />);

    fillForm({ Company: '' });
    submit();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(client.register).not.toHaveBeenCalled();
  });

  it('rejects an invalid email without calling the client', async () => {
    const client = fakeClient();
    render(<RegisterScreen authClient={client} onSuccess={vi.fn()} />);

    fillForm({ 'Corporate email': 'not-an-email' });
    submit();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(client.register).not.toHaveBeenCalled();
  });

  it('surfaces a server error (e.g. duplicate email)', async () => {
    const client = fakeClient({
      register: vi.fn(async () => {
        throw new Error('An account with this email already exists.');
      }),
    });
    render(<RegisterScreen authClient={client} onSuccess={vi.fn()} />);

    fillForm();
    submit();

    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });

  it('wires the Sign in and View plans links', () => {
    const onSignIn = vi.fn();
    const onViewPlans = vi.fn();
    render(
      <RegisterScreen
        authClient={fakeClient()}
        onSuccess={vi.fn()}
        onSignIn={onSignIn}
        onViewPlans={onViewPlans}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(screen.getByRole('button', { name: /View plans/ }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onViewPlans).toHaveBeenCalledTimes(1);
  });
});
