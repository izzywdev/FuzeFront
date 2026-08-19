// retriever.test.ts — query embedding + Chroma top-k → typed Chunk[] (mocks).

import { Retriever } from '../../src/rag/retriever';

describe('Retriever.retrieve', () => {
  it('embeds the query, queries the global collection top-k and maps results to Chunks', async () => {
    const embedder = { embedQuery: jest.fn().mockResolvedValue([0.4, 0.6]) };
    const chroma = {
      getOrCreateCollection: jest.fn().mockResolvedValue('col-1'),
      query: jest.fn().mockResolvedValue([
        {
          id: 'h1',
          document: 'FuzeFront is a microfrontend platform.',
          metadata: { source: 'docs/readme.md', title: 'README', url: 'https://x/readme' },
          distance: 0.12,
        },
      ]),
    };
    const retriever = new Retriever(chroma as any, embedder as any);

    const chunks = await retriever.retrieve('what is fuzefront', { topK: 5 });

    expect(embedder.embedQuery).toHaveBeenCalledWith('what is fuzefront');
    expect(chroma.query).toHaveBeenCalledWith('col-1', [0.4, 0.6], 5);
    expect(chunks).toEqual([
      {
        text: 'FuzeFront is a microfrontend platform.',
        source: 'docs/readme.md',
        title: 'README',
        url: 'https://x/readme',
        distance: 0.12,
      },
    ]);
  });

  it('defaults topK to 5', async () => {
    const embedder = { embedQuery: jest.fn().mockResolvedValue([0.1]) };
    const chroma = {
      getOrCreateCollection: jest.fn().mockResolvedValue('col-1'),
      query: jest.fn().mockResolvedValue([]),
    };
    const retriever = new Retriever(chroma as any, embedder as any);
    await retriever.retrieve('q', {});
    expect(chroma.query).toHaveBeenCalledWith('col-1', [0.1], 5);
  });

  it('uses the global docs collection name', async () => {
    const embedder = { embedQuery: jest.fn().mockResolvedValue([0.1]) };
    const chroma = {
      getOrCreateCollection: jest.fn().mockResolvedValue('col-1'),
      query: jest.fn().mockResolvedValue([]),
    };
    const retriever = new Retriever(chroma as any, embedder as any);
    await retriever.retrieve('q', {});
    expect(chroma.getOrCreateCollection).toHaveBeenCalledWith('fuzefront-docs-global');
  });

  it('returns an empty array when nothing matches', async () => {
    const embedder = { embedQuery: jest.fn().mockResolvedValue([0.1]) };
    const chroma = {
      getOrCreateCollection: jest.fn().mockResolvedValue('col-1'),
      query: jest.fn().mockResolvedValue([]),
    };
    const retriever = new Retriever(chroma as any, embedder as any);
    const chunks = await retriever.retrieve('nope', { topK: 3 });
    expect(chunks).toEqual([]);
  });
});
