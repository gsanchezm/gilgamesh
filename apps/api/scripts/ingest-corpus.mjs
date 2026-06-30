// Seeds the FULL licensed rag/ corpus (rag/chunks/chunks.jsonl, ~2,647 chunks) into the shared
// knowledge base. Reuses the SAME embedText/scrubChunk as the app (built @gilgamesh/domain) so the
// stored vectors are comparable to query vectors. Idempotent (ON CONFLICT). Run once per environment:
//
//   pnpm --filter @gilgamesh/domain build
//   DATABASE_URL=postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public \
//     node apps/api/scripts/ingest-corpus.mjs
//
// (The app also seeds a small paraphrased SAMPLE_CHUNKS at startup; this replaces it with the real corpus.)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { embedText, scrubChunk } from '@gilgamesh/domain';

const MIN_TOKENS = 4;
const tokenCount = (s) => (s.match(/\S+/g) ?? []).length;

const here = dirname(fileURLToPath(import.meta.url));
const jsonlPath = resolve(here, '../../../rag/chunks/chunks.jsonl');

async function main() {
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  console.log(`Read ${lines.length} chunks from ${jsonlPath}`);

  const prisma = new PrismaClient();
  let ingested = 0;
  let skipped = 0;

  try {
    for (let i = 0; i < lines.length; i++) {
      const raw = JSON.parse(lines[i]);
      const content = scrubChunk(String(raw.text ?? ''));
      if (tokenCount(content) < MIN_TOKENS) {
        skipped++;
        continue;
      }
      const headingPath = Array.isArray(raw.heading_path) ? raw.heading_path.map(String) : [];
      const vec = `[${embedText(content).join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO knowledge_chunks (id, source, heading_path, section, content, embedding, token_estimate)
        VALUES (${String(raw.id)}, ${String(raw.source_file ?? 'unknown')}, ${headingPath}, ${String(raw.section ?? '')},
                ${content}, ${vec}::vector, ${Number(raw.token_estimate ?? tokenCount(content))})
        ON CONFLICT (id) DO UPDATE SET
          source = EXCLUDED.source, heading_path = EXCLUDED.heading_path, section = EXCLUDED.section,
          content = EXCLUDED.content, embedding = EXCLUDED.embedding, token_estimate = EXCLUDED.token_estimate`;
      ingested++;
      if (ingested % 250 === 0) console.log(`  …${ingested} ingested`);
    }
    const total = await prisma.knowledgeChunk.count();
    console.log(`Done. Ingested ${ingested}, skipped ${skipped} (boilerplate). KB now holds ${total} chunks.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
