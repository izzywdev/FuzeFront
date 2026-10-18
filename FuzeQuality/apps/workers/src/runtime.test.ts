import { describe, expect, it } from 'vitest'
import { MAX_DELIVERY_ATTEMPTS, failureCode, retry, retryDelayMs } from './runtime'

describe('worker delivery reliability', () => {
  it('retries transient delivery with bounded exponential backoff', async () => {
    let attempts = 0
    const waits: number[] = []
    const value = await retry(async () => {
      attempts++
      if (attempts < 3) throw new Error('Jira search returned 503')
      return 'saved'
    }, async delay => { waits.push(delay) })
    expect(value).toBe('saved')
    expect(attempts).toBe(3)
    expect(waits).toEqual([retryDelayMs(1), retryDelayMs(2)])
  })

  it('does not leak provider messages into durable diagnostics', () => {
    expect(failureCode(new Error('Jira search returned 401 for https://example/?token=secret'))).toBe('JIRA_UNAVAILABLE')
    expect(failureCode(new Error('Chroma connection refused'))).toBe('SEMANTIC_INDEX_UNAVAILABLE')
    expect(failureCode(new Error('LiteLLM returned 500'))).toBe('INTELLIGENCE_UNAVAILABLE')
    expect(MAX_DELIVERY_ATTEMPTS).toBe(3)
  })

  it('reports a terminal delivery once after every retry is exhausted', async () => {
    let attempts = 0
    const exhausted: unknown[] = []
    const failure = new Error('checkout failed with a secret provider detail')

    await expect(retry(
      async () => { attempts++; throw failure },
      async () => undefined,
      async error => { exhausted.push(error) },
    )).rejects.toBe(failure)

    expect(attempts).toBe(MAX_DELIVERY_ATTEMPTS)
    expect(exhausted).toEqual([failure])
  })
})
