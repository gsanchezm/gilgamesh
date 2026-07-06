import { type FormEvent, useRef, useState } from 'react';
import type { ChatClient, ChatMessageView } from '../lib/chat-client';

const WHO: Record<ChatMessageView['role'], string> = { USER: 'You', AGENT: 'Pantheon', SYSTEM: 'Run' };

/**
 * Agent Chat (slice 8). Presentational: receives the typed client + ids as props. A session opens
 * lazily on the first send (no empty sessions); the conversation re-syncs from the C3 events
 * replay after each send. Deity attribution arrives in the AGENT message content (persona voice);
 * the full capture re-skin (avatars, tile-pinned entry, voice) is the look&feel Chat follow-up.
 */
export function ChatScreen({
  client,
  projectId,
  pinnedAgentId,
}: {
  client: ChatClient;
  projectId: string;
  pinnedAgentId?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!sessionRef.current) {
        sessionRef.current = (await client.createSession(projectId, pinnedAgentId ?? null)).id;
      }
      await client.sendMessage(sessionRef.current, content);
      setDraft('');
      setMessages(await client.listMessages(sessionRef.current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gx-chat">
      <header>
        <h1 className="gx-room__title">Agent chat</h1>
        <p className="gx-room__sub">Ask a question — Zeus routes it to the right deity.</p>
      </header>

      {error && (
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      )}

      {messages.length === 0 ? (
        <p className="gx-chat__empty">
          Talk to the pantheon: ask a question, or try “run the Checkout feature”.
        </p>
      ) : (
        <ul className="gx-chat__list">
          {messages.map((m) => (
            <li key={m.id} className={`gx-chat__msg gx-chat__msg--${m.role.toLowerCase()}`}>
              <span className="gx-chat__who">{WHO[m.role]}</span>
              <p className="gx-chat__content">{m.content}</p>
            </li>
          ))}
        </ul>
      )}

      <form className="gx-chat__composer" onSubmit={(e) => void send(e)}>
        <label className="gx-field gx-chat__field">
          <span>Message</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the pantheon…"
            disabled={busy}
          />
        </label>
        <button type="submit" className="gx-btn" disabled={busy}>
          Send
        </button>
      </form>
    </main>
  );
}
