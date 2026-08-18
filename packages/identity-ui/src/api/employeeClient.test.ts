import { describe, it, expect } from 'vitest'
import { createEmployeeClient, isEmployeeForbidden } from './employeeClient'
import { HttpError } from './http'

function mockFetch(body: unknown, status = 200, ok = status < 300) {
  return async () =>
    ({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      text: async () => JSON.stringify(body),
    }) as Response
}

describe('createEmployeeClient — getStatus', () => {
  it('hits GET /api/v1/security/employee/status', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async (url) => {
      calledUrl = String(url)
      return mockFetch({ isEmployee: true, directOrgMemberships: [] })()
    }
    const client = createEmployeeClient({ fetchImpl })
    await client.getStatus()
    expect(calledUrl).toBe('/api/v1/security/employee/status')
  })

  it('resolves the EmployeeStatus envelope from the contract', async () => {
    const status = {
      isEmployee: true,
      directOrgMemberships: [{ orgId: 'org_acme', orgName: 'Acme Co', role: 'owner' as const }],
    }
    const client = createEmployeeClient({ fetchImpl: mockFetch(status) })
    await expect(client.getStatus()).resolves.toEqual(status)
  })

  it('a non-Employee still resolves 200 with isEmployee: false (never a 403 here)', async () => {
    const status = { isEmployee: false, directOrgMemberships: [] }
    const client = createEmployeeClient({ fetchImpl: mockFetch(status) })
    await expect(client.getStatus()).resolves.toEqual(status)
  })
})

describe('createEmployeeClient — listOrgs', () => {
  it('builds the cursor-paginated query string', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async (url) => {
      calledUrl = String(url)
      return mockFetch({ items: [], page: { nextCursor: null, hasMore: false } })()
    }
    const client = createEmployeeClient({ fetchImpl })
    await client.listOrgs({ limit: 100, cursor: 'c1' })
    expect(calledUrl).toBe('/api/v1/security/employee/orgs?limit=100&cursor=c1')
  })

  it('omits query params that were not provided (first-page default fetch)', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async (url) => {
      calledUrl = String(url)
      return mockFetch({ items: [], page: { nextCursor: null, hasMore: false } })()
    }
    const client = createEmployeeClient({ fetchImpl })
    await client.listOrgs()
    expect(calledUrl).toBe('/api/v1/security/employee/orgs')
  })

  it('resolves the EmployeeOrgPage cursor envelope from the contract', async () => {
    const page = {
      items: [
        { orgId: 'org_root', name: 'FuzeFront', parentOrgId: null, kind: 'root' as const, depth: 0 },
      ],
      page: { nextCursor: 'c2', hasMore: true },
    }
    const client = createEmployeeClient({ fetchImpl: mockFetch(page) })
    await expect(client.listOrgs()).resolves.toEqual(page)
  })

  it('surfaces the fail-closed 403 as an HttpError for a non-Employee caller', async () => {
    const fetchImpl = mockFetch({ error: 'nope', code: 'FORBIDDEN' }, 403, false)
    const client = createEmployeeClient({ fetchImpl })
    const err = await client.listOrgs().catch(e => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 403 })
  })
})

describe('isEmployeeForbidden', () => {
  it('is true only for a 403 HttpError', () => {
    expect(isEmployeeForbidden(new HttpError(403, 'nope', { code: 'FORBIDDEN' }))).toBe(true)
    expect(isEmployeeForbidden(new HttpError(500, 'boom', {}))).toBe(false)
    expect(isEmployeeForbidden(new Error('network'))).toBe(false)
    expect(isEmployeeForbidden(null)).toBe(false)
  })
})
