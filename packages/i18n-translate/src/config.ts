import { readFileSync } from 'node:fs'

export interface LanguageEntry {
  code: string
  name: string
  nativeName: string
  dir: 'ltr' | 'rtl'
}

export interface LanguagesConfig {
  sourceLanguage: string
  languages: LanguageEntry[]
}

/** Read and validate `i18n.languages.json`. */
export function loadLanguagesConfig(path: string): LanguagesConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LanguagesConfig>
  if (!Array.isArray(raw.languages) || raw.languages.length === 0) {
    throw new Error(`${path}: "languages" must be a non-empty array`)
  }
  for (const l of raw.languages) {
    if (!l.code || !l.name || !l.dir) {
      throw new Error(
        `${path}: each language needs code, name and dir (got ${JSON.stringify(l)})`
      )
    }
    if (l.dir !== 'ltr' && l.dir !== 'rtl') {
      throw new Error(`${path}: dir must be "ltr" or "rtl" (got "${l.dir}")`)
    }
  }
  return {
    sourceLanguage: raw.sourceLanguage ?? 'en',
    languages: raw.languages as LanguageEntry[],
  }
}

export interface LlmEnv {
  endpoint: string
  apiKey: string
  model: string
}

/**
 * Resolve LLM gateway settings from the environment. Uses generic
 * OpenAI-compatible names so the same CLI works against LiteLLM or any
 * OpenAI-shaped endpoint.
 */
export function resolveLlmEnv(env: NodeJS.ProcessEnv = process.env): LlmEnv {
  const endpoint =
    env.I18N_LLM_ENDPOINT ?? env.OPENAI_BASE_URL ?? env.LITELLM_BASE_URL ?? ''
  const apiKey =
    env.I18N_LLM_API_KEY ?? env.OPENAI_API_KEY ?? env.LITELLM_API_KEY ?? ''
  const model = env.I18N_LLM_MODEL ?? env.OPENAI_MODEL ?? 'gpt-4o-mini'
  if (!endpoint) {
    throw new Error(
      'LLM endpoint not configured. Set I18N_LLM_ENDPOINT (or OPENAI_BASE_URL).'
    )
  }
  if (!apiKey) {
    throw new Error(
      'LLM API key not configured. Set I18N_LLM_API_KEY (or OPENAI_API_KEY).'
    )
  }
  return { endpoint, apiKey, model }
}
