import {
  type AgentBrainPort,
  IngestKnowledge,
  type KnowledgeChunkRepository,
  SearchKnowledge,
} from '@gilgamesh/application';
import { Module, type Provider } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { KnowledgeController } from './knowledge.controller';
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
  KnowledgeSeeder,
];

@Module({
  controllers: [KnowledgeController],
  providers,
})
export class KnowledgeModule {}
