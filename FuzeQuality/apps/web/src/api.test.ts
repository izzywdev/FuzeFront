// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, CatalogApiError, configurePlatformSecurity } from './api'

describe('FuzeQuality portal API identity context', () => {
  afterEach(() => {
    configurePlatformSecurity(undefined)
    delete (window as any).__FUZEFRONT__
    delete (window as any).__FRONTFUSE_CONTEXT__
    vi.unstubAllGlobals()
  })

  it('forwards the host token and membership-checked selected tenant', async () => {
    ;(window as any).__FUZEFRONT__ = {
      getContext: () => ({ tenantId: 'tenant-1', activeOrganization: null }),
    }
    configurePlatformSecurity(() => 'portal-token')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: [], apiOperations: [], frontendSurfaces: [], testCases: [],
      requirements: [], expectations: [], coverage: [], findings: [], suggestions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await api.portfolio()

    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBe('Bearer portal-token')
    expect(headers.get('x-fuzefront-tenant-id')).toBe('tenant-1')
  })

  it('uses the host-owned federation session while the runtime bridge is initializing', async () => {
    ;(window as any).__FRONTFUSE_CONTEXT__ = {
      session: { tenantId: 'personal-tenant-1' },
      getAccessToken: () => 'portal-token',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: [], apiOperations: [], frontendSurfaces: [], testCases: [],
      requirements: [], expectations: [], coverage: [], findings: [], suggestions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await api.portfolio()

    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBe('Bearer portal-token')
    expect(headers.get('x-fuzefront-tenant-id')).toBe('personal-tenant-1')
  })

  it('uses the standalone Security session token and canonical tenant without a portal bridge', async () => {
    configurePlatformSecurity(() => 'standalone-token', () => 'standalone-tenant')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: [], apiOperations: [], frontendSurfaces: [], testCases: [],
      requirements: [], expectations: [], coverage: [], findings: [], suggestions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await api.portfolio()

    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBe('Bearer standalone-token')
    expect(headers.get('x-fuzefront-tenant-id')).toBe('standalone-tenant')
  })

  it('resolves large evidence sets in bounded exact-ID batches and deduplicates results', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      const url = new URL(input, 'https://quality.test')
      const ids = url.searchParams.getAll('id')
      return new Response(JSON.stringify({
        items: ids.map(id => ({ id, repositoryId: 'repo-1', kind: 'policy', title: id, sourcePath: `${id}.md`, summary: id, evidence: [] })),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ids = [...Array.from({ length: 205 }, (_, index) => `artifact-${index}`), 'artifact-0']

    const result = await api.qualityArtifactsByIdsBatched('repo-1', ids, 'catalog-revision')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([input]) =>
      new URL(input, 'https://quality.test').searchParams.getAll('id').length
    )).toEqual([100, 100, 5])
    expect(fetchMock.mock.calls.every(([input]) =>
      new URL(input, 'https://quality.test').searchParams.get('revision') === 'catalog-revision'
    )).toBe(true)
    expect(result.items).toHaveLength(205)
    expect(result.items[0].id).toBe('artifact-0')
  })

  it('preserves unresolved failure-audit state from a rejected dispatch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'GitHub dispatch timed out',
      code: 'TEST_DISPATCH_FAILED',
      auditPersistence: 'pending',
    }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.runTestSuite('repo-1', 'artifact-1')).rejects.toEqual(
      expect.objectContaining<CatalogApiError>({
        name: 'CatalogApiError',
        message: 'GitHub dispatch timed out',
        code: 'TEST_DISPATCH_FAILED',
        status: 502,
        auditPersistence: 'pending',
      }),
    )
  })

  it('normalizes nested FuzeFront member identities for organization administration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: 'membership-1', role: 'admin', status: 'active',
        user: { id: 'user-1', email: 'owner@example.com', firstName: 'Quality', lastName: 'Owner' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.organizationMembers()).resolves.toEqual([expect.objectContaining({
      id: 'membership-1', role: 'admin', email: 'owner@example.com', displayName: 'Quality Owner', userId: 'user-1',
    })])
  })

  it('sends the current flow-review timestamp as an optimistic precondition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.reviewRepositoryFlowCandidate(
      'repo-1',
      'flow-1',
      'rejected',
      'The implementation changed.',
      '2026-10-15T01:00:00.000Z',
    )

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      status: 'rejected',
      reason: 'The implementation changed.',
      expectedReviewedAt: '2026-10-15T01:00:00.000Z',
    })
  })

  it('sends the current policy/gate review timestamp as an optimistic precondition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.reviewPolicyGateEvaluation(
      'repo-1',
      'evaluation-1',
      'dismissed',
      'The guard was replaced.',
      '2026-10-15T01:00:00.000Z',
    )

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      status: 'dismissed',
      reason: 'The guard was replaced.',
      expectedReviewedAt: '2026-10-15T01:00:00.000Z',
    })
  })

  it('requests attempt history by exact encoded provider identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.testExecutionAttempts(
      'repo-1',
      'github-actions',
      'run/id with spaces',
      'next page',
    )

    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/repositories/repo-1/test-executions/attempts?provider=github-actions&externalRunId=run%2Fid+with+spaces&cursor=next+page'
    )
  })

  it('requests one exact execution independently of list pagination', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.testExecution('repo-1', 'execution/id with spaces')

    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/repositories/repo-1/test-executions/execution%2Fid%20with%20spaces'
    )
  })

  it('refreshes provider evidence for one exact execution attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.refreshTestExecutionEvidence('repo-1', {
      provider: 'github-actions',
      externalRunId: '98765',
      attempt: 3,
    })

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/repositories/repo-1/test-executions/evidence/refresh')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      provider: 'github-actions', externalRunId: '98765', attempt: 3,
    })
  })
})
