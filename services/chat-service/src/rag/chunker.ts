// chunker.ts — deterministic sliding-window text splitter with separator snapping
// (plan §6b).
//
// Algorithm: a fixed sliding window of `chunkSize` characters advancing by
// `chunkSize - overlap`, where each window's end is "snapped" back to the
// nearest preceding semantic boundary (paragraph → line → sentence → word)
// when one exists within the window. This guarantees:
//   - every chunk is ≤ chunkSize characters,
//   - consecutive chunks overlap (the next window starts `overlap` chars before
//     the previous window's *raw* end),
//   - boundaries prefer paragraph/sentence breaks for retrieval quality,
//   - output is fully deterministic (idempotent re-indexing depends on this).
//
// Sizes are in characters — a cheap, deterministic proxy for tokens at the
// doc-scale corpus this serves (~4 chars/token). The plan's "512-token / 64
// overlap" maps to roughly chunkSize 2048 / overlap 256 by default.

export interface ChunkOptions {
  /** Maximum chunk length in characters. */
  chunkSize: number;
  /** Characters of overlap carried from the end of one chunk into the next. */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 2048,
  overlap: 256,
};

// Boundary markers searched (coarsest first). We snap a window end to the last
// occurrence of one of these within the window.
const BOUNDARY_PATTERNS = ['\n\n', '\n', '. ', ' '];

export function chunkText(text: string, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= opts.chunkSize) return [normalized];

  const { chunkSize, overlap } = opts;
  const step = Math.max(1, chunkSize - overlap);

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const rawEnd = Math.min(start + chunkSize, normalized.length);
    let end = rawEnd;

    // Snap end back to the nearest boundary inside (start, rawEnd) — but only
    // when not consuming the rest of the string (the final window keeps its tail).
    if (rawEnd < normalized.length) {
      end = snapToBoundary(normalized, start, rawEnd);
    }

    const chunk = normalized.slice(start, end);
    chunks.push(chunk);

    if (end >= normalized.length) break;

    // Advance: next window begins `overlap` chars before the *raw* window end so
    // that overlap is preserved regardless of snapping.
    const next = rawEnd - overlap;
    // Guard against non-advancement (tiny snaps / huge overlap).
    start = next > start ? next : start + step;
  }

  return chunks;
}

/**
 * Return an index in (start, rawEnd] at the last boundary found within the
 * window, or rawEnd if none is found. The boundary index is placed *after* the
 * separator so the separator stays with the preceding chunk.
 */
function snapToBoundary(text: string, start: number, rawEnd: number): number {
  for (const sep of BOUNDARY_PATTERNS) {
    const idx = text.lastIndexOf(sep, rawEnd - 1);
    if (idx > start) {
      return idx + sep.length;
    }
  }
  return rawEnd;
}
