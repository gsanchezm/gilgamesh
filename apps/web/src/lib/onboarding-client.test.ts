import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpOnboardingClient } from './onboarding-client';

type FetchInit = {
  method?: string;
  credentials?: string;
  headers: Record<string, string>;
  body: string;
};

describe('httpOnboardingClient', () => {
  beforeEach(() => {
    document.cookie = 'csrf=tok-123';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ projectId: 'p1', slug: 'omnipizza' }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('sends the CSRF token, credentials and JSON body on createProject', async () => {
    const result = await httpOnboardingClient.createProject({
      orgName: 'Acme Inc.',
      projectName: 'OmniPizza',
      format: 'BDD',
    });
    expect(result).toEqual({ projectId: 'p1', slug: 'omnipizza' });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, FetchInit];
    expect(String(url)).toMatch(/\/projects$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-CSRF-Token']).toBe('tok-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      orgName: 'Acme Inc.',
      projectName: 'OmniPizza',
      format: 'BDD',
    });
  });
});
