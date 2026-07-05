// loop.test.ts — agent orchestration: RAG retrieve -> rag_sources -> text deltas
// -> done, plus usage reporting. All collaborators mocked. The event stream
// matches the chat-client SSE union (rag_sources, text_delta, done).

import { runAgentTurn } from '../../src/agent/loop';

function fakeLlm(deltas: string[], usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }) {
  return {
    async *streamChatCompletion() {
      for (const d of deltas) yield { type: 'delta' as const, text: d };
      yield { type: 'usage' as const, usage };
    },
  };
}

function fakeSearchTool(sources: any[]) {
  return {
    name: 'search_docs',
    mutating: false,
    permit: { resource: 'docs', action: 'read' },
    execute: jest.fn().mockResolvedValue({
      chunks: sources.map((s) => ({ text: s.excerpt, source: s.url, title: s.title, url: s.url, distance: 0 })),
      sources,
    }),
  };
}

describe('runAgentTurn', () => {
  const ctx = { userId: 'u1', orgId: 'o1', conversationId: 'c1' };

  it('emits rag_sources first, then text_delta events in order, then done', async () => {
    const sources = [{ title: 'README', url: 'https://x', excerpt: 'FuzeFront docs' }];
    const events: any[] = [];
    let reportedUsage;

    await runAgentTurn(
      {
        llm: fakeLlm(['Hel', 'lo']) as any,
        searchTool: fakeSearchTool(sources) as any,
        registry: { list: () => [] } as any,
      },
      { messages: [{ role: 'user', content: 'what is fuzefront' }], ...ctx },
      {
        emit: (e) => events.push(e),
        onUsage: (u) => {
          reportedUsage = u;
        },
      },
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('rag_sources');
    expect(events[0].sources).toEqual(sources);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(types[types.length - 1]).toBe('done');
    expect(reportedUsage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('sanitizes the user message before sending it to the LLM', async () => {
    const llm = fakeLlm(['ok']);
    const spy = jest.spyOn(llm, 'streamChatCompletion');
    const sources: any[] = [];
    await runAgentTurn(
      { llm: llm as any, searchTool: fakeSearchTool(sources) as any, registry: { list: () => [] } as any },
      {
        messages: [{ role: 'user', content: 'hello' + String.fromCharCode(0) + 'world' }],
        ...ctx,
      },
      { emit: () => {}, onUsage: () => {} },
    );
    const call = (spy.mock.calls as any[])[0][0] as any;
    const lastUser = call.messages[call.messages.length - 1];
    expect(lastUser.content).not.toContain(String.fromCharCode(0));
  });

  it('does not emit rag_sources when retrieval returns nothing', async () => {
    const events: any[] = [];
    await runAgentTurn(
      { llm: fakeLlm(['hi']) as any, searchTool: fakeSearchTool([]) as any, registry: { list: () => [] } as any },
      { messages: [{ role: 'user', content: 'q' }], ...ctx },
      { emit: (e) => events.push(e), onUsage: () => {} },
    );
    expect(events.some((e) => e.type === 'rag_sources')).toBe(false);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('emits an error event and done if the LLM stream throws', async () => {
    const brokenLlm = {
      async *streamChatCompletion() {
        throw new Error('gateway exploded');
        // eslint-disable-next-line no-unreachable
        yield { type: 'delta', text: 'x' };
      },
    };
    const events: any[] = [];
    await runAgentTurn(
      { llm: brokenLlm as any, searchTool: fakeSearchTool([]) as any, registry: { list: () => [] } as any },
      { messages: [{ role: 'user', content: 'q' }], ...ctx },
      { emit: (e) => events.push(e), onUsage: () => {} },
    );
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });
});
