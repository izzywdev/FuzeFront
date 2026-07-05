// search-docs.ts — read-only RAG tool (plan §6c, §6d: docs:read, no mutation).
//
// Wraps the Retriever: embeds the query, fetches top-k chunks, and returns both
// the raw chunks (for the model's context) and a citation list (RagSource[]) for
// the `rag_sources` SSE event. Being read-only, it runs inline without a
// confirmation gate.

import type { AgentTool, ToolContext } from './types';
import type { Chunk, Retriever } from '../../rag/retriever';

export interface SearchDocsArgs {
  query: string;
  topK?: number;
}

export interface RagSource {
  title: string;
  url: string;
  excerpt: string;
}

export interface SearchDocsResult {
  chunks: Chunk[];
  sources: RagSource[];
}

const EXCERPT_MAX = 300;
const DEFAULT_TOP_K = 5;

export function createSearchDocsTool(
  retriever: Pick<Retriever, 'retrieve'>,
): AgentTool<SearchDocsArgs, SearchDocsResult> {
  return {
    name: 'search_docs',
    description:
      'Search the FuzeFront product documentation for passages relevant to a query. ' +
      'Use this to ground answers about FuzeFront features, architecture, and setup.',
    mutating: false,
    permit: { resource: 'docs', action: 'read' },
    async execute(args: SearchDocsArgs, _ctx: ToolContext): Promise<SearchDocsResult> {
      const chunks = await retriever.retrieve(args.query, { topK: args.topK ?? DEFAULT_TOP_K });
      const sources: RagSource[] = chunks.map((c) => ({
        title: c.title,
        url: c.url,
        excerpt: c.text.length > EXCERPT_MAX ? c.text.slice(0, EXCERPT_MAX) : c.text,
      }));
      return { chunks, sources };
    },
  };
}
