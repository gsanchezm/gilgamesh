import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingWizard } from './OnboardingWizard';
import type { OnboardingClient } from '../lib/onboarding-client';

function fakeClient(overrides?: Partial<OnboardingClient>): OnboardingClient {
  return {
    createProject: vi.fn(async () => ({ projectId: 'p-1', slug: 'omnipizza' })),
    ...overrides,
  };
}

function renderWizard(client = fakeClient(), onComplete = vi.fn(), state?: { company?: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/onboarding', state }]}>
      <OnboardingWizard client={client} onComplete={onComplete} />
    </MemoryRouter>,
  );
}

describe('OnboardingWizard', () => {
  it('keeps Continue disabled until a project name is entered', () => {
    renderWizard();
    const cont = screen.getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('OmniPizza'), {
      target: { value: 'OmniPizza' },
    });
    expect(cont.disabled).toBe(false);
  });

  it('walks through the 3 steps and creates the project', async () => {
    const onComplete = vi.fn();
    const client = fakeClient();
    renderWizard(client, onComplete, { company: 'Acme Inc.' });

    fireEvent.change(screen.getByPlaceholderText('OmniPizza'), {
      target: { value: 'OmniPizza' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.click(screen.getByRole('button', { name: 'Traditional' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        projectId: 'p-1',
        slug: 'omnipizza',
      }),
    );
    expect(client.createProject).toHaveBeenCalledWith({
      orgName: 'Acme Inc.',
      projectName: 'OmniPizza',
      format: 'TRADITIONAL',
      repoProvider: 'github',
    });
  });

  it('falls back to the project name as orgName when no company is carried', async () => {
    const client = fakeClient();
    renderWizard(client);

    fireEvent.change(screen.getByPlaceholderText('OmniPizza'), {
      target: { value: 'OmniPizza' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(client.createProject).toHaveBeenCalledWith({
        orgName: 'OmniPizza',
        projectName: 'OmniPizza',
        format: 'BDD',
        repoProvider: undefined,
      }),
    );
  });

  it('can go back a step', () => {
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText('OmniPizza'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Choose a test format')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Name your project')).toBeTruthy();
  });
});
