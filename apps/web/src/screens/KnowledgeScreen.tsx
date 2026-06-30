import { Button } from '@gilgamesh/ui';
import { type FormEvent, useState } from 'react';
import type { KnowledgeClient, KnowledgeResult } from '../lib/knowledge-client';

export interface KnowledgeScreenProps {
  client: KnowledgeClient;
}

export function KnowledgeScreen({ client }: KnowledgeScreenProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const view = await client.search(query, 8);
      setResults(view.results);
      setTotal(view.total);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gx-knowledge">
      <header>
        <h1>Knowledge base</h1>
        <p>Search the shared QA knowledge base (ISTQB syllabi + BDD books) that grounds the agents.</p>
      </header>

      <form onSubmit={search} aria-label="Search the knowledge base">
        <input
          aria-label="Search query"
          placeholder="e.g. boundary value analysis"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" disabled={busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && (
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      )}

      {searched && total !== null && (
        <p className="gx-knowledge__meta">
          {results.length} of {total} chunks
        </p>
      )}

      <ul className="gx-knowledge__results">
        {results.map((r, i) => (
          <li key={i} className="gx-knowledge__result">
            <p className="gx-knowledge__content">{r.content}</p>
            <p className="gx-knowledge__citation">
              <cite>
                {r.citation.source}
                {r.citation.section ? ` · ${r.citation.section}` : ''}
              </cite>
              <span className="gx-knowledge__score"> ({r.score.toFixed(2)})</span>
            </p>
          </li>
        ))}
      </ul>

      {searched && results.length === 0 && !error && <p>No matches.</p>}
    </main>
  );
}
