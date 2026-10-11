import { afterEach, describe, expect, it, vi } from 'vitest'
import { listSelectionLists, setSelectionListAuthTokenProvider } from './api'

afterEach(() => {
  setSelectionListAuthTokenProvider(() => null)
  vi.unstubAllGlobals()
})

describe('host session authentication', () => {
  it('reads the active account token on each request and stops sending it after logout', async () => {
    let token: string | null = 'account-one'
    setSelectionListAuthTokenProvider(() => token)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: [], next_cursor: null }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await listSelectionLists()
    token = 'account-two'
    await listSelectionLists()
    token = null
    await listSelectionLists()

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer account-one')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer account-two')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/selection-lists')
  })

  it('preserves the service denial rather than treating an unauthorized request as empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      json: async () => ({ code: 'FORBIDDEN', message: 'Access denied' }),
    }))
    await expect(listSelectionLists()).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403, message: 'Access denied',
    })
  })
})
