// tools.test.ts — read-only RAG tool (search_docs). Mutating tools are deferred.

import { createSearchDocsTool } from '../../src/agent/tools/search-docs';
import { buildToolRegistry } from '../../src/agent/tools';

describe('search_docs tool', () => {
  it('is read-only and Permit-mapped to docs:read', () => {
    const tool = createSearchDocsTool({ retrieve: jest.fn() } as any);
    expect(tool.name).toBe('search_docs');
    expect(tool.mutating).toBe(false);
    expect(tool.permit).toEqual({ resource: 'docs', action: 'read' });
  });

  it('retrieves chunks and returns them as RagSource citations', async () => {
    const retriever = {
      retrieve: jest.fn().mockResolvedValue([
        {
          text: 'FuzeFront uses Module Federation.',
          source: 'docs/readme.md',
          title: 'README',
          url: 'https://x/readme',
          distance: 0.1,
        },
      ]),
    };
    const tool = createSearchDocsTool(retriever as any);
    const result = await tool.execute({ query: 'what is fuzefront' }, { userId: 'u1', orgId: 'o1' });

    expect(retriever.retrieve).toHaveBeenCalledWith('what is fuzefront', { topK: 5 });
    expect(result.chunks).toHaveLength(1);
    expect(result.sources).toEqual([
      {
        title: 'README',
        url: 'https://x/readme',
        excerpt: 'FuzeFront uses Module Federation.',
      },
    ]);
  });

  it('truncates long excerpts in citations', async () => {
    const longText = 'x'.repeat(500);
    const retriever = {
      retrieve: jest.fn().mockResolvedValue([
        { text: longText, source: 's', title: 't', url: '', distance: 0 },
      ]),
    };
    const tool = createSearchDocsTool(retriever as any);
    const result = await tool.execute({ query: 'q' }, { userId: 'u1', orgId: 'o1' });
    expect(result.sources[0].excerpt.length).toBeLessThanOrEqual(300);
  });
});

describe('buildToolRegistry', () => {
  it('registers search_docs and exposes it by name', () => {
    const registry = buildToolRegistry({ retriever: { retrieve: jest.fn() } as any });
    expect(registry.get('search_docs')).toBeDefined();
    expect(registry.list().map((t) => t.name)).toContain('search_docs');
  });

  it('does not (yet) register mutating tools — those are deferred', () => {
    const registry = buildToolRegistry({ retriever: { retrieve: jest.fn() } as any });
    expect(registry.get('create_org')).toBeUndefined();
    expect(registry.list().every((t) => t.mutating === false)).toBe(true);
  });
});
