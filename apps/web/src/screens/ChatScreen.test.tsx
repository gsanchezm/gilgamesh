import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatClient, ChatMessageView } from '../lib/chat-client';
import { ChatScreen } from './ChatScreen';

const userMsg: ChatMessageView = {
  id: 'm1',
  sessionId: 's1',
  role: 'USER',
  agentId: null,
  content: 'hello pantheon',
  runId: null,
  at: '2026-07-05T00:00:00.000Z',
};
const agentMsg: ChatMessageView = {
  id: 'm2',
  sessionId: 's1',
  role: 'AGENT',
  agentId: 'ag-lead',
  content: 'Zeus here — I coordinate the pantheon.',
  runId: null,
  at: '2026-07-05T00:00:01.000Z',
};
const systemMsg: ChatMessageView = {
  id: 'm3',
  sessionId: 's1',
  role: 'SYSTEM',
  agentId: null,
  content: 'Run DONE — "Checkout": 2 passed, 0 failed, 0 skipped (100%).\nPASS — Checkout case 1',
  runId: 'r1',
  at: '2026-07-05T00:00:02.000Z',
};

function fakeClient(overrides?: Partial<ChatClient>): ChatClient {
  return {
    createSession: vi.fn(async () => ({ id: 's1', projectId: 'p1', agentId: null, createdAt: 'x' })),
    sendMessage: vi.fn(async () => userMsg),
    listMessages: vi.fn(async () => [userMsg, agentMsg]),
    ...overrides,
  };
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('ChatScreen', () => {
  it('shows an empty state before any message', () => {
    render(<ChatScreen client={fakeClient()} projectId="p1" />);
    expect(screen.getByText(/Talk to the pantheon/i)).toBeTruthy();
  });

  it('opens a session lazily on the first send and renders the conversation', async () => {
    const client = fakeClient();
    render(<ChatScreen client={client} projectId="p1" />);
    await sendMessage('hello pantheon');

    await waitFor(() => expect(client.createSession).toHaveBeenCalledWith('p1', null));
    expect(client.sendMessage).toHaveBeenCalledWith('s1', 'hello pantheon');
    expect(await screen.findByText('Zeus here — I coordinate the pantheon.')).toBeTruthy();
    expect(screen.getByText('hello pantheon')).toBeTruthy();
  });

  it('reuses the session across sends', async () => {
    const client = fakeClient();
    render(<ChatScreen client={client} projectId="p1" />);
    await sendMessage('first');
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    await sendMessage('second');
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  it('pins the session to the agent from the query context', async () => {
    const client = fakeClient();
    render(<ChatScreen client={client} projectId="p1" pinnedAgentId="ag-perf" />);
    await sendMessage('load question');
    await waitFor(() => expect(client.createSession).toHaveBeenCalledWith('p1', 'ag-perf'));
  });

  it('renders a run narration block for SYSTEM messages', async () => {
    const client = fakeClient({ listMessages: vi.fn(async () => [userMsg, agentMsg, systemMsg]) });
    render(<ChatScreen client={client} projectId="p1" />);
    await sendMessage('run the Checkout feature');
    expect(await screen.findByText(/PASS — Checkout case 1/)).toBeTruthy();
  });

  it('surfaces send failures as an alert and keeps the draft usable', async () => {
    const client = fakeClient({
      sendMessage: vi.fn(async () => {
        throw new Error('Could not send the message.');
      }),
    });
    render(<ChatScreen client={client} projectId="p1" />);
    await sendMessage('doomed');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not send the message.');
  });
});
