import { API_BASE, ok, sendJson } from './http';

export type ChatMessageRole = 'USER' | 'AGENT' | 'SYSTEM';

export interface ChatSessionView {
  id: string;
  projectId: string;
  agentId: string | null;
  createdAt: string;
}

export interface ChatMessageView {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  agentId: string | null;
  content: string;
  runId: string | null;
  at: string;
}

export interface ChatClient {
  createSession(projectId: string, agentId?: string | null): Promise<ChatSessionView>;
  /** 201 returns the persisted USER message; the answer arrives on the events replay. */
  sendMessage(sessionId: string, content: string): Promise<ChatMessageView>;
  listMessages(sessionId: string): Promise<ChatMessageView[]>;
}

/**
 * Parses the C3 SSE replay (`event: MESSAGE` blocks) into messages. The stub núcleo replays and
 * closes, so one fetch reads the whole conversation; a live EventSource lands with the real Brain.
 */
export function parseSseMessages(text: string): ChatMessageView[] {
  const out: ChatMessageView[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((l) => l.startsWith('event: '))?.slice('event: '.length);
    const data = lines.find((l) => l.startsWith('data: '))?.slice('data: '.length);
    if (event !== 'MESSAGE' || !data) continue;
    try {
      out.push(JSON.parse(data) as ChatMessageView);
    } catch {
      // skip malformed frames — the replay is best-effort for display
    }
  }
  return out;
}

export const httpChatClient: ChatClient = {
  createSession: (projectId, agentId) =>
    sendJson('POST', `/projects/${projectId}/chat`, agentId ? { agentId } : {}, 'Could not open the chat.'),
  sendMessage: (sessionId, content) =>
    sendJson('POST', `/chat/${sessionId}/messages`, { content }, 'Could not send the message.'),
  async listMessages(sessionId) {
    const res = await fetch(`${API_BASE}/chat/${sessionId}/events`, { credentials: 'include' });
    if (!res.ok) return ok<never>(res, 'Could not load the conversation.');
    return parseSseMessages(await res.text());
  },
};
