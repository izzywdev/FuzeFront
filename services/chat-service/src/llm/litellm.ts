// litellm.ts — thin client for the self-hosted LiteLLM gateway (OpenAI-compatible).
//
// We adopt the gateway (plan §3b) rather than any provider SDK: LiteLLM exposes
//   POST /chat/completions   (OpenAI chat-completions, streaming + non-streaming)
//   POST /embeddings         (OpenAI embeddings)
// The default model (Claude) and embedding model are resolved at the gateway by
// model name; this client never talks to Anthropic/OpenAI directly.
//
// The system prompt is passed as a structurally-separate `system`-role message
// (§10a) — never concatenated with user content.
//
// `fetchImpl` is injectable so tests can mock all network I/O.

export interface LiteLLMConfig {
  baseUrl: string;
  defaultModel: string;
  embeddingModel: string;
  /** LITELLM_MASTER_KEY — guards the proxy. Sent as Bearer when present. */
  masterKey?: string;
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionRequest {
  /** System prompt, kept separate from user content. */
  system: string;
  messages: ChatMessage[];
  /** Override the gateway default model for this call. */
  model?: string;
  temperature?: number;
}

export interface ChatCompletionResult {
  content: string;
  usage: TokenUsage;
  model: string;
}

export type ChatStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: TokenUsage };

export class LiteLLMClient {
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;
  private readonly masterKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LiteLLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.defaultModel = config.defaultModel;
    this.embeddingModel = config.embeddingModel;
    this.masterKey = config.masterKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.masterKey) h['Authorization'] = `Bearer ${this.masterKey}`;
    return h;
  }

  /** Embed a single text into a float vector via the gateway embeddings endpoint. */
  async embed(text: string): Promise<number[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.embeddingModel, input: text }),
    });
    if (!res.ok) {
      throw new Error(`LiteLLM /embeddings failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data[0].embedding;
  }

  /** Non-streaming chat completion. Returns full content + token usage. */
  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req, false)),
    });
    if (!res.ok) {
      throw new Error(`LiteLLM /chat/completions failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    return {
      content: json.choices[0]?.message?.content ?? '',
      usage: normalizeUsage(json.usage),
      model: json.model,
    };
  }

  /**
   * Streaming chat completion. Yields `{type:'delta'}` per token chunk and a
   * final `{type:'usage'}` when the gateway reports usage (LiteLLM emits usage
   * on the terminal chunk when stream_options.include_usage is set).
   */
  async *streamChatCompletion(req: ChatCompletionRequest): AsyncGenerator<ChatStreamChunk> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req, true)),
    });
    if (!res.ok) {
      throw new Error(`LiteLLM /chat/completions (stream) failed: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error('LiteLLM stream returned no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on SSE record boundary (\n\n). Keep the trailing partial record.
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const record = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const chunk = this.parseSSERecord(record);
          if (chunk) yield chunk;
        }
      }
      // Flush any final record without a trailing boundary.
      const tail = buffer.trim();
      if (tail) {
        const chunk = this.parseSSERecord(tail);
        if (chunk) yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildBody(req: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
    const messages: ChatMessage[] = [
      { role: 'system', content: req.system },
      ...req.messages,
    ];
    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      messages,
    };
    if (typeof req.temperature === 'number') body.temperature = req.temperature;
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  /** Parse one SSE record (possibly multiple `data:` lines) into a stream chunk. */
  private parseSSERecord(record: string): ChatStreamChunk | null {
    for (const line of record.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice('data:'.length).trim();
      if (!data || data === '[DONE]') continue;
      let parsed: {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (parsed.usage) {
        return { type: 'usage', usage: normalizeUsage(parsed.usage) };
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        return { type: 'delta', text: delta };
      }
    }
    return null;
  }
}

function normalizeUsage(u?: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}): TokenUsage {
  return {
    promptTokens: u?.prompt_tokens ?? 0,
    completionTokens: u?.completion_tokens ?? 0,
    totalTokens: u?.total_tokens ?? 0,
  };
}
