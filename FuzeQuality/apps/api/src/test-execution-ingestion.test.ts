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

  it('derives threshold outcomes instead of trusting producer verdicts', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'load',
      status: 'failed',
      name: 'Checkout load test',
      thresholds: [
        { metric: 'p95 latency', observed: 212, unit: 'ms', operator: 'lte', target: 200 },
        { metric: 'error rate', observed: 0.3, unit: '%', operator: 'lt', target: 1 },
      ],
    })

    expect(executionRecord(input, 'generated-id').thresholds).toEqual([
      expect.objectContaining({ metric: 'p95 latency', passed: false }),
      expect.objectContaining({ metric: 'error rate', passed: true }),
    ])
  })
})
