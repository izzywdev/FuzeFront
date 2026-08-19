// retriever.ts — query-time RAG retrieval (plan §6b / §6c read path).
//
// Embeds the user query, runs a top-k nearest-neighbour search against the
// global product-docs collection, and maps Chroma hits to typed `Chunk`s the
// agent/prompt layer consumes. Read-only — `chat-service` never writes to Chroma.
//
// Org-scoped collections (fuzefront-docs-{orgId}) are an open question (plan
// §13.3); for now retrieval is against the global collection only.

export const GLOBAL_DOCS_COLLECTION = 'fuzefront-docs-global';
export const DEFAULT_TOP_K = 5;

export interface Chunk {
  text: string;
  source: string;
  title: string;
  url: string;
  distance: number;
}

export interface RetrieveOptions {
  topK?: number;
}

interface ChromaReader {
  getOrCreateCollection(name: string): Promise<string>;
  query(
    collectionId: string,
    embedding: number[],
    topK: number,
  ): Promise<
    Array<{ id: string; document: string; metadata: Record<string, unknown>; distance: number }>
  >;
}

interface QueryEmbedder {
  embedQuery(text: string): Promise<number[]>;
}

export class Retriever {
  constructor(
    private readonly chroma: ChromaReader,
    private readonly embedder: QueryEmbedder,
  ) {}

  async retrieve(query: string, opts: RetrieveOptions): Promise<Chunk[]> {
    const topK = opts.topK ?? DEFAULT_TOP_K;
    const embedding = await this.embedder.embedQuery(query);
    const collectionId = await this.chroma.getOrCreateCollection(GLOBAL_DOCS_COLLECTION);
    const hits = await this.chroma.query(collectionId, embedding, topK);

    return hits.map((hit) => ({
      text: hit.document,
      source: String(hit.metadata.source ?? ''),
      title: String(hit.metadata.title ?? ''),
      url: String(hit.metadata.url ?? ''),
      distance: hit.distance,
    }));
  }
}
