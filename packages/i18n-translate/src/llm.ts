import { listPlaceholders } from './placeholders'
import { glossaryTermsIn, DEFAULT_GLOSSARY } from './glossary'

/** Minimal fetch signature so tests can inject a mock without `globalThis.fetch`. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}>

export interface LlmConfig {
  /** Base URL of the OpenAI-compatible gateway, e.g. http://litellm.fuzefront.svc:4000/v1 */
  endpoint: string
  /** API key for the gateway. */
  apiKey: string
  /** Model name routed by LiteLLM, e.g. "gpt-4o-mini". */
  model: string
  /** Injected fetch (defaults to global fetch). */
  fetchImpl?: FetchLike
  /** Sampling temperature (low for deterministic translations). */
  temperature?: number
}

export interface TranslateOneArgs {
  source: string
  /** Target language descriptor for the prompt. */
  targetLanguageName: string
  targetCode: string
  glossary?: readonly string[]
}

/** Build the strict system prompt that constrains the model. */
export function buildSystemPrompt(): string {
  return [
    'You are a professional software localization engine.',
    'Translate the user-provided UI string into the requested target language.',
    'Rules, in priority order:',
    '1. Output ONLY the translated string. No quotes, no explanation, no markdown.',
    '2. Preserve every placeholder token EXACTLY as-is, character for character:',
    '   - i18next interpolation like {{name}} or {{count}}',
    '   - ICU MessageFormat like {count, plural, one {# item} other {# items}}.',
    '   Never translate, reorder the syntax of, or remove a placeholder. You may',
    '   translate the human-readable words inside ICU sub-messages but keep the',
    '   ICU keywords (plural, select, selectordinal, one, other, =0, #) intact.',
    '3. Keep glossary / brand terms verbatim in the original language.',
    '4. Preserve leading/trailing whitespace and punctuation intent.',
  ].join('\n')
}

/** Build the user prompt for a single string. */
export function buildUserPrompt(args: TranslateOneArgs): string {
  const { source, targetLanguageName, glossary = DEFAULT_GLOSSARY } = args
  const placeholders = listPlaceholders(source)
  const terms = glossaryTermsIn(source, glossary)
  const lines = [`Target language: ${targetLanguageName}`]
  if (placeholders.length) {
    lines.push(`Placeholders to preserve verbatim: ${placeholders.join(' , ')}`)
  }
  if (terms.length) {
    lines.push(`Do NOT translate these terms: ${terms.join(' , ')}`)
  }
  lines.push('String to translate:')
  lines.push(source)
  return lines.join('\n')
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/** Call the OpenAI-compatible /chat/completions endpoint for one string. */
export async function translateOne(
  config: LlmConfig,
  args: TranslateOneArgs
): Promise<string> {
  const fetchImpl = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  if (!fetchImpl) {
    throw new Error('No fetch implementation available')
  }

  const url = `${config.endpoint.replace(/\/$/, '')}/chat/completions`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature ?? 0,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(args) },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM request failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as ChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('LLM response missing choices[0].message.content')
  }
  return content.trim()
}
