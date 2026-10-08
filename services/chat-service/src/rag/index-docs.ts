// index-docs.ts — CLI entrypoint for the chat-doc-indexer Job (plan §6b step 5).
//
// Reads Markdown files from the docs directory, runs the idempotent Indexer
// (chunk -> embed via LiteLLM -> upsert to Chroma), and exits. Run by the Helm
// `chat-doc-indexer` post-install/post-upgrade Job, or locally via
// `npm run index:docs`.
//
// Idempotent: re-running over unchanged docs upserts nothing (content-hash ids).
// This file performs real I/O and is intentionally NOT unit-tested against live
// services (the Indexer/chunker/chroma units are tested in isolation with mocks).

import { promises as fs } from 'fs';
import path from 'path';
import { loadConfig } from '../config';
import { LiteLLMClient } from '../llm/litellm';
import { ChromaClient } from '../rag/chroma';
import { Embedder } from '../rag/embedder';
import { Indexer, SourceDoc } from '../rag/indexer';
import { GLOBAL_DOCS_COLLECTION } from '../rag/retriever';

/**
 * True when `candidate` resolves to `root` itself or something beneath it.
 * Used to keep the docs walk inside the indexer's root even if a directory
 * entry ever carries a separator or `..` component.
 */
function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * Recursively collect Markdown files under `dir`, never escaping `root`.
 *
 * `root` is the resolved docs directory (see `run`). Every directory entry is
 * reduced to a bare filename with `path.basename` before it is joined, and the
 * joined path is re-checked against `root`, so no traversal component from the
 * filesystem (or from a `DOCS_DIR` pointing at attacker-writable content) can
 * walk the indexer out of the docs tree and embed arbitrary files.
 */
async function collectMarkdown(dir: string, root: string = path.resolve(dir)): Promise<string[]> {
  const out: string[] = [];
  // Infer the element type from the call rather than annotating with
  // `Awaited<ReturnType<typeof fs.readdir>>` — that resolves to readdir's Buffer
  // overload under @types/node 24 (Dirent became generic), typing entry.name as
  // Buffer. Inferring from the default (utf8) call yields Dirent<string>.
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    // readdir yields a single path component; basename() makes that a guarantee
    // rather than an assumption before it reaches path.join.
    const name = path.basename(entry.name);
    if (name === '' || name === '.' || name === '..') continue;
    const full = path.join(dir, name);
    if (!isInsideRoot(root, full)) continue;
    if (entry.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      out.push(...(await collectMarkdown(full, root)));
    } else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function titleFor(filePath: string): string {
  return path.basename(filePath).replace(/\.md$/i, '');
}

export async function run(docsDir: string): Promise<{ upserted: number; skipped: number }> {
  const config = loadConfig();

  const llm = new LiteLLMClient({
    baseUrl: config.litellmUrl,
    defaultModel: process.env.LITELLM_DEFAULT_MODEL || 'claude-opus-4-5',
    embeddingModel: process.env.LITELLM_EMBEDDING_MODEL || 'text-embedding-3-small',
    masterKey: config.litellmMasterKey,
  });
  const chroma = new ChromaClient({ baseUrl: config.chromaUrl });
  const embedder = new Embedder(llm);
  const indexer = new Indexer(chroma, embedder);

  // Resolve once and use the resolved root as both the walk root and the
  // containment boundary, so `source` stays a stable relative path.
  const docsRoot = path.resolve(docsDir);
  const files = await collectMarkdown(docsRoot, docsRoot);
  const docs: SourceDoc[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    docs.push({ source: path.relative(docsRoot, file), title: titleFor(file), text });
  }

  const summary = await indexer.index(GLOBAL_DOCS_COLLECTION, docs);
  // eslint-disable-next-line no-console
  console.log(
    `[chat-doc-indexer] indexed ${files.length} files: ${summary.upserted} upserted, ${summary.skipped} skipped`,
  );
  return summary;
}

// Direct execution (Job / npm run index:docs).
if (require.main === module) {
  const docsDir = process.env.DOCS_DIR || path.resolve(process.cwd(), 'docs');
  run(docsDir)
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[chat-doc-indexer] failed:', err);
      process.exit(1);
    });
}
