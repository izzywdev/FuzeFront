// indexer.test.ts — RAG ingestion is idempotent by content hash (mocks for I/O).

import { Indexer } from '../../src/rag/indexer';

function makeMocks(existingIds: string[] = []) {
  const chroma = {
    getOrCreateCollection: jest.fn().mockResolvedValue('col-1'),
    getExistingIds: jest.fn().mockResolvedValue(new Set(existingIds)),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const embedder = {
    embedDocuments: jest.fn().mockImplementation(async (texts: string[]) => texts.map(() => [0.1])),
  };
  return { chroma, embedder };
}

const DOCS = [
  { source: 'docs/a.md', title: 'A', text: 'short doc a' },
  { source: 'docs/b.md', title: 'B', text: 'short doc b' },
];

describe('Indexer.index', () => {
  it('chunks, embeds and upserts all chunks on a fresh collection', async () => {
    const { chroma, embedder } = makeMocks([]);
    const indexer = new Indexer(chroma as any, embedder as any, {
      chunkSize: 100,
      overlap: 0,
    });

    const summary = await indexer.index('fuzefront-docs-global', DOCS);

    expect(chroma.getOrCreateCollection).toHaveBeenCalledWith('fuzefront-docs-global');
    expect(embedder.embedDocuments).toHaveBeenCalledTimes(1);
    expect(chroma.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = chroma.upsert.mock.calls[0][1];
    expect(upsertArg.ids).toHaveLength(2);
    // ids are deterministic content hashes
    expect(upsertArg.ids[0]).toMatch(/^[a-f0-9]+$/);
    expect(summary.upserted).toBe(2);
    expect(summary.skipped).toBe(0);
  });

  it('is idempotent — a second run with identical content upserts nothing', async () => {
    // First run with empty collection to learn the deterministic ids.
    const first = makeMocks([]);
    const indexer1 = new Indexer(first.chroma as any, first.embedder as any, {
      chunkSize: 100,
      overlap: 0,
    });
    await indexer1.index('fuzefront-docs-global', DOCS);
    const generatedIds: string[] = first.chroma.upsert.mock.calls[0][1].ids;

    // Second run: collection already holds those ids.
    const second = makeMocks(generatedIds);
    const indexer2 = new Indexer(second.chroma as any, second.embedder as any, {
      chunkSize: 100,
      overlap: 0,
    });
    const summary = await indexer2.index('fuzefront-docs-global', DOCS);

    expect(second.embedder.embedDocuments).not.toHaveBeenCalled();
    expect(second.chroma.upsert).not.toHaveBeenCalled();
    expect(summary.upserted).toBe(0);
    expect(summary.skipped).toBe(2);
  });

  it('only embeds and upserts the changed/new chunks', async () => {
    const first = makeMocks([]);
    const indexer1 = new Indexer(first.chroma as any, first.embedder as any, {
      chunkSize: 100,
      overlap: 0,
    });
    await indexer1.index('fuzefront-docs-global', DOCS);
    const idA: string = first.chroma.upsert.mock.calls[0][1].ids[0];

    // Collection already has chunk A only; B is new.
    const second = makeMocks([idA]);
    const indexer2 = new Indexer(second.chroma as any, second.embedder as any, {
      chunkSize: 100,
      overlap: 0,
    });
    const summary = await indexer2.index('fuzefront-docs-global', DOCS);

    expect(second.embedder.embedDocuments).toHaveBeenCalledTimes(1);
    expect(second.embedder.embedDocuments.mock.calls[0][0]).toEqual(['short doc b']);
    expect(summary.upserted).toBe(1);
    expect(summary.skipped).toBe(1);
  });
});
