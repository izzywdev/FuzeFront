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

/** Recursively collect Markdown files under `dir`. */
async function collectMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...(await collectMarkdown(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
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

  const files = await collectMarkdown(docsDir);
  const docs: SourceDoc[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    docs.push({ source: path.relative(docsDir, file), title: titleFor(file), text });
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
