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
  return { search: vi.fn(async () => view), ...overrides };
}

describe('KnowledgeScreen', () => {
  it('searches and renders results with source citations', async () => {
    const client = fakeClient();
    render(<KnowledgeScreen client={client} />);

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'boundary value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(client.search).toHaveBeenCalledWith('boundary value', 8));
    expect(await screen.findByText(/Boundary value analysis tests the edges/)).toBeTruthy();
    expect(screen.getByText(/ISTQB_CTFL_Syllabus_v4.0.1 · Boundary Value Analysis/)).toBeTruthy();
    expect(screen.getByText('1 of 42 chunks')).toBeTruthy();
  });

  it('does not search an empty query', () => {
    const client = fakeClient();
    render(<KnowledgeScreen client={client} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(client.search).not.toHaveBeenCalled();
  });

  it('shows an error when the search fails', async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new Error('Could not search the knowledge base.');
      }),
    });
    render(<KnowledgeScreen client={client} />);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not search the knowledge base.');
  });
});
