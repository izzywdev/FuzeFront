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

  it('retains explicit gate outcomes and adds their artifacts to discovery links', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'post-production',
      status: 'failed',
      name: 'Production smoke tests',
      gateEvaluations: [{
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth-smoke',
        status: 'failed',
        detail: 'Unauthenticated redirect did not preserve the requested route.',
      }],
    })

    expect(executionRecord(input, 'generated-id')).toMatchObject({
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth-smoke'],
      gateEvaluations: [expect.objectContaining({
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth-smoke',
        status: 'failed',
      })],
    })
  })

  it('retains links to video and report evidence for the exact run attempt', () => {
    const input = testExecutionInputSchema.parse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'post-production',
      status: 'passed',
      name: 'Production smoke tests',
      evidenceLinks: [
        { kind: 'video', name: 'FuzeQuality journey', url: 'https://evidence.example/runs/42/video.webm' },
        { kind: 'report', name: 'Playwright report', url: 'https://evidence.example/runs/42/report/' },
      ],
    })

    expect(executionRecord(input, 'generated-id').evidenceLinks).toEqual([
      expect.objectContaining({ kind: 'video', name: 'FuzeQuality journey' }),
      expect.objectContaining({ kind: 'report', name: 'Playwright report' }),
    ])
  })

  it('rejects executable and insecure evidence URLs before they reach the UI', () => {
    for (const url of ['javascript:alert(1)', 'http://evidence.example/video.webm']) {
      expect(testExecutionInputSchema.safeParse({
        repositoryId: '123e4567-e89b-12d3-a456-426614174000',
        tenantId: 'org-1',
        revision: 'abc123',
        kind: 'post-production',
        status: 'passed',
        name: 'Production smoke tests',
        evidenceLinks: [{ kind: 'video', name: 'Unsafe video', url }],
      }).success).toBe(false)
    }
  })

  it('rejects duplicate outcomes for the same policy and gate pair', () => {
    const parsed = testExecutionInputSchema.safeParse({
      repositoryId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: 'org-1',
      revision: 'abc123',
      kind: 'ci',
      status: 'failed',
      name: 'CI',
      gateEvaluations: [
        { policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' },
        { policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' },
      ],
    })

    expect(parsed.success).toBe(false)
  })
})
