import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AppRegistryClient } from '@fuzefront/app-registry-client'
import { AppRegistryProvider, useAppRegistry } from '../appRegistry'

/**
 * FF-EPIC-12-S4 — frontend coverage for the portal-scoped app menu.
 *
 * The scoping decision itself is made ENTIRELY server-side (see
 * `backend/applications/src/app-registry/portalContext.ts` +
 * `service.ts`'s `list()`, exercised end-to-end against a real Postgres in
 * `backend/applications/tests/portal-catalog.integration.test.ts`): the
 * `fuzefront.apps.portal-catalog` flag and the JWT's `portalId` claim are
 * resolved by the applications-service before it ever answers
 * `GET /api/v1/app-registry`. This provider makes exactly ONE unconditional
 * `listApps({ status: 'activated' })` call and trusts the response as
 * already-scoped — there is no client-side flag branch to get wrong, and no
 * second request that could race a first "unscoped" one. These tests mock
 * that single response for each of the four contract states (tenant-scoped,
 * root/full, flag-off/pre-epic, denied-empty) and prove the provider passes
 * each through untouched, without ever surfacing a console error for the
 * cases that are 200s (not failures).
 */

vi.mock('@fuzefront/app-registry-client', () => {
  const listApps = vi.fn()
  return {
    AppRegistryClient: vi.fn().mockImplementation(() => ({ listApps })),
  }
})

function getMockedListApps() {
  const results = (AppRegistryClient as unknown as ReturnType<typeof vi.fn>).mock.results
  const instance = results[results.length - 1]?.value
  return instance.listApps as ReturnType<typeof vi.fn>
}

function Probe() {
  const { apps, loading, error } = useAppRegistry()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <ul data-testid="apps">
        {apps.map(a => (
          <li key={a.slug}>{a.slug}</li>
        ))}
      </ul>
    </div>
  )
}

const tenantApp = { slug: 'tenant-crm', manifest: { menuLabel: 'CRM' } } as any
const rootApp1 = { slug: 'clock', manifest: { menuLabel: 'Clock' } } as any
const rootApp2 = { slug: 'market', manifest: { menuLabel: 'Market' } } as any
const rootApp3 = { slug: 'billing', manifest: { menuLabel: 'Billing' } } as any
const globalApp = { slug: 'public-directory', manifest: { menuLabel: 'Directory' } } as any

describe('AppRegistryProvider — portal-scoped catalog (FF-EPIC-12-S4)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('tenant-portal session, flag ON (mode "scoped"): shows ONLY the curated apps the backend returned', async () => {
    (AppRegistryClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      listApps: vi.fn().mockResolvedValue({ apps: [tenantApp], nextCursor: null }),
    }))

    const { getByTestId } = render(
      <AppRegistryProvider>
        <Probe />
      </AppRegistryProvider>,
    )

    await waitFor(() => expect(getByTestId('loading').textContent).toBe('false'))
    expect(getByTestId('apps').textContent).toBe('tenant-crm')
    expect(getByTestId('error').textContent).toBe('')
  })

  it('root-portal session, flag ON (mode "root"): shows the FULL catalog, unfiltered', async () => {
    (AppRegistryClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      listApps: vi.fn().mockResolvedValue({
        apps: [rootApp1, rootApp2, rootApp3],
        nextCursor: null,
      }),
    }))

    const { getByTestId } = render(
      <AppRegistryProvider>
        <Probe />
      </AppRegistryProvider>,
    )

    await waitFor(() => expect(getByTestId('loading').textContent).toBe('false'))
    expect(getByTestId('apps').textContent).toBe('clockmarketbilling')
  })

  it('flag OFF (mode "off"): unchanged pre-epic contract — one call, whatever the backend returns is passed through as-is', async () => {
    (AppRegistryClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      listApps: vi.fn().mockResolvedValue({ apps: [globalApp], nextCursor: null }),
    }))

    const { getByTestId } = render(
      <AppRegistryProvider>
        <Probe />
      </AppRegistryProvider>,
    )

    await waitFor(() => {
      expect(getMockedListApps()).toHaveBeenCalledWith({ status: 'activated' })
      expect(getMockedListApps()).toHaveBeenCalledTimes(1)
    })
    expect(getByTestId('apps').textContent).toBe('public-directory')
  })

  it('denied / empty scoped list (flag ON, missing or malformed portal context): degrades to an empty, error-free apps list — no crash, no console error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const MockedClient = AppRegistryClient as unknown as ReturnType<typeof vi.fn>
    MockedClient.mockImplementation(() => ({
      // The backend's fail-closed contract (S2 AC4) returns a normal 200
      // with an empty set — never an HTTP error — so this must resolve
      // cleanly, not throw.
      listApps: vi.fn().mockResolvedValue({ apps: [], nextCursor: null }),
    }))

    const { getByTestId } = render(
      <AppRegistryProvider>
        <Probe />
      </AppRegistryProvider>,
    )

    await waitFor(() => expect(getByTestId('loading').textContent).toBe('false'))
    expect(getByTestId('apps').textContent).toBe('')
    expect(getByTestId('error').textContent).toBe('')
    expect(errorSpy).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
