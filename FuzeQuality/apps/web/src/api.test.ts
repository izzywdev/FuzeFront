// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, configurePlatformSecurity } from './api'

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
})
