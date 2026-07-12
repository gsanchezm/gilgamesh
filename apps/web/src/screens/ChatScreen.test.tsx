import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRoomData, AgentsClient } from '../lib/agents-client';
import type { ChatClient, ChatMessageView, ChatSessionListItem } from '../lib/chat-client';
import type { VoiceAudio, VoiceClient } from '../lib/voice-client';
import type { CreateRecorder } from '../lib/voice-recorder';
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

function fakeVoice(overrides?: Partial<VoiceClient>): VoiceClient {
  return {
    transcribe: vi.fn(async () => ({ text: 'run the checkout feature' })),
    speak: vi.fn(async () => ({ audio: { data: 'AAAA', mimeType: 'audio/mpeg' } as VoiceAudio })),
    ...overrides,
  };
}

/** A fake mic recorder whose stop() yields a fixed clip — no browser MediaRecorder in jsdom. */
function fakeRecorder(audio: VoiceAudio = { data: 'AUDIO', mimeType: 'audio/webm' }): CreateRecorder {
  return async () => ({ stop: async () => audio, cancel: () => {} });
}

// ---- EventSource test double (jsdom has none) --------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly init: EventSourceInit | undefined;
  closed = false;
  onerror: ((ev: Event) => unknown) | null = null;
  private readonly listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
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

function renderChat(
  chat: ChatClient,
  opts?: {
    pinnedAgentId?: string;
    onBack?: () => void;
    voice?: VoiceClient;
    createRecorder?: CreateRecorder;
    playAudio?: (a: VoiceAudio) => void;
  },
) {
  return render(
    <ChatScreen
      client={chat}
      agentsClient={fakeAgents()}
      voiceClient={opts?.voice ?? fakeVoice()}
      projectId="p1"
      pinnedAgentId={opts?.pinnedAgentId ?? null}
      onBack={opts?.onBack}
      createRecorder={opts?.createRecorder ?? null}
      playAudio={opts?.playAudio ?? (() => {})}
    />,
  );
}

async function typeAndSend(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

// ---- tests -----------------------------------------------------------------------------

describe('ChatScreen (slice 11 re-skin)', () => {
  // ---- slice 37: session-rail async states (streaming path untouched) --------------------
  it('shows a spinner in the session rail while conversations load (slice 37)', async () => {
    const chat = fakeChat({ listSessions: vi.fn(() => new Promise<never>(() => {})) });
    renderChat(chat);
    expect(await screen.findByRole('status')).toBeTruthy();
    // The composer (streaming surface) still renders during the rail load.
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('shows an error state with retry in the rail on a conversation-load failure (slice 37)', async () => {
    const listSessions = vi
      .fn()
      .mockRejectedValueOnce(new Error('Rail boom'))
      .mockResolvedValueOnce(sessions);
    renderChat(fakeChat({ listSessions }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rail boom');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('hello pantheon')).toBeTruthy(); // rail session title
    expect(screen.queryByRole('alert')).toBeNull(); // stale error cleared on the successful retry
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when there are no conversations, composer intact (slice 37)', async () => {
    renderChat(fakeChat({ listSessions: vi.fn(async () => []) }));
    expect(await screen.findByText('No conversations yet')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('hides the empty state when conversations exist (slice 37)', async () => {
    renderChat(fakeChat());
    await screen.findByText('hello pantheon');
    expect(screen.queryByText('No conversations yet')).toBeNull();
  });

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
    // The session cookie must ride a cross-origin API deployment (audit #12; harmless same-origin).
    expect(es.init).toEqual({ withCredentials: true });

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

  // ---- slice 42: voice (STT dictate + TTS read-back) — the SSE path is untouched ----------
  it('dictates: a transcript lands in the composer WITHOUT auto-sending (AC-VOICE-02)', async () => {
    const chat = fakeChat();
    const voice = fakeVoice({ transcribe: vi.fn(async () => ({ text: 'run the checkout feature' })) });
    renderChat(chat, { voice, createRecorder: fakeRecorder() });

    // First tap records; the label flips to "Stop recording".
    fireEvent.click(await screen.findByRole('button', { name: 'Record voice message' }));
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    // Second tap stops → transcribes → drops the text into the composer.
    fireEvent.click(stop);

    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('run the checkout feature'),
    );
    expect(voice.transcribe).toHaveBeenCalledTimes(1);
    // Batch, not auto-send: nothing was posted; the member still presses Send.
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it('appends the transcript after existing typed text (no clobber)', async () => {
    const voice = fakeVoice({ transcribe: vi.fn(async () => ({ text: 'and report status' })) });
    renderChat(fakeChat(), { voice, createRecorder: fakeRecorder() });
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record voice message' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('hello and report status'),
    );
  });

  it('mic is a safe no-op when the browser cannot record (feature-detect)', async () => {
    const voice = fakeVoice();
    renderChat(fakeChat(), { voice, createRecorder: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Record voice message' }));
    // No recorder → a gentle note, never a crash; nothing transcribed.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(voice.transcribe).not.toHaveBeenCalled();
  });

  it('reads an agent message aloud: calls speak(sessionId, content) and plays it', async () => {
    const chat = fakeChat({ getMessages: vi.fn(async () => [userMsg, agentMsg]) });
    const voice = fakeVoice();
    const playAudio = vi.fn();
    renderChat(chat, { voice, playAudio });
    fireEvent.click(await screen.findByText('hello pantheon')); // select session → renders messages
    await screen.findByText('Zeus here — I coordinate the pantheon.');

    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await waitFor(() => expect(voice.speak).toHaveBeenCalledWith('s1', 'Zeus here — I coordinate the pantheon.'));
    await waitFor(() => expect(playAudio).toHaveBeenCalledWith({ data: 'AAAA', mimeType: 'audio/mpeg' }));
  });
});
