import { describe, expect, it } from 'vitest'
import { executionFilterSchema, executionPageFilterSchema } from './execution-filter'

describe('execution evidence filter', () => {
  it('accepts a chronological ISO-8601 range', () => {
    expect(executionFilterSchema.safeParse({
      kind: 'post-production',
      status: 'failed',
      provider: 'github-actions',
      name: 'Post-production browser suite',
      evidenceKind: 'video',
      thresholdOutcome: 'failed',
      externalRunId: '123456789',
      policyArtifactId: 'policy-auth',
      gateArtifactId: 'gate-auth',
      revision: 'abcdef123456',
      workflowPath: '.github/workflows/load.yml',
      attemptScope: 'retry',
      minimumDurationMs: '60000',
      maximumDurationMs: '120000',
      from: '2026-10-01T00:00:00.000Z',
      until: '2026-10-08T00:00:00.000Z',
    }).success).toBe(true)
  })

  it('bounds exact policy and gate artifact identifiers', () => {
    expect(executionFilterSchema.parse({ policyArtifactId: ' policy-auth ', gateArtifactId: ' gate-auth ' }))
      .toMatchObject({ policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth' })
    expect(executionFilterSchema.safeParse({ policyArtifactId: '' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ gateArtifactId: 'x'.repeat(501) }).success).toBe(false)
  })

  it('rejects an unknown execution provider', () => {
    expect(executionFilterSchema.safeParse({ provider: 'jenkins' }).success).toBe(false)
  })

  it('bounds and normalizes an exact suite name', () => {
    expect(executionFilterSchema.parse({ name: ' Integration suite ' }).name).toBe('Integration suite')
    expect(executionPageFilterSchema.safeParse({ name: ' ' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ name: 'a'.repeat(501) }).success).toBe(false)
  })

  it('accepts only retained execution evidence kinds', () => {
    expect(executionFilterSchema.parse({ evidenceKind: 'video' }).evidenceKind).toBe('video')
    expect(executionPageFilterSchema.parse({ evidenceKind: 'trace' }).evidenceKind).toBe('trace')
    expect(executionFilterSchema.safeParse({ evidenceKind: 'artifact' }).success).toBe(false)
  })

  it('accepts only evaluated threshold outcomes', () => {
    expect(executionFilterSchema.parse({ thresholdOutcome: 'failed' }).thresholdOutcome).toBe('failed')
    expect(executionPageFilterSchema.parse({ thresholdOutcome: 'passed' }).thresholdOutcome).toBe('passed')
    expect(executionFilterSchema.safeParse({ thresholdOutcome: 'running' }).success).toBe(false)
  })

  it('bounds an exact provider run identifier', () => {
    expect(executionFilterSchema.parse({ externalRunId: ' 123456789 ' }).externalRunId).toBe('123456789')
    expect(executionFilterSchema.safeParse({ externalRunId: ' ' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ externalRunId: 'a'.repeat(501) }).success).toBe(false)
  })

  it('rejects an unknown attempt scope', () => {
    expect(executionFilterSchema.safeParse({ attemptScope: 'all' }).success).toBe(false)
  })

  it('accepts verified recovery evidence as an attempt scope', () => {
    expect(executionFilterSchema.safeParse({ attemptScope: 'recovered' }).success).toBe(true)
  })

  it('bounds the minimum execution duration to a non-negative integer', () => {
    expect(executionFilterSchema.parse({ minimumDurationMs: '60000' }).minimumDurationMs).toBe(60_000)
    expect(executionFilterSchema.safeParse({ minimumDurationMs: '-1' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ minimumDurationMs: '1.5' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ minimumDurationMs: '2147483648' }).success).toBe(false)
  })

  it('bounds maximum duration and rejects an inverted duration range', () => {
    expect(executionFilterSchema.parse({ maximumDurationMs: '120000' }).maximumDurationMs).toBe(120_000)
    expect(executionFilterSchema.safeParse({ maximumDurationMs: '-1' }).success).toBe(false)
    const result = executionFilterSchema.safeParse({ minimumDurationMs: '120000', maximumDurationMs: '60000' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.flatten().fieldErrors.maximumDurationMs).toContain('maximumDurationMs must be greater than or equal to minimumDurationMs')
    expect(executionPageFilterSchema.safeParse({ minimumDurationMs: '120000', maximumDurationMs: '60000' }).success).toBe(false)
  })

  it('rejects an empty or oversized revision', () => {
    expect(executionFilterSchema.safeParse({ revision: ' ' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ revision: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects an empty or oversized workflow path', () => {
    expect(executionFilterSchema.safeParse({ workflowPath: ' ' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ workflowPath: 'a'.repeat(1001) }).success).toBe(false)
  })

  it('rejects an inverted time range instead of returning misleading empty evidence', () => {
    const result = executionFilterSchema.safeParse({
      from: '2026-10-08T00:00:00.000Z',
      until: '2026-10-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.flatten().fieldErrors.until).toContain('until must be greater than or equal to from')
  })

  it('bounds immutable execution pages and accepts opaque continuation cursors', () => {
    const result = executionPageFilterSchema.parse({ limit: '1000', cursor: 'opaque-page' })
    expect(result).toMatchObject({ limit: 100, cursor: 'opaque-page' })
  })
})
