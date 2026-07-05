// chroma.ts — minimal REST client for ChromaDB (plan §3c / §6b).
//
// Targets the Chroma v1 REST API at chromadb.fuzeinfra.svc.cluster.local:8000.
// Only the operations the RAG pipeline needs are implemented:
//   getOrCreateCollection — idempotent collection bootstrap
//   upsert                — add/replace chunk embeddings (indexer)
//   query                 — top-k nearest-neighbour search (retriever)
//   getExistingIds        — read stored ids for idempotent re-indexing
//
// `chat-service` uses query (read-only); the `chat-doc-indexer` Job uses upsert
// (write). The split is enforced at deploy time (§10b), not in this client.
//
// `fetchImpl` is injectable so tests mock all network I/O.

export interface ChromaConfig {
  baseUrl: string;
  /** Optional auth token (CHROMA_SERVER_AUTH_CREDENTIALS) for prod. */
  authToken?: string;
  fetchImpl?: typeof fetch;
}

export interface ChromaUpsert {
  ids: string[];
  embeddings: number[][];
  documents: string[];
  metadatas: Array<Record<string, unknown>>;
}

export interface ChromaQueryResult {
  id: string;
  document: string;
  metadata: Record<string, unknown>;
  distance: number;
}

// Chroma v1 collection routes are under /api/v1.
const API_PREFIX = '/api/v1';

export class ChromaClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ChromaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${API_PREFIX}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Chroma ${method} ${path} failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Get-or-create a collection and return its server-assigned id. */
  async getOrCreateCollection(name: string): Promise<string> {
    const json = await this.request<{ id: string; name: string }>('POST', '/collections', {
      name,
      get_or_create: true,
    });
    return json.id;
  }

  /** Upsert chunk embeddings. No-op when there is nothing to write. */
  async upsert(collectionId: string, data: ChromaUpsert): Promise<void> {
    if (data.ids.length === 0) return;
    await this.request('POST', `/collections/${collectionId}/upsert`, {
      ids: data.ids,
      embeddings: data.embeddings,
      documents: data.documents,
      metadatas: data.metadatas,
    });
  }

  /** Top-k nearest-neighbour search by embedding. */
  async query(
    collectionId: string,
    embedding: number[],
    topK: number,
  ): Promise<ChromaQueryResult[]> {
    const json = await this.request<{
      ids: string[][];
      documents: string[][];
      metadatas: Array<Array<Record<string, unknown>>>;
      distances: number[][];
    }>('POST', `/collections/${collectionId}/query`, {
      query_embeddings: [embedding],
      n_results: topK,
    });

    const ids = json.ids?.[0] ?? [];
    const documents = json.documents?.[0] ?? [];
    const metadatas = json.metadatas?.[0] ?? [];
    const distances = json.distances?.[0] ?? [];

    return ids.map((id, i) => ({
      id,
      document: documents[i] ?? '',
      metadata: metadatas[i] ?? {},
      distance: distances[i] ?? 0,
    }));
  }

  /** Read all stored chunk ids (used for idempotent re-indexing). */
  async getExistingIds(collectionId: string): Promise<Set<string>> {
    const json = await this.request<{ ids: string[] }>('POST', `/collections/${collectionId}/get`, {
      include: [],
    });
    return new Set(json.ids ?? []);
  }
}
