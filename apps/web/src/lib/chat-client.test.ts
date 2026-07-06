import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpChatClient, parseSseMessages } from './chat-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

function mockFetch(payload: unknown, ok = true, status = 200, text = '') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => payload, text: async () => text })),
  );
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

const SSE =
  'event: MESSAGE\ndata: {"id":"m1","sessionId":"s1","role":"USER","agentId":null,"content":"hello","runId":null,"at":"2026-07-05T00:00:00.000Z"}\n\n' +
  'event: MESSAGE\ndata: {"id":"m2","sessionId":"s1","role":"AGENT","agentId":"ag-1","content":"Zeus here","runId":null,"at":"2026-07-05T00:00:00.000Z"}\n\n' +
  'event: DONE\ndata: {}\n\n';

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
    mockFetch({ id: 'm1', sessionId: 's1', role: 'USER', agentId: null, content: 'hi', runId: null, at: 'x' }, true, 201);
    await httpChatClient.sendMessage('s1', 'hi');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/chat\/s1\/messages$/);
    expect(JSON.parse(init.body!)).toEqual({ content: 'hi' });
  });

  it('listMessages GETs the SSE replay and parses MESSAGE events', async () => {
    mockFetch(null, true, 200, SSE);
    const messages = await httpChatClient.listMessages('s1');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/chat\/s1\/events$/);
    expect(init.credentials).toBe('include');
    expect(messages.map((m) => m.role)).toEqual(['USER', 'AGENT']);
    expect(messages[1]!.content).toBe('Zeus here');
  });
});

describe('parseSseMessages', () => {
  it('ignores DONE and malformed blocks', () => {
    expect(parseSseMessages(`${SSE}garbage\n\nevent: MESSAGE\ndata: not-json\n\n`)).toHaveLength(2);
  });
});
