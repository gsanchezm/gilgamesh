import { chunkText } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { AgentBrainPort } from '../ports/brain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { KnowledgeChunkRepository, KnowledgeDocumentRepository } from '../ports/knowledge';
import type { KnowledgeChunkRecord, KnowledgeDocumentRecord } from '../ports/records';
import type { MembershipRepository } from '../ports/repositories';

/** Org gate: a non-member gets NOT_FOUND so tenant existence is never leaked (mirrors requireProjectAccess). */
async function requireOrgMember(
  memberships: MembershipRepository,
  orgId: string,
  userId: string,
): Promise<void> {
  const role = await memberships.findRole(orgId, userId);
  if (!role) throw new ApplicationError('NOT_FOUND', 'Organization not found.');
}

export interface KnowledgeDocumentView {
  id: string;
  name: string;
  type: string;
  chunkCount: number;
  createdAt: string;
}

function toView(doc: KnowledgeDocumentRecord): KnowledgeDocumentView {
  return {
    id: doc.id,
    name: doc.name,
    type: doc.type,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
  };
}

export interface UploadKnowledgeDocumentInput {
  orgId: string;
  userId: string;
  name: string;
  type: string;
  content: string;
}

export interface UploadKnowledgeDocumentDeps {
  documents: KnowledgeDocumentRepository;
  knowledge: KnowledgeChunkRepository;
  brain: AgentBrainPort;
  memberships: MembershipRepository;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Ingests a per-org uploaded document (.md/.txt text) into the knowledge base: chunk → embed → store as
 * tenant-scoped `KnowledgeChunkRecord`s (orgId + documentId), and record the `KnowledgeDocumentRecord`.
 * Any org member may upload. The chunks are excluded from the shared global search (no cross-org leak);
 * wiring per-org retrieval into grounding is a follow-up.
 */
export class UploadKnowledgeDocument {
  constructor(private readonly deps: UploadKnowledgeDocumentDeps) {}

  async execute(input: UploadKnowledgeDocumentInput): Promise<KnowledgeDocumentView> {
    await requireOrgMember(this.deps.memberships, input.orgId, input.userId);

    const name = input.name.trim();
    if (!name) throw new ApplicationError('VALIDATION', 'A document name is required.');

    const chunks = chunkText(input.content);
    if (chunks.length === 0) {
      throw new ApplicationError('VALIDATION', 'The document has no indexable text.');
    }

    const embeddings = await this.deps.brain.embed(chunks.map((c) => c.text));
    const documentId = this.deps.ids.next();
    const now = this.deps.clock.now();

    const records: KnowledgeChunkRecord[] = chunks.map((c, i) => ({
      id: this.deps.ids.next(),
      orgId: input.orgId,
      documentId,
      source: name,
      headingPath: [],
      section: c.section,
      content: c.text,
      embedding: embeddings[i]!,
      tokenEstimate: (c.text.match(/\S+/g) ?? []).length,
    }));
    await this.deps.knowledge.upsertMany(records);

    const doc: KnowledgeDocumentRecord = {
      id: documentId,
      orgId: input.orgId,
      name,
      type: input.type,
      chunkCount: records.length,
      createdAt: now,
    };
    await this.deps.documents.create(doc);
    return toView(doc);
  }
}

export interface ListKnowledgeDocumentsDeps {
  documents: KnowledgeDocumentRepository;
  memberships: MembershipRepository;
}

/** Lists the org's uploaded documents (newest first). Non-member → NOT_FOUND. */
export class ListKnowledgeDocuments {
  constructor(private readonly deps: ListKnowledgeDocumentsDeps) {}

  async execute(input: { orgId: string; userId: string }): Promise<KnowledgeDocumentView[]> {
    await requireOrgMember(this.deps.memberships, input.orgId, input.userId);
    const docs = await this.deps.documents.listForOrg(input.orgId);
    return docs.map(toView);
  }
}
