import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRoomData, AgentsClient } from '../lib/agents-client';
import type { ChatClient, ChatMessageView, ChatSessionListItem } from '../lib/chat-client';
import { ChatScreen } from './ChatScreen';

// ---- fixtures --------------------------------------------------------------------------

const userMsg: ChatMessageView = {
  id: 'm1', sessionId: 's1', role: 'USER', agentId: null,
  content: 'hello pantheon', runId: null, createdAt: '2026-07-06T00:00:00.000Z',
};
const agentMsg: ChatMessageView = {
  id: 'm2', sessionId: 's1', role: 'AGENT', agentId: 'ag-lead',
  content: 'Zeus here — I coordinate the pantheon.', runId: null, createdAt: '2026-07-06T00:00:01.000Z',
};
const systemMsg: ChatMessageView = {
  id: 'm3', sessionId: 's1', role: 'SYSTEM', agentId: null,
  content: 'Run DONE — "Checkout": 2 passed, 0 failed (100%).\nPASS — Checkout case 1', runId: 'r1',
  createdAt: '2026-07-06T00:00:02.000Z',
};

const sessions: ChatSessionListItem[] = [
  { id: 's1', agentId: null, title: 'hello pantheon', createdAt: 'x', updatedAt: 'y' },
  { id: 's2', agentId: 'ag-perf', title: null, createdAt: 'x', updatedAt: 'y' },
];

function room(): AgentRoomData {
  return {
    project: { id: 'p1', name: 'OmniPizza', slug: 'omnipizza', format: 'BDD' },
    agents: [
      {
        id: 'ag-lead', slot: 'lead', deityName: 'Zeus', role: 'QA Lead', family: 'proceso',
        familyColor: '#A07D2C', glyph: 'ZE', culture: 'Grecia', tool: 'Helix Core',
        toolOptions: ['Helix Core'], enabled: true, status: 'ACTIVE',
      },
      {
        id: 'ag-perf', slot: 'perf', deityName: 'Thor', role: 'Performance', family: 'backend',
        familyColor: '#7E63A6', glyph: 'TH', culture: 'Escandinavia', tool: 'k6',
        toolOptions: ['k6', 'Gatling', 'JMeter'], enabled: true, status: 'ACTIVE',
      },
    ],
    kpis: { awake: 2, total: 2, successRatePct: null, scenarios: 0 },
  };
}

function fakeChat(overrides?: Partial<ChatClient>): ChatClient {
  return {
    createSession: vi.fn(async () => ({ id: 's-new', projectId: 'p1', agentId: null, createdAt: 'x' })),
    sendMessage: vi.fn(async () => userMsg),
    listSessions: vi.fn(async () => sessions),
    getMessages: vi.fn(async () => [userMsg, agentMsg]),
    ...overrides,
  };
}

function fakeAgents(): AgentsClient {
  return {
    getAgentRoom: vi.fn(async () => room()),
    setAgent: vi.fn(async () => room().agents[0]!),
    wakeAll: vi.fn(async () => ({ awake: 2, total: 2 })),
  };
}

// ---- EventSource test double (jsdom has none) --------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  onerror: ((ev: Event) => unknown) | null = null;
  private readonly listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
  fail(): void {
    this.onerror?.(new Event('error'));
  }
}

function stubEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

function renderChat(chat: ChatClient, opts?: { pinnedAgentId?: string; onBack?: () => void }) {
  return render(
    <ChatScreen
      client={chat}
      agentsClient={fakeAgents()}
      projectId="p1"
      pinnedAgentId={opts?.pinnedAgentId ?? null}
      onBack={opts?.onBack}
    />,
  );
}

async function typeAndSend(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

// ---- tests -----------------------------------------------------------------------------

describe('ChatScreen (slice 11 re-skin)', () => {
  it('renders the session rail newest-first with derived titles and a fallback', async () => {
    renderChat(fakeChat());
    // The routed pantheon header is a real heading (the Playwright chat e2e selects it by role).
    expect(screen.getByRole('heading', { name: 'Agent chat' })).toBeTruthy();
    expect(await screen.findByText('hello pantheon')).toBeTruthy();
    expect(screen.getByText('New conversation')).toBeTruthy(); // null title fallback
    // Pinned session meta shows its deity once the room view resolves; routed shows Pantheon.
    expect(await screen.findByText('Thor')).toBeTruthy();
    expect(screen.getByText('Pantheon')).toBeTruthy();
    expect(screen.getByText(/Talk to the pantheon/i)).toBeTruthy(); // empty conversation state
  });

  it('selecting a session loads its history once and renders deity attribution + console cards', async () => {
    const chat = fakeChat({ getMessages: vi.fn(async () => [userMsg, agentMsg, systemMsg]) });
    renderChat(chat);
    fireEvent.click(await screen.findByText('hello pantheon'));

    expect(await screen.findByText('Zeus here — I coordinate the pantheon.')).toBeTruthy();
    expect(chat.getMessages).toHaveBeenCalledTimes(1);
    expect(chat.getMessages).toHaveBeenCalledWith('s1');
    // Deity attribution resolved from the room view by agentId.
    expect(await screen.findByText('Zeus')).toBeTruthy();
    // SYSTEM messages render as run-narration console cards.
    expect(screen.getByText('Run narration')).toBeTruthy();
    expect(screen.getByText(/PASS — Checkout case 1/)).toBeTruthy();
  });

  it('streams live: opens ?live=1 on send, builds the pending bubble from DELTAs, closes on DONE', async () => {
    stubEventSource();
    const chat = fakeChat();
    renderChat(chat);
    await screen.findByText('hello pantheon');
    await typeAndSend('a new question');

    await waitFor(() => expect(chat.sendMessage).toHaveBeenCalledWith('s-new', 'a new question'));
    // The lazy session was created and the live stream opened BEFORE the POST.
    expect(chat.createSession).toHaveBeenCalledWith('p1', null);
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toMatch(/\/chat\/s-new\/events\?live=1$/);

    act(() => {
      es.emit('DELTA', { type: 'DELTA', delta: 'Thor here — ' });
      es.emit('DELTA', { type: 'DELTA', delta: 'set a p95 budget.' });
    });
    expect(screen.getByTestId('gx-chat-pending').textContent).toContain('Thor here — set a p95 budget.');

    // The persisted AGENT message replaces the streaming draft; DONE closes and re-enables.
    act(() => {
      es.emit('MESSAGE', { ...agentMsg, sessionId: 's-new', at: agentMsg.createdAt });
      es.emit('DONE', {});
    });
    expect(screen.queryByTestId('gx-chat-pending')).toBeNull();
    expect(screen.getByText('Zeus here — I coordinate the pantheon.')).toBeTruthy();
    expect(es.closed).toBe(true);
    await waitFor(() => expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(false));
    // The rail refreshes (the first send titles the session).
    expect(chat.listSessions).toHaveBeenCalledTimes(2);
  });

  it('dedupes live replay frames against already-loaded history', async () => {
    stubEventSource();
    const chat = fakeChat();
    renderChat(chat);
    fireEvent.click(await screen.findByText('hello pantheon')); // loads m1+m2
    await screen.findByText('Zeus here — I coordinate the pantheon.');

    await typeAndSend('follow-up');
    await waitFor(() => expect(chat.sendMessage).toHaveBeenCalled());
    const es = FakeEventSource.instances[0]!;
    act(() => {
      // The live stream replays persisted history first — must not duplicate rows.
      es.emit('MESSAGE', { ...userMsg, at: userMsg.createdAt });
      es.emit('MESSAGE', { ...agentMsg, at: agentMsg.createdAt });
      es.emit('DONE', {});
    });
    expect(screen.getAllByText('Zeus here — I coordinate the pantheon.')).toHaveLength(1);
  });

  it('falls back to a history resync when the EventSource errors', async () => {
    stubEventSource();
    const resynced = [userMsg, agentMsg];
    const chat = fakeChat({ getMessages: vi.fn(async () => resynced) });
    renderChat(chat);
    await screen.findByText('hello pantheon');
    await typeAndSend('doomed stream');

    await waitFor(() => expect(chat.sendMessage).toHaveBeenCalled());
    const es = FakeEventSource.instances[0]!;
    act(() => {
      es.fail();
    });
    expect(await screen.findByText('Zeus here — I coordinate the pantheon.')).toBeTruthy();
    expect(chat.getMessages).toHaveBeenCalledWith('s-new');
    expect(es.closed).toBe(true);
    await waitFor(() => expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(false));
  });

  it('resyncs after the send when no EventSource is available (jsdom default)', async () => {
    const chat = fakeChat();
    renderChat(chat);
    await screen.findByText('hello pantheon');
    await typeAndSend('no streaming here');

    await waitFor(() => expect(chat.sendMessage).toHaveBeenCalled());
    expect(await screen.findByText('Zeus here — I coordinate the pantheon.')).toBeTruthy();
    expect(chat.getMessages).toHaveBeenCalledWith('s-new');
  });

  it('pins the lazy session from the tile entry and renders the capture-07 pinned header', async () => {
    const onBack = vi.fn();
    const chat = fakeChat({ listSessions: vi.fn(async () => []) });
    renderChat(chat, { pinnedAgentId: 'ag-perf', onBack });

    // Pinned header: deity name (as the heading), role chip, status · tool line, back link.
    expect(await screen.findByRole('heading', { name: 'Thor' })).toBeTruthy();
    expect(screen.getByText('Performance')).toBeTruthy();
    expect(screen.getByText('Active · k6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Agents' }));
    expect(onBack).toHaveBeenCalled();

    await typeAndSend('load question');
    await waitFor(() => expect(chat.createSession).toHaveBeenCalledWith('p1', 'ag-perf'));
  });

  it('New chat clears the conversation and the next send opens a fresh session', async () => {
    const chat = fakeChat();
    renderChat(chat);
    fireEvent.click(await screen.findByText('hello pantheon'));
    await screen.findByText('Zeus here — I coordinate the pantheon.');

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.queryByText('Zeus here — I coordinate the pantheon.')).toBeNull();
    expect(screen.getByText(/Talk to the pantheon/i)).toBeTruthy();

    await typeAndSend('fresh start');
    await waitFor(() => expect(chat.createSession).toHaveBeenCalledTimes(1));
    expect(chat.sendMessage).toHaveBeenCalledWith('s-new', 'fresh start');
  });

  it('surfaces send failures as an alert and re-enables the composer', async () => {
    const chat = fakeChat({
      sendMessage: vi.fn(async () => {
        throw new Error('Could not send the message.');
      }),
    });
    renderChat(chat);
    await screen.findByText('hello pantheon');
    await typeAndSend('doomed');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not send the message.');
    expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(false);
  });

  it('keeps the mic affordance visibly disabled (voice is a later slice)', async () => {
    renderChat(fakeChat());
    const mic = await screen.findByRole('button', { name: 'Voice (coming soon)' });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
  });
});
