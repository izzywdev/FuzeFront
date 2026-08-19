// embedder.test.ts — Embedder delegates to the LiteLLM client (mocked).

import { Embedder } from '../../src/rag/embedder';

describe('Embedder', () => {
  it('embeds a single text via the LiteLLM client', async () => {
    const llm = { embed: jest.fn().mockResolvedValue([0.1, 0.2]) };
    const embedder = new Embedder(llm as any);
    const vec = await embedder.embedQuery('what is fuzefront');
    expect(vec).toEqual([0.1, 0.2]);
    expect(llm.embed).toHaveBeenCalledWith('what is fuzefront');
  });

  it('embeds a batch of documents preserving order', async () => {
    const llm = {
      embed: jest
        .fn()
        .mockResolvedValueOnce([1])
        .mockResolvedValueOnce([2])
        .mockResolvedValueOnce([3]),
    };
    const embedder = new Embedder(llm as any);
    const vecs = await embedder.embedDocuments(['a', 'b', 'c']);
    expect(vecs).toEqual([[1], [2], [3]]);
    expect(llm.embed).toHaveBeenCalledTimes(3);
  });

  it('propagates errors from the LiteLLM client', async () => {
    const llm = { embed: jest.fn().mockRejectedValue(new Error('gateway down')) };
    const embedder = new Embedder(llm as any);
    await expect(embedder.embedQuery('x')).rejects.toThrow('gateway down');
  });
});
