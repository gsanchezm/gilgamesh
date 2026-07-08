import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeClient, KnowledgeSearchView } from '../lib/knowledge-client';
import { KnowledgeScreen } from './KnowledgeScreen';

const view: KnowledgeSearchView = {
  total: 42,
  results: [
    {
      content: 'Boundary value analysis tests the edges of equivalence partitions.',
      citation: { source: 'ISTQB_CTFL_Syllabus_v4.0.1', section: 'Boundary Value Analysis', headingPath: ['Test Techniques'] },
      score: 0.87,
    },
  ],
};

function fakeClient(overrides?: Partial<KnowledgeClient>): KnowledgeClient {
  return {
    search: vi.fn(async () => view),
    listDocuments: vi.fn(async () => []),
    uploadDocument: vi.fn(async () => ({ id: 'd-new', name: 'demo.md', type: 'md', chunkCount: 5, createdAt: '2026-07-01T00:00:00.000Z' })),
    ...overrides,
  };
}

function renderScreen(client: KnowledgeClient) {
  return render(<KnowledgeScreen client={client} orgId="org-1" />);
}

describe('KnowledgeScreen', () => {
  it('loads and lists the org’s indexed documents on mount', async () => {
    const client = fakeClient({
      listDocuments: vi.fn(async () => [
        { id: 'd1', name: 'design.md', type: 'md', chunkCount: 3, createdAt: '2026-07-01T00:00:00.000Z' },
      ]),
    });
    renderScreen(client);

    await waitFor(() => expect(client.listDocuments).toHaveBeenCalledWith('org-1'));
    expect(await screen.findByText('design.md')).toBeTruthy();
    // Fetch-once-on-mount is unchanged by the async-state adoption.
    expect(client.listDocuments).toHaveBeenCalledTimes(1);
  });

  it('shows the EmptyState when there are no documents', async () => {
    renderScreen(fakeClient());
    expect(await screen.findByText(/No documents uploaded yet/i)).toBeTruthy();
  });

  it('shows the EmptyState when a search returns no matches', async () => {
    const client = fakeClient({ search: vi.fn(async () => ({ total: 0, results: [] })) });
    renderScreen(client);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'no-such-term' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(client.search).toHaveBeenCalledWith('no-such-term', 8));
    expect(await screen.findByText('No matches')).toBeTruthy();
  });

  it('ingests a sample via the demo button and shows the new document', async () => {
    const client = fakeClient();
    renderScreen(client);
    await waitFor(() => expect(client.listDocuments).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /demo/i }));

    await waitFor(() => expect(client.uploadDocument).toHaveBeenCalledTimes(1));
    expect(client.uploadDocument).toHaveBeenCalledWith('org-1', expect.objectContaining({ type: 'md' }));
    expect(await screen.findByText('demo.md')).toBeTruthy();
  });

  it('searches the shared KB and renders results with citations', async () => {
    const client = fakeClient();
    renderScreen(client);

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'boundary value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(client.search).toHaveBeenCalledWith('boundary value', 8));
    expect(await screen.findByText(/Boundary value analysis tests the edges/)).toBeTruthy();
    expect(screen.getByText(/ISTQB_CTFL_Syllabus_v4.0.1 · Boundary Value Analysis/)).toBeTruthy();
    // The EmptyState must NOT render when a search returns matches (guards the `results.length === 0`
    // condition against an off-by-one that would show "No matches" alongside real results — review S33-F2).
    expect(screen.queryByText('No matches')).toBeNull();
  });

  it('shows an error when the search fails', async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new Error('Could not search the knowledge base.');
      }),
    });
    renderScreen(client);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not search the knowledge base.');
  });
});
