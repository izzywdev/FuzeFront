import { describe, expect, it } from 'vitest'
import type { TestSuiteDispatch } from '@fuzequality/contracts'
import { MemoryCatalogStore } from './store'

function dispatch(overrides: Partial<TestSuiteDispatch> = {}): TestSuiteDispatch {
  return {
    id: crypto.randomUUID(),
    repositoryId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    artifactId: 'suite:load',
    artifactLogicalId: 'workflow:.github/workflows/load.yml',
    artifactKind: 'load-test',
    workflowPath: '.github/workflows/load.yml',
    ref: 'main',
    sourceRevision: 'a'.repeat(40),
    requestedBy: '33333333-3333-4333-8333-333333333333',
    inputNames: ['environment'],
    status: 'dispatching',
    requestedAt: '2026-10-22T20:00:00.000Z',
    ...overrides,
  }
}

describe('test-suite dispatch audit', () => {
  it('updates one dispatch lifecycle without storing workflow input values', async () => {
    const store = new MemoryCatalogStore()
    const pending = dispatch()
    await store.saveTestSuiteDispatch(pending)
    await store.saveTestSuiteDispatch({
      ...pending,
      status: 'accepted',
      completedAt: '2026-10-22T20:00:01.000Z',
    })

    expect(await store.latestTestSuiteDispatches(pending.repositoryId, pending.tenantId)).toEqual([
      expect.objectContaining({
        id: pending.id,
        status: 'accepted',
        inputNames: ['environment'],
      }),
    ])
    expect(JSON.stringify(await store.latestTestSuiteDispatches(pending.repositoryId, pending.tenantId)))
      .not.toContain('production-secret')
  })

  it('returns only the newest receipt per logical suite within the requested tenant', async () => {
    const store = new MemoryCatalogStore()
    const first = dispatch({ id: '44444444-4444-4444-8444-444444444444' })
    const latest = dispatch({
      id: '55555555-5555-4555-8555-555555555555',
      artifactId: 'suite:load:new-revision',
      status: 'failed',
      error: 'provider unavailable',
      requestedAt: '2026-10-22T20:01:00.000Z',
    })
    await store.saveTestSuiteDispatch(first)
    await store.saveTestSuiteDispatch(latest)
    await store.saveTestSuiteDispatch(dispatch({
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: '77777777-7777-4777-8777-777777777777',
      requestedAt: '2026-10-22T20:02:00.000Z',
    }))

    expect(await store.latestTestSuiteDispatches(first.repositoryId, first.tenantId)).toEqual([
      expect.objectContaining({ id: latest.id, status: 'failed' }),
    ])
  })

  it('pages one artifact history by immutable request time and id', async () => {
    const store = new MemoryCatalogStore()
    const newest = dispatch({
      id: '77777777-7777-4777-8777-777777777777',
      requestedAt: '2026-10-22T20:02:00.000Z',
    })
    const middle = dispatch({
      id: '66666666-6666-4666-8666-666666666666',
      requestedAt: '2026-10-22T20:01:00.000Z',
    })
    const oldest = dispatch({
      id: '55555555-5555-4555-8555-555555555555',
      requestedAt: '2026-10-22T20:00:00.000Z',
    })
    await store.saveTestSuiteDispatch(oldest)
    await store.saveTestSuiteDispatch(newest)
    await store.saveTestSuiteDispatch(middle)
    await store.saveTestSuiteDispatch(dispatch({
      id: '88888888-8888-4888-8888-888888888888',
      artifactId: 'suite:stress',
      artifactLogicalId: 'workflow:.github/workflows/stress.yml',
      requestedAt: '2026-10-22T20:03:00.000Z',
    }))

    expect(await store.testSuiteDispatchHistory(newest.repositoryId, newest.tenantId, newest.artifactLogicalId, { limit: 2 }))
      .toEqual([newest, middle])
    expect(await store.testSuiteDispatchHistory(newest.repositoryId, newest.tenantId, newest.artifactLogicalId, {
      after: { createdAt: middle.requestedAt, id: middle.id },
      limit: 2,
    })).toEqual([oldest])
  })
})
