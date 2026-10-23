import { describe, expect, it } from 'vitest'
import type { TestSuiteDispatch } from '@fuzequality/contracts'
import { decodeUuidHistoryCursor } from './history-pagination'
import { testSuiteDispatchPage } from './test-suite-dispatch-pagination'

const receipt = (id: string, requestedAt: string): TestSuiteDispatch => ({
  id,
  repositoryId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  artifactId: 'suite:load',
  artifactLogicalId: 'workflow:.github/workflows/load.yml',
  artifactKind: 'load-test',
  workflowPath: '.github/workflows/load.yml',
  ref: 'main',
  sourceRevision: 'a'.repeat(40),
  requestedBy: 'reviewer-1',
  inputNames: [],
  status: 'accepted',
  requestedAt,
})

describe('test-suite dispatch pagination', () => {
  it('encodes the last visible immutable request as the continuation cursor', () => {
    const second = receipt('22222222-2222-4222-8222-222222222222', '2026-10-22T20:01:00.000Z')
    const page = testSuiteDispatchPage([
      receipt('33333333-3333-4333-8333-333333333333', '2026-10-22T20:02:00.000Z'),
      second,
      receipt('11111111-1111-4111-8111-111111111111', '2026-10-22T20:00:00.000Z'),
    ], 2)

    expect(page.items).toHaveLength(2)
    expect(page.page.hasMore).toBe(true)
    expect(decodeUuidHistoryCursor(page.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { createdAt: second.requestedAt, id: second.id },
    })
  })
})
