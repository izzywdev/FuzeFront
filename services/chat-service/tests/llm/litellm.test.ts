// litellm.test.ts — LiteLLM OpenAI-compatible client (chat completions + embeddings).
// All HTTP is mocked via a stubbed fetch; no live gateway is contacted.

import { LiteLLMClient } from '../../src/llm/litellm';

type FetchArgs = { url: string; init: RequestInit };

function mockFetchOnce(response: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  body?: ReadableStream<Uint8Array> | null;
}): { fetch: typeof fetch; calls: FetchArgs[] } {
  const calls: FetchArgs[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: 'OK',
      json: async () => response.json,
      body: response.body ?? null,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('LiteLLMClient.embed', () => {
  it('POSTs to /embeddings with the configured model and returns the vector', async () => {
    const { fetch, calls } = mockFetchOnce({
      json: { data: [{ embedding: [0.1, 0.2, 0.3] }] },
    });
    const client = new LiteLLMClient({
      baseUrl: 'http://litellm:4000',
      embeddingModel: 'text-embedding-3-small',
      defaultModel: 'claude',
      fetchImpl: fetch,
    });

    const vec = await client.embed('hello world');

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://litellm:4000/embeddings');
    const sentBody = JSON.parse(calls[0].init.body as string);
    expect(sentBody.model).toBe('text-embedding-3-small');
    expect(sentBody.input).toBe('hello world');
  });

  it('sends the master key as a Bearer token when provided', async () => {
    const { fetch, calls } = mockFetchOnce({ json: { data: [{ embedding: [1] }] } });
    const client = new LiteLLMClient({
      baseUrl: 'http://litellm:4000',
      embeddingModel: 'm',
      defaultModel: 'd',
      masterKey: 'sk-master',
      fetchImpl: fetch,
    });
    await client.embed('x');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-master');
  });

  it('throws on a non-2xx response', async () => {
    const { fetch } = mockFetchOnce({ ok: false, status: 500 });
    const client = new LiteLLMClient({
      baseUrl: 'http://litellm:4000',
      embeddingModel: 'm',
      defaultModel: 'd',
      fetchImpl: fetch,
    });
    await expect(client.embed('x')).rejects.toThrow(/500/);
  });
});

describe('LiteLLMClient.chatCompletion (non-streaming)', () => {
  it('returns content and usage from the OpenAI-compat response', async () => {
    const { fetch, calls } = mockFetchOnce({
      json: {
        model: 'claude-x',
        choices: [{ message: { role: 'assistant', content: 'Hi there' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });
    const client = new LiteLLMClient({
      baseUrl: 'http://litellm:4000',
      embeddingModel: 'm',
      defaultModel: 'claude-default',
      fetchImpl: fetch,
    });

    const res = await client.chatCompletion({
      system: 'be helpful',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.content).toBe('Hi there');
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(res.model).toBe('claude-x');
    expect(calls[0].url).toBe('http://litellm:4000/chat/completions');
    const body = JSON.parse(calls[0].init.body as string);
    // system prompt must be the first message with role=system (structurally separated)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be helpful' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.model).toBe('claude-default');
    expect(body.stream).toBeFalsy();
  });
});

describe('LiteLLMClient.streamChatCompletion', () => {
  it('yields text deltas parsed from the OpenAI SSE chunk stream and final usage', async () => {
    // Build an SSE byte stream of OpenAI streaming chunks.
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    const { fetch } = mockFetchOnce({ body: stream });
    const client = new LiteLLMClient({
      baseUrl: 'http://litellm:4000',
      embeddingModel: 'm',
      defaultModel: 'd',
      fetchImpl: fetch,
    });

    const deltas: string[] = [];
    let usage;
    for await (const ev of client.streamChatCompletion({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (ev.type === 'delta') deltas.push(ev.text);
      if (ev.type === 'usage') usage = ev.usage;
    }

    expect(deltas.join('')).toBe('Hello');
    expect(usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  });
});
