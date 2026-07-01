import { readCsrfToken } from './csrf';

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

export interface KnowledgeDocument {
  id: string;
  name: string;
  type: string;
  chunkCount: number;
  createdAt: string;
}

export interface UploadDocumentInput {
  name: string;
  type: string;
  content: string;
}

export interface KnowledgeClient {
  /** Search the GLOBAL shared corpus (org-agnostic, S5-A). */
  search(query: string, k?: number): Promise<KnowledgeSearchView>;
  /** List the org's own uploaded documents (per-org, slice 7). */
  listDocuments(orgId: string): Promise<KnowledgeDocument[]>;
  /** Ingest a per-org document (.md/.txt text). */
  uploadDocument(orgId: string, input: UploadDocumentInput): Promise<KnowledgeDocument>;
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

  listDocuments: (orgId) =>
    fetch(`${API_BASE}/orgs/${orgId}/knowledge/documents`, { credentials: 'include' }).then((r) =>
      ok<KnowledgeDocument[]>(r, 'Could not load the documents.'),
    ),

  uploadDocument: (orgId, input) =>
    fetch(`${API_BASE}/orgs/${orgId}/knowledge/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
      credentials: 'include',
      body: JSON.stringify(input),
    }).then((r) => ok<KnowledgeDocument>(r, 'Could not upload the document.')),
};
