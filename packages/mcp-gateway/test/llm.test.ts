import { describe, it, expect, vi } from 'vitest';
import {
  resolveLlmGatewayConfig,
  sanitizeGeneratedProse,
  describeOperation,
  buildUserPrompt,
  buildSystemPrompt,
} from '../src/llm.js';

describe('resolveLlmGatewayConfig', () => {
  it('returns undefined when LITELLM_FUZE_KEY is not set — degrade honestly, never fabricate a key', () => {
    expect(resolveLlmGatewayConfig({})).toBeUndefined();
  });

  it('defaults FUZE_LLM_BASE_URL to the in-cluster LiteLLM gateway', () => {
    const cfg = resolveLlmGatewayConfig({ LITELLM_FUZE_KEY: 'sk-test' });
    expect(cfg?.baseUrl).toBe('http://litellm.fuzeinfra.svc.cluster.local:4000');
    expect(cfg?.model).toBe('gpt-4o-mini');
  });

  it('honours an explicit FUZE_LLM_BASE_URL and model override', () => {
    const cfg = resolveLlmGatewayConfig({
      LITELLM_FUZE_KEY: 'sk-test',
      FUZE_LLM_BASE_URL: 'http://litellm.example:4000',
      MCP_DESCRIPTIONS_MODEL: 'claude-haiku',
    });
    expect(cfg).toEqual({
      baseUrl: 'http://litellm.example:4000',
      apiKey: 'sk-test',
      model: 'claude-haiku',
    });
  });
});

describe('sanitizeGeneratedProse', () => {
  it('strips safety-claim words a completion might still emit', () => {
    const dirty = 'This read-only and completely safe operation lists apps; it is reversible.';
    const clean = sanitizeGeneratedProse(dirty);
    expect(clean.toLowerCase()).not.toMatch(/read-only|safe|reversible/);
    expect(clean).toContain('lists apps');
  });

  it('collapses whitespace left behind by stripping', () => {
    expect(sanitizeGeneratedProse('Lists   apps.')).toBe('Lists apps.');
  });

  it('leaves ordinary prose with no safety claims untouched', () => {
    expect(sanitizeGeneratedProse('Registers a new app from its manifest.')).toBe(
      'Registers a new app from its manifest.'
    );
  });
});

describe('prompt construction never asserts a classification the model could echo back as fact', () => {
  it('the system prompt forbids safety claims outright', () => {
    expect(buildSystemPrompt()).toMatch(/NEVER assert/i);
  });

  it('the user prompt carries context but not an instruction to restate mutates/reversibility', () => {
    const prompt = buildUserPrompt({
      toolName: 'deleteApp',
      method: 'delete',
      path: '/apps/{slug}',
      mutates: true,
      reversibility: 'irreversible',
      specSummary: 'Delete a registered app',
    });
    expect(prompt).toContain('DELETE /apps/{slug}');
    expect(prompt).not.toMatch(/mutates|reversibility|irreversible/i);
  });
});

describe('describeOperation', () => {
  it('sanitizes the completion before returning it', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'This safe, read-only call lists every app.' } }],
      }),
    })) as unknown as typeof fetch;

    const result = await describeOperation(
      { baseUrl: 'http://litellm.test:4000', apiKey: 'sk-test', model: 'gpt-4o-mini', fetchImpl },
      { toolName: 'listApps', method: 'get', path: '/apps', mutates: false, reversibility: 'reversible' }
    );

    expect(result.toLowerCase()).not.toMatch(/safe|read-only/);
    expect(result).toContain('lists every app');

    // Routed through LiteLLM's OpenAI-compatible surface with a Bearer virtual key.
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://litellm.test:4000/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('throws (never fabricates a description) when the gateway call fails', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'upstream unavailable',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(
      describeOperation(
        { baseUrl: 'http://litellm.test:4000', apiKey: 'sk-test', model: 'gpt-4o-mini', fetchImpl },
        { toolName: 'listApps', method: 'get', path: '/apps', mutates: false, reversibility: 'reversible' }
      )
    ).rejects.toThrow(/failed \(503\)/);
  });

  it('throws when the response has nothing left after stripping safety claims', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ choices: [{ message: { content: 'safe reversible read-only' } }] }),
    })) as unknown as typeof fetch;

    await expect(
      describeOperation(
        { baseUrl: 'http://litellm.test:4000', apiKey: 'sk-test', model: 'gpt-4o-mini', fetchImpl },
        { toolName: 'listApps', method: 'get', path: '/apps', mutates: false, reversibility: 'reversible' }
      )
    ).rejects.toThrow(/empty after stripping/);
  });
});
