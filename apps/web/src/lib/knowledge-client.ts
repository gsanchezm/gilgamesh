export interface Citation {
  source: string;
  section: string;
  headingPath: string[];
}

export interface KnowledgeResult {
  content: string;
  citation: Citation;
  score: number;
}

export interface KnowledgeSearchView {
  results: KnowledgeResult[];
  total: number;
}

export interface KnowledgeClient {
  search(query: string, k?: number): Promise<KnowledgeSearchView>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(problem.detail ?? fallback);
  }
  return (await res.json()) as T;
}

export const httpKnowledgeClient: KnowledgeClient = {
  search: (query, k) => {
    const params = new URLSearchParams({ q: query });
    if (k) params.set('k', String(k));
    return fetch(`${API_BASE}/knowledge/search?${params.toString()}`, { credentials: 'include' }).then((r) =>
      ok<KnowledgeSearchView>(r, 'Could not search the knowledge base.'),
    );
  },
};
