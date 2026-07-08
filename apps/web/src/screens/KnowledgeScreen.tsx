import { EmptyState } from '@gilgamesh/ui';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { KnowledgeClient, KnowledgeDocument, KnowledgeResult } from '../lib/knowledge-client';

// A small, real sample the "+ demo" button ingests so the flow works without a file at hand.
const DEMO = {
  name: 'demo-istqb.md',
  type: 'md',
  content:
    '# Boundary Value Analysis\n\nBoundary value analysis (BVA) tests the edges of each equivalence ' +
    'partition — the minimum, just above the minimum, a nominal value, just below the maximum and the ' +
    'maximum — because defects cluster at boundaries.\n\n# Equivalence Partitioning\n\nEquivalence ' +
    'partitioning divides inputs into classes the system should treat the same, so one representative ' +
    'value per class gives good coverage with far fewer test cases.',
};

const ALLOWED_FILES = /\.(md|markdown|txt|pdf|docx)$/i;

export interface KnowledgeScreenProps {
  client: KnowledgeClient;
  orgId: string;
}

export function KnowledgeScreen({ client, orgId }: KnowledgeScreenProps) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    client.listDocuments(orgId).then(
      (docs) => {
        if (active) setDocuments(docs);
      },
      () => {
        /* leave the empty state on a load error */
      },
    );
    return () => {
      active = false;
    };
  }, [client, orgId]);

  async function ingest(name: string, type: string, content: string) {
    setUploadError(null);
    setUploading(true);
    try {
      const doc = await client.uploadDocument(orgId, { name, type, content });
      setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not upload the document.');
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!ALLOWED_FILES.test(file.name)) {
      setUploadError('Only .pdf, .docx, .md, and .txt files are supported.');
      return;
    }

    let type = 'txt';
    if (/\.(md|markdown)$/i.test(file.name)) {
      type = 'md';
    } else if (/\.pdf$/i.test(file.name)) {
      type = 'pdf';
    } else if (/\.docx$/i.test(file.name)) {
      type = 'docx';
    }

    let content = '';
    if (type === 'pdf' || type === 'docx') {
      try {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => {
            const result = reader.result as string;
            const commaIdx = result.indexOf(',');
            resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
          };
          reader.onerror = (err) => reject(err);
        });
      } catch (err) {
        setUploadError('Failed to read file.');
        return;
      }
    } else {
      content = await file.text();
    }

    await ingest(file.name, type, content);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchError(null);
    setSearching(true);
    try {
      const v = await client.search(query, 8);
      setResults(v.results);
      setTotal(v.total);
      setSearched(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="gx-kb">
      <header>
        <h1 className="gx-room__title">Knowledge base</h1>
        <p className="gx-room__sub">
          Upload documentation to ground the agents (private RAG). Not shown in chat.
        </p>
      </header>

      <div
        className={`gx-kb__drop${dragging ? ' gx-kb__drop--over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="gx-kb__dropicon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M12 15.5V6m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 18.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <p className="gx-kb__dropText">Drag PDFs, .docx or .md — or click to upload</p>
        <button
          type="button"
          className="gx-btn gx-btn--secondary gx-kb__demo"
          disabled={uploading}
          onClick={(e) => {
            e.stopPropagation();
            void ingest(DEMO.name, DEMO.type, DEMO.content);
          }}
        >
          + demo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain,.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {uploadError && (
        <p role="alert" className="gx-login__error">
          {uploadError}
        </p>
      )}

      <h2 className="gx-kb__section">Indexed documents</h2>
      {documents.length === 0 ? (
        <EmptyState title="No documents uploaded yet" />
      ) : (
        <ul className="gx-kb__docs">
          {documents.map((d) => (
            <li key={d.id} className="gx-kb__doc">
              <span className="gx-kb__docname">{d.name}</span>
              <span className="gx-kb__doctype">{d.type}</span>
              <span className="gx-kb__docchunks">{d.chunkCount} chunks</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="gx-kb__section">Search the shared knowledge base</h2>
      <form className="gx-kb__search" onSubmit={search}>
        <input
          aria-label="Search query"
          placeholder="e.g. boundary value analysis"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="gx-btn gx-btn--secondary" disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {searchError && (
        <p role="alert" className="gx-login__error">
          {searchError}
        </p>
      )}
      {searched && total !== null && (
        <p className="gx-kb__meta">
          {results.length} of {total} chunks
        </p>
      )}
      <ul className="gx-kb__results">
        {results.map((r, i) => (
          <li key={i} className="gx-kb__result">
            <p className="gx-kb__content">{r.content}</p>
            <p className="gx-kb__citation">
              <cite>
                {r.citation.source}
                {r.citation.section ? ` · ${r.citation.section}` : ''}
              </cite>
              <span className="gx-kb__score"> ({Number.isFinite(r.score) ? r.score.toFixed(2) : '—'})</span>
            </p>
          </li>
        ))}
      </ul>
      {searched && results.length === 0 && !searchError && <EmptyState title="No matches" />}
    </section>
  );
}
