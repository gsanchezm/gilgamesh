import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AgentAvatar, EmptyState, ErrorState, IconMenu, Spinner, portraitFor } from '@gilgamesh/ui';
import type { AgentRuntimeStatus } from '@gilgamesh/domain';
import type { AgentRoomAgent, AgentsClient } from '../lib/agents-client';
import {
  liveEventsUrl,
  messageFromEvent,
  type ChatClient,
  type ChatMessageView,
  type ChatSessionListItem,
} from '../lib/chat-client';
import type { VoiceAudio, VoiceClient } from '../lib/voice-client';
import { createBrowserRecorder, playVoiceAudio, type CreateRecorder, type VoiceRecorder } from '../lib/voice-recorder';

const STATUS_WORD: Record<AgentRuntimeStatus, string> = { ACTIVE: 'Active', BUSY: 'Busy', IDLE: 'Idle' };

/** Browser mic capture (feature-detected once); `null` in jsdom/SSR/unsupported → the mic no-ops. */
const BROWSER_RECORDER: CreateRecorder = createBrowserRecorder();

/**
 * Agent Chat (slice 11 re-skin — capture 07): session rail (newest-first, derived titles, new
 * chat), pinned header when opened from an agent tile (`?agent=`), conversation pane with deity
 * attribution, run-narration console cards, and the prototype composer. History loads ONCE per
 * session via `getMessages`; each send opens a live `EventSource` on the S9 `?live=1` SSE and
 * appends DELTA/MESSAGE events, closing on DONE — the S8 full-replay-per-send is gone. An
 * EventSource failure falls back to a one-shot history resync (messages persist server-side first).
 */
export function ChatScreen({
  client,
  agentsClient,
  voiceClient,
  projectId,
  pinnedAgentId,
  onBack,
  createRecorder = BROWSER_RECORDER,
  playAudio = playVoiceAudio,
}: {
  client: ChatClient;
  agentsClient: AgentsClient;
  voiceClient: VoiceClient;
  projectId: string;
  pinnedAgentId?: string | null;
  onBack?: () => void;
  /** Mic-capture seam (slice 42) — default browser recorder, `null` when unsupported; tests inject a fake. */
  createRecorder?: CreateRecorder;
  /** Read-aloud playback seam (slice 42) — default browser `Audio`; tests inject a spy. */
  playAudio?: (audio: VoiceAudio) => void;
}) {
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  // Session-rail load lifecycle — distinct from the conversation `error` (send/select). `sessionsLoaded`
  // gates the rail Spinner to the INITIAL load only, so the post-send refresh never flickers the rail.
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [agentsById, setAgentsById] = useState<Map<string, AgentRoomAgent> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  /** The streaming answer under construction (DELTA accumulation); null = not streaming. */
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mobile-only: the session rail is an off-canvas drawer (≤767px). Pure layout state — it does not
  // touch the SSE/streaming path; the "Conversations" toggle + backdrop + tap-to-close set it.
  const [railOpen, setRailOpen] = useState(false);
  // Voice (slice 42) — a SEPARATE channel from the SSE/streaming path: `recording` toggles the mic,
  // `voiceBusy` covers the transcribe round-trip. None of this touches openLive/send/resync/DELTA.
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const closeLive = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const refreshSessions = useCallback(async () => {
    // Clear a prior rail-load error so a successful retry never leaves a stale banner (AC-37-04).
    setSessionsError(null);
    try {
      setSessions(await client.listSessions(projectId));
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not load the conversations.');
    } finally {
      setSessionsLoaded(true);
    }
  }, [client, projectId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // The deity attribution map (agentId -> identity) comes from the room view, which now carries
  // agent ids (slice 11). Attribution degrades gracefully if the room fails to load.
  useEffect(() => {
    let on = true;
    agentsClient.getAgentRoom(projectId).then(
      (data) => {
        if (on) setAgentsById(new Map(data.agents.map((a) => [a.id, a])));
      },
      () => {},
    );
    return () => {
      on = false;
    };
  }, [agentsClient, projectId]);

  // Never leak a live stream past unmount.
  useEffect(() => () => closeLive(), [closeLive]);

  // Never leave the mic open past unmount (voice — independent of the SSE stream).
  useEffect(() => () => recorderRef.current?.cancel(), []);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const appendMessage = useCallback((m: ChatMessageView) => {
    // Live replay frames duplicate loaded history — dedupe by id.
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  const resync = useCallback(
    async (sessionId: string) => {
      try {
        setMessages(await client.getMessages(sessionId));
      } catch {
        // keep whatever the stream delivered — history persists server-side
      }
      setBusy(false);
      void refreshSessions();
    },
    [client, refreshSessions],
  );

  /** Opens the per-send live stream; returns false when EventSource is unavailable (test/env). */
  function openLive(sessionId: string): boolean {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return false;
    closeLive();
    // withCredentials so the session cookie rides a cross-origin API deployment (audit #12;
    // harmless on the same-origin vite proxy setup).
    const es = new window.EventSource(liveEventsUrl(sessionId), { withCredentials: true });
    esRef.current = es;
    es.addEventListener('MESSAGE', (ev) => {
      const m = messageFromEvent((ev as MessageEvent<string>).data);
      if (!m) return;
      appendMessage(m);
      // The persisted answer replaces the streaming draft bubble.
      if (m.role !== 'USER') setPending(null);
    });
    es.addEventListener('DELTA', (ev) => {
      try {
        const { delta } = JSON.parse((ev as MessageEvent<string>).data) as { delta?: string };
        if (typeof delta === 'string') setPending((p) => (p ?? '') + delta);
      } catch {
        // malformed frame — display is best-effort
      }
    });
    es.addEventListener('DONE', () => {
      closeLive();
      setPending(null);
      setBusy(false);
      void refreshSessions(); // the first send titles the session; activity reorders the rail
    });
    es.onerror = () => {
      if (esRef.current !== es) return;
      closeLive();
      setPending(null);
      void resync(sessionId);
    };
    return true;
  }

  async function selectSession(id: string) {
    if (id === activeId) return;
    closeLive();
    setPending(null);
    setBusy(false);
    setError(null);
    setActiveId(id);
    try {
      setMessages(await client.getMessages(id));
    } catch (err) {
      setMessages([]);
      setError(err instanceof Error ? err.message : 'Could not load the conversation.');
    }
  }

  function newChat() {
    closeLive();
    setPending(null);
    setBusy(false);
    setError(null);
    setActiveId(null);
    setMessages([]);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    let sessionId = activeId;
    try {
      if (!sessionId) {
        // Lazy session create (S8 behavior kept): pinned when entered from an agent tile.
        sessionId = (await client.createSession(projectId, pinnedAgentId ?? null)).id;
        setActiveId(sessionId);
      }
      // Subscribe BEFORE the POST so no DELTA falls into the gap; replayed frames dedupe by id.
      const live = openLive(sessionId);
      const posted = await client.sendMessage(sessionId, content);
      appendMessage(posted);
      setDraft('');
      if (!live) await resync(sessionId);
      // In live mode `busy` clears on DONE (or via the error-fallback resync).
    } catch (err) {
      closeLive();
      setPending(null);
      setError(err instanceof Error ? err.message : 'Could not send the message.');
      setBusy(false);
    }
  }

  /**
   * Resolves the session id for a voice call, lazily creating one exactly like `send` does (a SEPARATE
   * function — the SSE `send` path is untouched). Dictating into a fresh chat opens the session so the
   * subsequent Send reuses it.
   */
  async function ensureVoiceSession(): Promise<string> {
    if (activeId) return activeId;
    const id = (await client.createSession(projectId, pinnedAgentId ?? null)).id;
    setActiveId(id);
    return id;
  }

  /**
   * Voice dictation (slice 42, AC-VOICE-02) — BATCH, not streaming: first tap records, second tap
   * stops → uploads → transcribes → drops the transcript into the composer `draft`. It NEVER sends;
   * the member still presses Send. Feature-detected: with no recorder (jsdom/unsupported) it no-ops.
   */
  async function toggleMic() {
    if (busy || voiceBusy) return;
    if (recording) {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (!rec) return;
      setVoiceBusy(true);
      setError(null);
      try {
        const audio = await rec.stop();
        const sessionId = await ensureVoiceSession();
        const { text } = await voiceClient.transcribe(sessionId, audio);
        const t = text.trim();
        // Append to whatever is already typed; the user reviews and presses Send (no auto-send).
        if (t) setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not transcribe the audio.');
      } finally {
        setVoiceBusy(false);
      }
      return;
    }
    if (!createRecorder) {
      setError('Voice input is not available in this browser.');
      return;
    }
    try {
      recorderRef.current = await createRecorder();
      setRecording(true);
    } catch (err) {
      recorderRef.current = null;
      setError(err instanceof Error ? err.message : 'Could not access the microphone.');
    }
  }

  /** Read-aloud (slice 42) — synthesize an agent message and play it; best-effort, never blocks chat. */
  async function readAloud(sessionId: string, text: string) {
    try {
      const { audio } = await voiceClient.speak(sessionId, text);
      playAudio(audio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the message aloud.');
    }
  }

  // Header identity: the active session's pin, else the tile-entry pin (`?agent=`) for a fresh
  // chat; no pin = the routed pantheon header.
  const activeSession = sessions.find((s) => s.id === activeId);
  const headerAgentId = activeSession ? activeSession.agentId : (pinnedAgentId ?? null);
  const headerAgent = headerAgentId ? (agentsById?.get(headerAgentId) ?? null) : null;

  return (
    <div className="gx-chat">
      <aside className="gx-chat__rail" id="gx-chat-rail" data-open={railOpen} aria-label="Conversations">
        <div className="gx-chat__railhead">
          <span className="gx-chat__railtitle">Conversations</span>
          <button
            type="button"
            className="gx-btn gx-btn--secondary"
            onClick={() => {
              setRailOpen(false);
              newChat();
            }}
          >
            New chat
          </button>
        </div>
        {!sessionsLoaded ? (
          <Spinner label="Loading conversations…" />
        ) : sessionsError ? (
          <ErrorState message={sessionsError} onRetry={() => void refreshSessions()} />
        ) : sessions.length === 0 ? (
          <EmptyState title="No conversations yet" hint="Start a new chat to begin." />
        ) : (
          <ul className="gx-chat__sessions">
            {sessions.map((s) => {
              const deity = s.agentId ? agentsById?.get(s.agentId)?.deityName : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`gx-chat__session${s.id === activeId ? ' gx-chat__session--active' : ''}`}
                    onClick={() => {
                      setRailOpen(false);
                      void selectSession(s.id);
                    }}
                  >
                    <span className="gx-chat__sessiontitle">{s.title ?? 'New conversation'}</span>
                    <span className="gx-chat__sessionmeta">{deity ?? 'Pantheon'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="gx-chat__pane">
        <header className="gx-chat__head">
          <button
            type="button"
            className="gx-chat__convbtn"
            aria-label="Show conversations"
            aria-expanded={railOpen}
            aria-controls="gx-chat-rail"
            onClick={() => setRailOpen(true)}
          >
            <IconMenu size={18} />
          </button>
          {onBack && (
            <>
              <button type="button" className="gx-chat__back" onClick={onBack}>
                ← Agents
              </button>
              <span className="gx-chat__headdivider" aria-hidden="true" />
            </>
          )}
          {headerAgent ? (
            <>
              <AgentAvatar
                size={40}
                glyph={headerAgent.glyph}
                familyColor={headerAgent.familyColor}
                status={headerAgent.status}
                portraitSrc={portraitFor(headerAgent.slot)}
                deityName={headerAgent.deityName}
              />
              <div className="gx-chat__headmeta">
                <div className="gx-chat__headrow">
                  <h1 className="gx-chat__deity">{headerAgent.deityName}</h1>
                  <span className="gx-chat__rolechip">{headerAgent.role}</span>
                </div>
                <span className="gx-chat__statusline">
                  {STATUS_WORD[headerAgent.status]} · {headerAgent.tool}
                </span>
              </div>
            </>
          ) : (
            <div className="gx-chat__headmeta">
              <div className="gx-chat__headrow">
                <h1 className="gx-chat__deity">Agent chat</h1>
              </div>
              <span className="gx-chat__statusline">Ask a question — Zeus routes it to the right deity.</span>
            </div>
          )}
        </header>

        {error && (
          <p role="alert" className="gx-login__error gx-chat__error">
            {error}
          </p>
        )}

        <div className="gx-chat__scroll" ref={scrollRef}>
          {messages.length === 0 && pending == null ? (
            <p className="gx-chat__empty">
              Talk to the pantheon: ask a question, or try “run the Checkout feature”.
            </p>
          ) : (
            <ul className="gx-chat__list">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  agentsById={agentsById}
                  onReadAloud={() => void readAloud(m.sessionId, m.content)}
                />
              ))}
              {pending != null && (
                <li className="gx-chat__row gx-chat__row--agent">
                  <div className="gx-chat__bubble gx-chat__bubble--agent" data-testid="gx-chat-pending">
                    {pending}
                    <span className="gx-chat__caret" aria-hidden="true" />
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>

        <form className="gx-chat__composer" onSubmit={(e) => void send(e)}>
          <input
            aria-label="Message"
            className="gx-chat__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            disabled={busy}
          />
          <button
            type="button"
            className={`gx-chat__mic${recording ? ' gx-chat__mic--recording' : ''}`}
            aria-label={recording ? 'Stop recording' : 'Record voice message'}
            aria-pressed={recording}
            title={recording ? 'Stop and transcribe' : 'Record a voice message'}
            onClick={() => void toggleMic()}
            disabled={busy || voiceBusy}
          >
            <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="#0E1B36" strokeWidth="1.8" />
              <path d="M4 8.5 a5 5 0 0 0 10 0 M9 13.5 V16" stroke="#0E1B36" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button type="submit" className="gx-chat__send" aria-label="Send" disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M3 9 L15 9 M10 4 L15 9 L10 14"
                stroke="#E7C877"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
        <p className="gx-chat__kb">Answers from your private knowledge base.</p>
      </section>

      {railOpen && (
        <button
          type="button"
          className="gx-chat__railbackdrop"
          aria-label="Close conversations"
          onClick={() => setRailOpen(false)}
        />
      )}
    </div>
  );
}

function MessageRow({
  message: m,
  agentsById,
  onReadAloud,
}: {
  message: ChatMessageView;
  agentsById: Map<string, AgentRoomAgent> | null;
  onReadAloud?: () => void;
}) {
  if (m.role === 'USER') {
    return (
      <li className="gx-chat__row gx-chat__row--user">
        <div className="gx-chat__bubble gx-chat__bubble--user">{m.content}</div>
      </li>
    );
  }
  if (m.role === 'SYSTEM') {
    return (
      <li className="gx-chat__row gx-chat__row--system">
        <div className="gx-chat__console">
          <span className="gx-chat__consolehead">Run narration</span>
          <pre className="gx-chat__consolebody">{m.content}</pre>
        </div>
      </li>
    );
  }
  const agent = m.agentId ? agentsById?.get(m.agentId) : null;
  return (
    <li className="gx-chat__row gx-chat__row--agent">
      {agent && (
        <AgentAvatar
          size={30}
          glyph={agent.glyph}
          familyColor={agent.familyColor}
          status={agent.status}
          portraitSrc={portraitFor(agent.slot)}
          deityName={agent.deityName}
        />
      )}
      <div className="gx-chat__agentmsg">
        <span className="gx-chat__who">{agent?.deityName ?? 'Pantheon'}</span>
        <div className="gx-chat__bubble gx-chat__bubble--agent">{m.content}</div>
        {onReadAloud && (
          <button type="button" className="gx-chat__readaloud" aria-label="Read aloud" onClick={onReadAloud}>
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M3 7 H6 L10 3 V15 L6 11 H3 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M13 6 a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Read aloud
          </button>
        )}
      </div>
    </li>
  );
}
