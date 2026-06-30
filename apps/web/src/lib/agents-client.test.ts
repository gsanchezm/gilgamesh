import type { AgentSlot } from '@gilgamesh/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpAgentsClient } from './agents-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

describe('httpAgentsClient', () => {
  beforeEach(() => {
    document.cookie = 'csrf=tok-9';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  const lastInit = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as FetchInit;

  it('sends the CSRF token + credentials on setAgent (PATCH)', async () => {
    await httpAgentsClient.setAgent('p1', 'web' as AgentSlot, { enabled: false });
    expect(lastInit().method).toBe('PATCH');
    expect(lastInit().credentials).toBe('include');
    expect(lastInit().headers?.['X-CSRF-Token']).toBe('tok-9');
  });

  it('sends the CSRF token + credentials on wakeAll (POST)', async () => {
    await httpAgentsClient.wakeAll('p1');
    expect(lastInit().method).toBe('POST');
    expect(lastInit().credentials).toBe('include');
    expect(lastInit().headers?.['X-CSRF-Token']).toBe('tok-9');
  });
});
