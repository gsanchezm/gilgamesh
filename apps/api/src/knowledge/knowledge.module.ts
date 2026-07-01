import {
  type AgentBrainPort,
  type Clock,
  type IdGenerator,
  IngestKnowledge,
  type KnowledgeChunkRepository,
  type KnowledgeDocumentRepository,
  ListKnowledgeDocuments,
  type MembershipRepository,
  SearchKnowledge,
  UploadKnowledgeDocument,
} from '@gilgamesh/application';
import { Module, type Provider } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { KnowledgeController, OrgKnowledgeController } from './knowledge.controller';
import { KnowledgeSeeder } from './knowledge.seeder';

const T = TOKENS;

const providers: Provider[] = [
  {
    provide: SearchKnowledge,
    useFactory: (knowledge: KnowledgeChunkRepository, brain: AgentBrainPort) =>
      new SearchKnowledge({ knowledge, brain }),
    inject: [T.Knowledge, T.Brain],
  },
  {
    provide: IngestKnowledge,
    useFactory: (knowledge: KnowledgeChunkRepository, brain: AgentBrainPort) =>
      new IngestKnowledge({ knowledge, brain }),
    inject: [T.Knowledge, T.Brain],
  },
  {
    provide: UploadKnowledgeDocument,
    useFactory: (
      documents: KnowledgeDocumentRepository,
      knowledge: KnowledgeChunkRepository,
      brain: AgentBrainPort,
      memberships: MembershipRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new UploadKnowledgeDocument({ documents, knowledge, brain, memberships, ids, clock }),
    inject: [T.KnowledgeDocuments, T.Knowledge, T.Brain, T.Memberships, T.Ids, T.Clock],
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
export class KnowledgeModule {}
