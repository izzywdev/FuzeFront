import { describe, it, expect, vi } from 'vitest'
import {
  translateOne,
  buildSystemPrompt,
  buildUserPrompt,
  type FetchLike,
  type LlmConfig,
} from './llm'

function mockFetch(content: string): { fetchImpl: FetchLike; calls: any[] } {
  const calls: any[] = []
  const fetchImpl: FetchLike = vi.fn(async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ choices: [{ message: { content } }] }),
    }
  })
  return { fetchImpl, calls }
}

const baseConfig = (fetchImpl: FetchLike): LlmConfig => ({
  endpoint: 'http://litellm.local/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  fetchImpl,
})

describe('prompt building', () => {
  it('system prompt forbids translating placeholders and brand terms', () => {
    const p = buildSystemPrompt()
    expect(p).toMatch(/Preserve every placeholder/i)
    expect(p).toMatch(/ICU/i)
    expect(p).toMatch(/glossary|brand/i)
  })

  it('user prompt lists placeholders and do-not-translate terms found in the source', () => {
    const p = buildUserPrompt({
      source: 'Welcome to FuzeFront, {{name}}',
      targetLanguageName: 'Spanish',
      targetCode: 'es',
    })
    expect(p).toContain('Target language: Spanish')
    expect(p).toMatch(/\{\{name\}\}/)
    expect(p).toContain('FuzeFront')
    expect(p).toContain('Welcome to FuzeFront, {{name}}')
  })
})

describe('translateOne (mocked transport, no live network)', () => {
  it('POSTs an OpenAI-compatible chat completion and returns the trimmed content', async () => {
    const { fetchImpl, calls } = mockFetch('  Hola  ')
    const out = await translateOne(baseConfig(fetchImpl), {
      source: 'Hello',
      targetLanguageName: 'Spanish',
      targetCode: 'es',
    })
    expect(out).toBe('Hola')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://litellm.local/v1/chat/completions')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(calls[0].init.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.temperature).toBe(0)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toContain('Hello')
  })

  it('throws on a non-OK response', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
      json: async () => ({}),
    }))
    await expect(
      translateOne(baseConfig(fetchImpl), {
        source: 'Hello',
        targetLanguageName: 'Spanish',
        targetCode: 'es',
      })
    ).rejects.toThrow(/502/)
  })

  it('throws when the response is missing message content', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ choices: [] }),
    }))
    await expect(
      translateOne(baseConfig(fetchImpl), {
        source: 'Hello',
        targetLanguageName: 'Spanish',
        targetCode: 'es',
      })
    ).rejects.toThrow(/missing/)
  })
})
