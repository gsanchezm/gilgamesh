/**
 * Pure text chunker for per-org uploaded documents (.md / .txt). Splits on blank-line paragraph
 * boundaries, greedily packing paragraphs up to `maxChars`; a single oversized paragraph is hard-split.
 * A markdown heading line (`# …`) becomes the `section` for the chunks that follow it (used as the
 * citation section). No framework imports (Clean Architecture).
 */
export interface TextChunk {
  section: string;
  text: string;
}

const DEFAULT_MAX_CHARS = 900;
const DEFAULT_SECTION = 'Document';

export function chunkText(text: string, opts?: { maxChars?: number }): TextChunk[] {
  const maxChars = Math.max(1, Math.trunc(opts?.maxChars ?? DEFAULT_MAX_CHARS));
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);

  const out: TextChunk[] = [];
  let section = DEFAULT_SECTION;
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push({ section, text: buf });
    buf = '';
  };

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    // A standalone markdown heading sets the section for the chunks that follow (not emitted as text).
    const heading = block.includes('\n') ? null : block.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flush();
      section = heading[1]!.trim();
      continue;
    }

    // A paragraph larger than the limit is hard-split into fixed-size pieces (content preserved exactly).
    if (block.length > maxChars) {
      flush();
      for (let i = 0; i < block.length; i += maxChars) {
        out.push({ section, text: block.slice(i, i + maxChars) });
      }
      continue;
    }

    const candidate = buf ? `${buf}\n\n${block}` : block;
    if (candidate.length <= maxChars) {
      buf = candidate;
    } else {
      flush();
      buf = block;
    }
  }
  flush();
  return out;
}
