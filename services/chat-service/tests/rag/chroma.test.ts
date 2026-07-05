// chroma.test.ts — ChromaDB REST client (all HTTP mocked).

import { ChromaClient } from '../../src/rag/chroma';

type Call = { url: string; method: string; body: any };

function makeFetch(
  handlers: Array<(url: string, init: RequestInit) => { status?: number; json?: unknown }>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i++;
    const result = handler(url, init);
    calls.push({
      url,
      method: (init.method as string) ?? 'GET',
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      statusText: 'OK',
      json: async () => result.json,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('ChromaClient.getOrCreateCollection', () => {
  it('POSTs the collection name and returns the resolved collection id', async () => {
    const { fetch, calls } = makeFetch([
      () => ({ json: { id: 'col-123', name: 'fuzefront-docs-global' } }),
    ]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    const id = await client.getOrCreateCollection('fuzefront-docs-global');
    expect(id).toBe('col-123');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/collections');
    expect(calls[0].body.name).toBe('fuzefront-docs-global');
    expect(calls[0].body.get_or_create).toBe(true);
  });
});

describe('ChromaClient.upsert', () => {
  it('upserts ids/embeddings/documents/metadatas to the collection', async () => {
    const { fetch, calls } = makeFetch([() => ({ json: { success: true } })]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    await client.upsert('col-123', {
      ids: ['a', 'b'],
      embeddings: [[1], [2]],
      documents: ['doc a', 'doc b'],
      metadatas: [{ source: 's1' }, { source: 's2' }],
    });
    expect(calls[0].url).toContain('/collections/col-123/upsert');
    expect(calls[0].body.ids).toEqual(['a', 'b']);
    expect(calls[0].body.embeddings).toEqual([[1], [2]]);
    expect(calls[0].body.documents).toEqual(['doc a', 'doc b']);
  });

  it('is a no-op when there are no ids', async () => {
    const { fetch, calls } = makeFetch([() => ({ json: {} })]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    await client.upsert('col-123', { ids: [], embeddings: [], documents: [], metadatas: [] });
    expect(calls).toHaveLength(0);
  });
});

describe('ChromaClient.query', () => {
  it('queries by embedding and flattens the nested result arrays', async () => {
    const { fetch, calls } = makeFetch([
      () => ({
        json: {
          ids: [['a', 'b']],
          documents: [['doc a', 'doc b']],
          metadatas: [[{ source: 's1' }, { source: 's2' }]],
          distances: [[0.1, 0.2]],
        },
      }),
    ]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    const results = await client.query('col-123', [0.5, 0.5], 2);
    expect(results).toEqual([
      { id: 'a', document: 'doc a', metadata: { source: 's1' }, distance: 0.1 },
      { id: 'b', document: 'doc b', metadata: { source: 's2' }, distance: 0.2 },
    ]);
    expect(calls[0].url).toContain('/collections/col-123/query');
    expect(calls[0].body.query_embeddings).toEqual([[0.5, 0.5]]);
    expect(calls[0].body.n_results).toBe(2);
  });

  it('returns an empty array when the collection has no matches', async () => {
    const { fetch } = makeFetch([
      () => ({ json: { ids: [[]], documents: [[]], metadatas: [[]], distances: [[]] } }),
    ]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    const results = await client.query('col-123', [0.5], 5);
    expect(results).toEqual([]);
  });
});

describe('ChromaClient.getExistingIds', () => {
  it('fetches stored ids for the collection', async () => {
    const { fetch, calls } = makeFetch([() => ({ json: { ids: ['h1', 'h2'] } })]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    const ids = await client.getExistingIds('col-123');
    expect(ids).toEqual(new Set(['h1', 'h2']));
    expect(calls[0].url).toContain('/collections/col-123/get');
  });
});

describe('ChromaClient error handling', () => {
  it('throws on non-2xx', async () => {
    const { fetch } = makeFetch([() => ({ status: 503 })]);
    const client = new ChromaClient({ baseUrl: 'http://chroma:8000', fetchImpl: fetch });
    await expect(client.getOrCreateCollection('x')).rejects.toThrow(/503/);
  });
});
