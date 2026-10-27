import { describe, expect, it, vi } from 'vitest'
import type { TestSuiteDispatch } from '@fuzequality/contracts'
import { persistTerminalTestSuiteDispatch } from './test-suite-dispatch-audit'

const accepted: TestSuiteDispatch = {
  id: '11111111-1111-4111-8111-111111111111',
  repositoryId: '22222222-2222-4222-8222-222222222222',
  tenantId: 'tenant-a',
  artifactId: 'artifact-revision-a',
  artifactLogicalId: 'suite-logical-id',
  artifactKind: 'integration-test',
  workflowPath: '.github/workflows/integration.yml',
  ref: 'main',
  sourceRevision: 'a'.repeat(40),
  requestedBy: 'user-a',
  inputNames: [],
  status: 'accepted',
  requestedAt: '2026-10-23T10:00:00.000Z',
  completedAt: '2026-10-23T10:00:01.000Z',
}

describe('terminal test-suite dispatch audit persistence', () => {
  it('retries an idempotent terminal upsert before reporting it persisted', async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('transient database failure'))
      .mockResolvedValueOnce(undefined)

    await expect(persistTerminalTestSuiteDispatch(write, accepted)).resolves.toBe('persisted')
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenNthCalledWith(2, accepted)
  })

  it('reports pending after the bounded retry budget is exhausted', async () => {
    const write = vi.fn().mockRejectedValue(new Error('database unavailable'))

    await expect(persistTerminalTestSuiteDispatch(write, accepted)).resolves.toBe('pending')
    expect(write).toHaveBeenCalledTimes(3)
  })
})
