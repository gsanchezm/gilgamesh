import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpChatClient, liveEventsUrl, messageFromEvent } from './chat-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

function mockFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => payload })),
  );
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('httpChatClient', () => {
  it('createSession POSTs with the CSRF token; a pin is carried in the body', async () => {
    document.cookie = 'csrf=tok-8';
    mockFetch({ id: 's1', projectId: 'p1', agentId: 'ag-1', createdAt: 'x' }, true, 201);
    await httpChatClient.createSession('p1', 'ag-1');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/chat$/);
    expect(init.method).toBe('POST');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-8');
    expect(JSON.parse(init.body!)).toEqual({ agentId: 'ag-1' });
  });

  it('createSession omits the pin when none is given', async () => {
    mockFetch({ id: 's1', projectId: 'p1', agentId: null, createdAt: 'x' }, true, 201);
    await httpChatClient.createSession('p1', null);
    const [, init] = lastCall();
    expect(JSON.parse(init.body!)).toEqual({});
  });

  it('sendMessage POSTs the content to the session', async () => {
    mockFetch({ id: 'm1', sessionId: 's1', role: 'USER', agentId: null, content: 'hi', runId: null, createdAt: 'x' }, true, 201);
    await httpChatClient.sendMessage('s1', 'hi');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/chat\/s1\/messages$/);
    expect(JSON.parse(init.body!)).toEqual({ content: 'hi' });
  });

  it('listSessions GETs the project session list with credentials (slice 11)', async () => {
    const rows = [{ id: 's2', agentId: null, title: 'newest', createdAt: 'x', updatedAt: 'y' }];
    mockFetch(rows);
    expect(await httpChatClient.listSessions('p1')).toEqual(rows);
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/chat$/);
    expect(init.credentials).toBe('include');
    expect(init.method).toBeUndefined(); // a plain GET — reads carry no CSRF header
  });

  it('getMessages GETs the JSON history with credentials (slice 11)', async () => {
    const rows = [
      { id: 'm1', sessionId: 's1', role: 'USER', agentId: null, content: 'hello', runId: null, createdAt: 'x' },
    ];
    mockFetch(rows);
    expect(await httpChatClient.getMessages('s1')).toEqual(rows);
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/chat\/s1\/messages$/);
    expect(init.credentials).toBe('include');
  });

  it('surfaces the RFC9457 detail on failure', async () => {
    mockFetch({ detail: 'Chat session not found.' }, false, 404);
    await expect(httpChatClient.getMessages('nope')).rejects.toThrow('Chat session not found.');
  });
});

describe('liveEventsUrl', () => {
  it('targets the same-origin live SSE with the explicit ?live=1 opt-in', () => {
    expect(liveEventsUrl('s1')).toMatch(/\/chat\/s1\/events\?live=1$/);
  });
});

describe('messageFromEvent', () => {
  it('maps an SSE MESSAGE frame (wire field `at`) onto the history view shape', () => {
    const m = messageFromEvent(
      JSON.stringify({
        id: 'm2', sessionId: 's1', role: 'AGENT', agentId: 'ag-1', content: 'Zeus here',
        runId: null, at: '2026-07-06T00:00:00.000Z',
      }),
    );
    expect(m).toEqual({
      id: 'm2', sessionId: 's1', role: 'AGENT', agentId: 'ag-1', content: 'Zeus here',
      runId: null, createdAt: '2026-07-06T00:00:00.000Z',
    });
  });

  it('returns null for malformed frames (display is best-effort)', () => {
    expect(messageFromEvent('not-json')).toBeNull();
    expect(messageFromEvent('{"delta":"x"}')).toBeNull();
  });
});
