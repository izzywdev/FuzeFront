import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadLanguagesConfig, resolveLlmEnv } from './config'

describe('loadLanguagesConfig', () => {
  it('parses a valid config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-cfg-'))
    const path = join(dir, 'langs.json')
    writeFileSync(
      path,
      JSON.stringify({
        sourceLanguage: 'en',
        languages: [
          { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
          { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
        ],
      })
    )
    const cfg = loadLanguagesConfig(path)
    expect(cfg.sourceLanguage).toBe('en')
    expect(cfg.languages).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an invalid dir value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-cfg-'))
    const path = join(dir, 'langs.json')
    writeFileSync(
      path,
      JSON.stringify({
        languages: [{ code: 'xx', name: 'X', nativeName: 'X', dir: 'sideways' }],
      })
    )
    expect(() => loadLanguagesConfig(path)).toThrow(/dir must be/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveLlmEnv', () => {
  it('reads FuzeFront-specific then OpenAI-compatible env names', () => {
    const env = {
      I18N_LLM_ENDPOINT: 'http://litellm/v1',
      I18N_LLM_API_KEY: 'sk',
      I18N_LLM_MODEL: 'm',
    } as NodeJS.ProcessEnv
    expect(resolveLlmEnv(env)).toEqual({
      endpoint: 'http://litellm/v1',
      apiKey: 'sk',
      model: 'm',
    })
  })

  it('throws a clear error when endpoint is missing', () => {
    expect(() => resolveLlmEnv({ I18N_LLM_API_KEY: 'sk' } as NodeJS.ProcessEnv)).toThrow(
      /endpoint not configured/
    )
  })

  it('throws when the api key is missing', () => {
    expect(() =>
      resolveLlmEnv({ I18N_LLM_ENDPOINT: 'http://x/v1' } as NodeJS.ProcessEnv)
    ).toThrow(/API key not configured/)
  })
})
