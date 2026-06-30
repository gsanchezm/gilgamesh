import { IngestKnowledge, type KnowledgeChunkRepository } from '@gilgamesh/application';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { SAMPLE_CHUNKS } from './sample-corpus';

/**
 * Seeds the small paraphrased {@link SAMPLE_CHUNKS} into the shared KB at startup IF it is empty, so search +
 * grounding work immediately in every wiring. Idempotent: a Postgres KB already populated (sample or the full
 * `rag/` corpus via `scripts/ingest-corpus.ts`) is left untouched.
 */
@Injectable()
export class KnowledgeSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeSeeder.name);

  constructor(
    private readonly ingest: IngestKnowledge,
    @Inject(TOKENS.Knowledge) private readonly knowledge: KnowledgeChunkRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((await this.knowledge.count()) > 0) return;
    const { ingested } = await this.ingest.execute(SAMPLE_CHUNKS);
    this.logger.log(`Seeded ${ingested} sample knowledge chunks into the shared KB.`);
  }
}
