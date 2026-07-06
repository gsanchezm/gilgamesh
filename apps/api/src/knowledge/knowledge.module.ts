import {
  type AgentBrainPort,
  type BrainUsageRepository,
  type Clock,
  type IdGenerator,
  IngestKnowledge,
  type KnowledgeChunkRepository,
  type KnowledgeDocumentRepository,
  ListKnowledgeDocuments,
  type MembershipRepository,
  SearchKnowledge,
  type UnitOfWork,
  UploadKnowledgeDocument,
} from '@gilgamesh/application';
import { setInflateSync } from '@gilgamesh/domain';
import { Module, type Provider } from '@nestjs/common';
import { inflateSync } from 'node:zlib';
import { TOKENS } from '../persistence/tokens';
import { KnowledgeController, OrgKnowledgeController } from './knowledge.controller';
import { KnowledgeSeeder } from './knowledge.seeder';

const T = TOKENS;

const providers: Provider[] = [
  // S16: the knowledge pipeline meters EMBED BrainUsage rows (surface EMBED) per org-attributable call.
  {
    provide: SearchKnowledge,
    useFactory: (knowledge: KnowledgeChunkRepository, brain: AgentBrainPort, brainUsage: BrainUsageRepository, ids: IdGenerator, clock: Clock) =>
      new SearchKnowledge({ knowledge, brain, meter: { brainUsage, ids, clock } }),
    inject: [T.Knowledge, T.Brain, T.BrainUsage, T.Ids, T.Clock],
  },
  {
    provide: IngestKnowledge,
    useFactory: (knowledge: KnowledgeChunkRepository, brain: AgentBrainPort, brainUsage: BrainUsageRepository, ids: IdGenerator, clock: Clock) =>
      new IngestKnowledge({ knowledge, brain, meter: { brainUsage, ids, clock } }),
    inject: [T.Knowledge, T.Brain, T.BrainUsage, T.Ids, T.Clock],
  },
  {
    provide: UploadKnowledgeDocument,
    useFactory: (
      uow: UnitOfWork,
      brain: AgentBrainPort,
      memberships: MembershipRepository,
      ids: IdGenerator,
      clock: Clock,
      brainUsage: BrainUsageRepository,
    ) => new UploadKnowledgeDocument({ uow, brain, memberships, ids, clock, meter: { brainUsage, ids, clock } }),
    inject: [T.UnitOfWork, T.Brain, T.Memberships, T.Ids, T.Clock, T.BrainUsage],
  },
  {
    provide: ListKnowledgeDocuments,
    useFactory: (documents: KnowledgeDocumentRepository, memberships: MembershipRepository) =>
      new ListKnowledgeDocuments({ documents, memberships }),
    inject: [T.KnowledgeDocuments, T.Memberships],
  },
  KnowledgeSeeder,
];

@Module({
  controllers: [KnowledgeController, OrgKnowledgeController],
  providers,
})
export class KnowledgeModule {
  constructor() {
    setInflateSync((data) => inflateSync(data));
  }
}
