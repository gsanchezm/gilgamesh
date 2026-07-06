import { API_BASE, getJson, sendJson } from './http';

export type ChatMessageRole = 'USER' | 'AGENT' | 'SYSTEM';

export interface ChatSessionView {
  id: string;
  projectId: string;
  agentId: string | null;
  createdAt: string;
}

/** One row of `GET /projects/{id}/chat` — `title` is the derived first-USER-message (slice 11). */
export interface ChatSessionListItem {
  id: string;
  agentId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageView {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  agentId: string | null;
  content: string;
  runId: string | null;
  createdAt: string;
}

export interface ChatClient {
  createSession(projectId: string, agentId?: string | null): Promise<ChatSessionView>;
  /** 201 returns the persisted USER message; the answer arrives on the live events stream. */
  sendMessage(sessionId: string, content: string): Promise<ChatMessageView>;
  /** The project's sessions newest-first with derived titles (keystone v0.4, slice 11). */
  listSessions(projectId: string): Promise<ChatSessionListItem[]>;
  /** The conversation history as JSON — loaded ONCE per session; live events append (slice 11). */
  getMessages(sessionId: string): Promise<ChatMessageView[]>;
}

/** The live SSE endpoint for `new EventSource(...)` — same-origin, cookie-authenticated (S9 C3). */
export function liveEventsUrl(sessionId: string): string {
  return `${API_BASE}/chat/${sessionId}/events?live=1`;
}

/**
 * Maps one SSE `MESSAGE` frame's data (the S8 `ChatEvent` wire shape, timestamp field `at`) onto
 * the JSON-history `ChatMessageView` shape, so live-appended and history-loaded messages are
 * interchangeable in the screen state. Returns null for malformed frames (display is best-effort).
 */
export function messageFromEvent(data: string): ChatMessageView | null {
  try {
    const v = JSON.parse(data) as Record<string, unknown>;
    if (typeof v.id !== 'string' || typeof v.role !== 'string' || typeof v.content !== 'string') return null;
    return {
      id: v.id,
      sessionId: typeof v.sessionId === 'string' ? v.sessionId : '',
      role: v.role as ChatMessageRole,
      agentId: typeof v.agentId === 'string' ? v.agentId : null,
      content: v.content,
      runId: typeof v.runId === 'string' ? v.runId : null,
      createdAt: typeof v.at === 'string' ? v.at : '',
    };
  } catch {
    return null;
  }
}

export const httpChatClient: ChatClient = {
  createSession: (projectId, agentId) =>
    sendJson('POST', `/projects/${projectId}/chat`, agentId ? { agentId } : {}, 'Could not open the chat.'),
  sendMessage: (sessionId, content) =>
    sendJson('POST', `/chat/${sessionId}/messages`, { content }, 'Could not send the message.'),
  listSessions: (projectId) =>
    getJson(`/projects/${projectId}/chat`, 'Could not load the conversations.'),
  getMessages: (sessionId) => getJson(`/chat/${sessionId}/messages`, 'Could not load the conversation.'),
};
