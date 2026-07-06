import {
  type AgentBrainPort,
  type BrainTokenMeter,
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
  // S16 metering + S14 billing: the knowledge pipeline writes EMBED BrainUsage rows AND charges the
  // attributed org atomically; an exhausted allowance blocks the org-attributed paths (402).
  {
    provide: SearchKnowledge,
    useFactory: (knowledge: KnowledgeChunkRepository, brain: AgentBrainPort, meter: BrainTokenMeter) =>
      new SearchKnowledge({ knowledge, brain, meter }),
    inject: [T.Knowledge, T.Brain, T.BrainBilling],
  },
  {
    provide: IngestKnowledge,
    useFactory: (knowledge: KnowledgeChunkRepository, brain: AgentBrainPort, meter: BrainTokenMeter) =>
      new IngestKnowledge({ knowledge, brain, meter }),
    inject: [T.Knowledge, T.Brain, T.BrainBilling],
  },
  {
    provide: UploadKnowledgeDocument,
    useFactory: (
      uow: UnitOfWork,
      brain: AgentBrainPort,
      memberships: MembershipRepository,
      ids: IdGenerator,
      clock: Clock,
      meter: BrainTokenMeter,
    ) => new UploadKnowledgeDocument({ uow, brain, memberships, ids, clock, meter }),
    inject: [T.UnitOfWork, T.Brain, T.Memberships, T.Ids, T.Clock, T.BrainBilling],
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
