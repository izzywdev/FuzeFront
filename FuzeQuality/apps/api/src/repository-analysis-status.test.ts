import { describe, expect, it } from 'vitest'
import { repositoryAnalysisStatusSchema } from './repository-analysis-status'

describe('repository analysis status ingestion', () => {
  it('accepts bounded completed analysis evidence', () => {
    expect(repositoryAnalysisStatusSchema.parse({
      revision: 'abc', status: 'complete', finishedAt: new Date().toISOString(),
      counts: { deterministic: 2, evaluations: 3, proposed: 1 },
    }).status).toBe('complete')
  })

  it('rejects raw provider failures and incomplete terminal states', () => {
    expect(repositoryAnalysisStatusSchema.safeParse({ revision: 'abc', status: 'failed', error: 'secret response' }).success).toBe(false)
    expect(repositoryAnalysisStatusSchema.safeParse({ revision: 'abc', status: 'complete' }).success).toBe(false)
  })

  it('accepts a safe LiteLLM timeout classification', () => {
    expect(repositoryAnalysisStatusSchema.parse({
      revision: 'abc', status: 'failed', errorCode: 'INTELLIGENCE_TIMEOUT',
    }).errorCode).toBe('INTELLIGENCE_TIMEOUT')
  })
})
