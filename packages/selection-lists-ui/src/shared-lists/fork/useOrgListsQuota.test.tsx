import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorResponse, routeFetch } from '../../test/forkHarness'
import { jsonResponse } from '../../test/sharedListsFixtures'
import { orgListsQuotaOf, useOrgListsQuota } from './useOrgListsQuota'

afterEach(() => vi.unstubAllGlobals())

const envelope = (quotas: unknown) => ({ organization_id: 'org_1', quotas })

describe('orgListsQuotaOf — the REAL envelope { organization_id, quotas: [...] }', () => {
  it('picks the org_lists entry', () => {
    expect(
      orgListsQuotaOf(
        envelope([
          { scope: 'user_lists', applies_to: 'user', limit: 25, current: 3 },
          { scope: 'org_lists', applies_to: 'organization', limit: 100, current: 37 },
        ])
      )
    ).toEqual({ limit: 100, current: 37 })
  })

  it('is null for anything unusable', () => {
    expect(orgListsQuotaOf(null)).toBeNull()
    expect(orgListsQuotaOf({ scopes: [] })).toBeNull() // the 4.0.0 client's wrong shape
    expect(orgListsQuotaOf(envelope('x'))).toBeNull()
    expect(orgListsQuotaOf(envelope([]))).toBeNull()
    expect(
      orgListsQuotaOf(envelope([{ scope: 'org_lists', limit: 100, current: null }]))
    ).toBeNull()
    expect(
      orgListsQuotaOf(envelope([{ scope: 'org_lists', limit: '100', current: 1 }]))
    ).toBeNull()
    expect(orgListsQuotaOf(envelope([null]))).toBeNull()
  })
})

describe('useOrgListsQuota', () => {
  it('loads the preview', async () => {
    routeFetch({
      'GET /api/v1/selection-lists/quota': () =>
        jsonResponse(
          envelope([{ scope: 'org_lists', applies_to: 'organization', limit: 100, current: 37 }])
        ),
    })
    const { result } = renderHook(() => useOrgListsQuota())
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toEqual({ limit: 100, current: 37 }))
  })

  it('a 403 (an editor lacks read_quota) is "no preview", not an error', async () => {
    const mock = routeFetch({
      'GET /api/v1/selection-lists/quota': () => errorResponse(403, 'FORBIDDEN'),
    })
    const { result } = renderHook(() => useOrgListsQuota())
    await waitFor(() => expect(mock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    expect(result.current).toBeNull()
  })

  it('a network failure is "no preview" and an unmount aborts the request', async () => {
    const seen: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) => {
        seen.push(init!.signal!)
        return new Promise(() => undefined)
      })
    )
    const { result, unmount } = renderHook(() => useOrgListsQuota())
    await waitFor(() => expect(seen).toHaveLength(1))
    unmount()
    expect(seen[0].aborted).toBe(true)
    expect(result.current).toBeNull()
  })
})
