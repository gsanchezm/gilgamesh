import { getJson, sendJson } from './http';

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

// Routed through getJson/sendJson (slice 25, review F1): the search + list reads gain the timeout +
// transient-retry; the upload mutation gains the timeout + typed error but is never retried.
export const httpKnowledgeClient: KnowledgeClient = {
  search: (query, k) => {
    const params = new URLSearchParams({ q: query });
    if (k) params.set('k', String(k));
    return getJson<KnowledgeSearchView>(
      `/knowledge/search?${params.toString()}`,
      'Could not search the knowledge base.',
    );
  },

  listDocuments: (orgId) =>
    getJson<KnowledgeDocument[]>(`/orgs/${orgId}/knowledge/documents`, 'Could not load the documents.'),

  uploadDocument: (orgId, input) =>
    sendJson<KnowledgeDocument>(
      'POST',
      `/orgs/${orgId}/knowledge/documents`,
      input,
      'Could not upload the document.',
    ),
};
