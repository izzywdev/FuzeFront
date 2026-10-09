import { describe, expect, it } from 'vitest'
import { testExecutionInputSchema } from '@fuzequality/contracts'
import { executionRecord } from './test-execution-ingestion'

describe('internal execution ingestion compatibility', () => {
  it('uses the generated id when a legacy producer omits provider run identity', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'integration',
      status: 'passed',
      name: 'Integration suite',
    })

    expect(executionRecord(input, 'generated-id')).toMatchObject({
      id: 'generated-id',
      provider: 'external',
      externalRunId: 'generated-id',
      attempt: 1,
    })
  })

  it('preserves an explicit provider run identity', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      provider: 'github-actions',
      externalRunId: '98765',
      attempt: 3,
      revision: 'abc123',
      kind: 'ci',
      status: 'running',
      name: 'CI',
    })

    expect(executionRecord(input, 'generated-id')).toMatchObject({
      provider: 'github-actions',
      externalRunId: '98765',
      attempt: 3,
    })
  })
})
