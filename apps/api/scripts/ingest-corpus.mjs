// Seeds the FULL licensed rag/ corpus (rag/chunks/chunks.jsonl, ~2,647 chunks) into the shared
// knowledge base. Idempotent (ON CONFLICT). Run once per environment:
//
//   pnpm --filter @gilgamesh/domain build
//   DATABASE_URL=postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public \
//     node apps/api/scripts/ingest-corpus.mjs
//
// Embeddings (slice 16, keystone v0.5 — vector(1024)):
//   * default/offline: the SAME deterministic embedText/scrubChunk as the app (built
//     @gilgamesh/domain), so stored vectors are comparable to offline query vectors;
//   * with VOYAGE_API_KEY set (and BRAIN_MODE != offline): real Voyage `voyage-4` semantic
//     embeddings, input_type 'document', output_dimension 1024 — matching the app's
//     VoyageBrainEmbedder wire shape so stored vectors are comparable to its query vectors.
//
// (The app also seeds a small paraphrased SAMPLE_CHUNKS at startup; this replaces it with the real corpus.)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { EMBED_DIM, embedText, scrubChunk } from '@gilgamesh/domain';

const MIN_TOKENS = 4;
const tokenCount = (s) => (s.match(/\S+/g) ?? []).length;

const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = process.env.VOYAGE_MODEL?.trim() || 'voyage-4';
const VOYAGE_BATCH = 128;

const here = dirname(fileURLToPath(import.meta.url));
const jsonlPath = resolve(here, '../../../rag/chunks/chunks.jsonl');

/** Embed one batch via Voyage (mirrors VoyageBrainEmbedder: bearer auth, document kind, 1024 dims). */
async function voyageEmbedBatch(apiKey, texts) {
  const res = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'document',
      output_dimension: EMBED_DIM,
    }),
  });
  // Status only — never the response body (and never the key) in the error message.
  if (!res.ok) throw new Error(`The Voyage API responded with status ${res.status}.`);
  const json = await res.json();
  const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== texts.length) {
    throw new Error(`The Voyage API returned ${data.length} embeddings for ${texts.length} inputs.`);
  }
  return data.map((d) => d.embedding);
}

/** Embeds all contents: Voyage in batches when a key is present (and not offline), else lexical. */
async function embedAll(contents) {
  const apiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!apiKey || process.env.BRAIN_MODE === 'offline') {
    console.log(`Embedding ${contents.length} chunks with the deterministic lexical hash (${EMBED_DIM} dims).`);
    return contents.map((c) => embedText(c));
  }
  console.log(`Embedding ${contents.length} chunks via Voyage ${VOYAGE_MODEL} (${EMBED_DIM} dims).`);
  const out = [];
  for (let i = 0; i < contents.length; i += VOYAGE_BATCH) {
    out.push(...(await voyageEmbedBatch(apiKey, contents.slice(i, i + VOYAGE_BATCH))));
    if (out.length % (VOYAGE_BATCH * 4) < VOYAGE_BATCH) console.log(`  …${out.length} embedded`);
  }
  return out;
}

async function main() {
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  console.log(`Read ${lines.length} chunks from ${jsonlPath}`);

  // Scrub + drop boilerplate FIRST so the (possibly paid) embedding pass sees only real content.
  const rows = [];
  let skipped = 0;
  for (const line of lines) {
    const raw = JSON.parse(line);
    const content = scrubChunk(String(raw.text ?? ''));
    if (tokenCount(content) < MIN_TOKENS) {
      skipped++;
      continue;
    }
    rows.push({
      id: String(raw.id),
      source: String(raw.source_file ?? 'unknown'),
      headingPath: Array.isArray(raw.heading_path) ? raw.heading_path.map(String) : [],
      section: String(raw.section ?? ''),
      content,
      tokenEstimate: Number(raw.token_estimate ?? tokenCount(content)),
    });
  }

  const embeddings = await embedAll(rows.map((r) => r.content));

  const prisma = new PrismaClient();
  let ingested = 0;
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vec = `[${embeddings[i].join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO knowledge_chunks (id, source, heading_path, section, content, embedding, token_estimate)
        VALUES (${r.id}, ${r.source}, ${r.headingPath}, ${r.section},
                ${r.content}, ${vec}::vector, ${r.tokenEstimate})
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
