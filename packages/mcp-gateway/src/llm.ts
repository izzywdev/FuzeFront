/**
 * Build-time LLM client for tool-description generation.
 *
 * Imported ONLY by scripts/generate-descriptions.mjs — the offline generator
 * — never by the gateway's request-serving path (config.ts / server.ts /
 * main.ts). A pod answering `tools/list` must never call an LLM to do it; see
 * descriptions.ts for the full rationale.
 *
 * VENDOR INDEPENDENCE: routed through the self-hosted LiteLLM gateway, never a
 * vendor SDK directly — the family rule (baseline §10 / the `feature-flags`
 * and LLM-usage conventions this repo already follows in
 * services/chat-service/src/llm/litellm.ts and packages/i18n-translate).
 * `FUZE_LLM_BASE_URL` is the vendor-agnostic name this family declares (see
 * .github/workflows/{a2a,mcp}-maintain.yml); `LITELLM_FUZE_KEY` is a LiteLLM
 * VIRTUAL key, never a provider key, so it can be revoked centrally.
 */

export interface LlmGatewayConfig {
  /** e.g. http://litellm.fuzeinfra.svc.cluster.local:4000 */
  baseUrl: string;
  /** LITELLM_FUZE_KEY — a LiteLLM virtual key, sent as a Bearer token. */
  apiKey: string;
  /** Model name routed by LiteLLM, e.g. "gpt-4o-mini". */
  model: string;
  /** Injected fetch (tests only; defaults to global fetch). */
  fetchImpl?: typeof fetch;
  temperature?: number;
}

const DEFAULT_GATEWAY = 'http://litellm.fuzeinfra.svc.cluster.local:4000';
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Resolve LiteLLM settings from the environment. Returns undefined — rather
 * than throwing — when no key is configured, so the caller can degrade
 * honestly (skip generation, keep the existing/spec-derived descriptions)
 * instead of crashing a build that never needed to touch an LLM.
 */
export function resolveLlmGatewayConfig(env: NodeJS.ProcessEnv = process.env): LlmGatewayConfig | undefined {
  const apiKey = env.LITELLM_FUZE_KEY;
  if (!apiKey || !apiKey.trim()) return undefined;
  return {
    baseUrl: env.FUZE_LLM_BASE_URL?.trim() || DEFAULT_GATEWAY,
    apiKey: apiKey.trim(),
    model: env.MCP_DESCRIPTIONS_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export interface DescribeOperationArgs {
  toolName: string;
  method: string;
  path: string;
  /** Mechanical classification, included so the model has context — NEVER echoed back as fact-to-assert (see the system prompt). */
  mutates: boolean;
  reversibility: 'reversible' | 'irreversible';
  specSummary?: string;
  specDescription?: string;
}

export function buildSystemPrompt(): string {
  return [
    'You write ONE-SENTENCE tool descriptions for an MCP (Model Context Protocol) tool catalog.',
    'The reader is an LLM choosing which tool to call, not a human reading API documentation.',
    'Rules, in priority order:',
    '1. Output ONLY the description sentence. No markdown, no quotes, no preamble, no trailing period commentary.',
    '2. Describe WHAT the operation does and WHEN an agent would plausibly call it, in plain language.',
    '3. Do not restate the HTTP method or path verbatim — a caller adds those separately.',
    '4. NEVER assert or imply whether the operation is safe, read-only, reversible, destructive, or ' +
      'irreversible. That judgement is made mechanically elsewhere, from the HTTP method, and is not ' +
      'yours to state — a sentence containing a safety claim has it stripped before it is used.',
    '5. Keep it under 240 characters.',
  ].join('\n');
}

export function buildUserPrompt(args: DescribeOperationArgs): string {
  const lines = [`Operation: ${args.method.toUpperCase()} ${args.path}`, `Tool name: ${args.toolName}`];
  if (args.specSummary) lines.push(`Spec summary: ${args.specSummary}`);
  if (args.specDescription) lines.push(`Spec description: ${args.specDescription}`);
  lines.push('Write the one-sentence tool description now.');
  return lines.join('\n');
}

/**
 * Strip stray safety claims a completion might still emit despite the system
 * prompt, so a careless (or prompt-injected) response can't smuggle a safety
 * assertion into the description text — even though, structurally, prose
 * emitted here has zero power over `mutates`/`reversibility` regardless (see
 * descriptions.ts and spec.ts: this module is never on that code path at
 * all). Belt-and-braces on the string a human or model will actually read.
 */
const SAFETY_CLAIM_PATTERN = /\b(read[- ]?only|un\/?safe|safe|irreversible|reversible|destructive|mutat\w*)\b/gi;
export function sanitizeGeneratedProse(text: string): string {
  return text.replace(SAFETY_CLAIM_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** Call LiteLLM's OpenAI-compatible /chat/completions for one operation. */
export async function describeOperation(
  config: LlmGatewayConfig,
  args: DescribeOperationArgs
): Promise<string> {
  const fetchImpl = config.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (!fetchImpl) {
    throw new Error('No fetch implementation available.');
  }

  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature ?? 0.2,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(args) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LiteLLM /chat/completions failed (${res.status}) for ${args.toolName}: ${body}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`LiteLLM response for ${args.toolName} had no choices[0].message.content`);
  }

  const sanitized = sanitizeGeneratedProse(content.trim());
  if (!sanitized) {
    throw new Error(`LiteLLM response for ${args.toolName} was empty after stripping safety claims.`);
  }
  return sanitized;
}
