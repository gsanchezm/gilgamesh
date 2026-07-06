import { chunkText, parseDocument } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { BrainTokenMeter } from '../brain/token-billing';
import type { AgentBrainPort } from '../ports/brain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { KnowledgeDocumentRepository } from '../ports/knowledge';
import type { KnowledgeChunkRecord, KnowledgeDocumentRecord } from '../ports/records';
import type { MembershipRepository } from '../ports/repositories';
import type { UnitOfWork } from '../ports/unit-of-work';
import { embeddingBrainFor, embedFor, meterEmbed } from './knowledge';

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
  uow: UnitOfWork;
  brain: AgentBrainPort;
  memberships: MembershipRepository;
  ids: IdGenerator;
  clock: Clock;
  /** S16 EMBED metering + S14 quota/charge — the upload's embed cost is attributed to the uploading org. */
  meter?: BrainTokenMeter;
}

/**
 * Ingests a per-org uploaded document (.md/.txt text) into the knowledge base: chunk → embed → store as
 * tenant-scoped `KnowledgeChunkRecord`s (orgId + documentId), and record the `KnowledgeDocumentRecord`.
 * Any org member may upload. The chunks are excluded from the shared global search (no cross-org leak);
 * wiring per-org retrieval into grounding is a follow-up.
 *
 * The document row and its chunks are written in ONE transaction (all-or-nothing): a failed write never
 * leaves orphaned chunks behind. The document is inserted FIRST so the chunks' `document_id` FK is satisfied.
 */
export class UploadKnowledgeDocument {
  constructor(private readonly deps: UploadKnowledgeDocumentDeps) {}

  async execute(input: UploadKnowledgeDocumentInput): Promise<KnowledgeDocumentView> {
    await requireOrgMember(this.deps.memberships, input.orgId, input.userId);

    const name = input.name.trim();
    if (!name) throw new ApplicationError('VALIDATION', 'A document name is required.');

    const parsedContent = parseDocument(input.content, input.type);
    const chunks = chunkText(parsedContent);
    if (chunks.length === 0) {
      throw new ApplicationError('VALIDATION', 'The document has no indexable text.');
    }

    // S14: the upload's embed is a billable EMBED call — gate it BEFORE the call (402 when exhausted).
    if (this.deps.meter) await this.deps.meter.assertWithinQuota(input.orgId);

    // Embedding is external I/O — do it BEFORE opening the DB transaction (never hold a tx over I/O).
    // Stored corpus content embeds as `document` (S16 AC-EMB-04) and meters EMBED to the uploading org;
    // the uploading org resolves its own embedding key through the forOrg seam (S19 AC-VBYOK-05).
    const brain = embeddingBrainFor(this.deps.brain, input.orgId);
    const { embeddings, totalTokens } = await embedFor(brain, chunks.map((c) => c.text), 'document');
    await meterEmbed(this.deps.meter, input.orgId, totalTokens);
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

    const doc: KnowledgeDocumentRecord = {
      id: documentId,
      orgId: input.orgId,
      name,
      type: input.type,
      chunkCount: records.length,
      createdAt: now,
    };

    await this.deps.uow.transaction(async (repos) => {
      await repos.knowledgeDocuments.create(doc);
      await repos.knowledge.upsertMany(records);
    });

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
