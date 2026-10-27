/**
 * Quota envelope — the management flow against the REAL service response.
 *
 * `GET /v1/selection-lists/quota` answers the contract's
 * `SelectionListQuotaStatus` = `{ organization_id, quotas: [{ scope, applies_to,
 * limit, current }] }` (services/selection-list-service/openapi.yaml). The flow
 * used to read `{ scopes: [...] }`, so against the real service
 * `quota.scopes.some(...)` threw a TypeError during render and the whole
 * management index unmounted. The other flow tests mock `../api` with a
 * hand-built fixture, which is how that shipped unnoticed.
 *
 * These tests do NOT mock `../api`: only `fetch` is stubbed (the real network
 * boundary), so the real `getQuota()` feeds the real envelope into the real
 * component. The fixtures are typed by `@fuzeone/selection-list-client`, so a
 * drift between this package's `QuotaStatus` and the contract is a tsc error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { SelectionListQuotaEntry, SelectionListQuotaStatus } from '@fuzeone/selection-list-client'
import { SelectionListManagementFlow } from '../SelectionListManagementFlow'
import { getQuota } from '../api'
import type { QuotaStatus } from '../types'
import { SharedListsFeatureProvider } from '../shared-lists/core'
import { renderFlow } from './helpers'

// ── Contract-typed fixtures ───────────────────────────────────────────────────

type UsageByScope = Partial<Record<SelectionListQuotaEntry['scope'], number | null>>

/** The exact wire shape: 4 entries (fixed set), each with `applies_to`. */
function contractQuota(usage: UsageByScope = {}): SelectionListQuotaStatus {
  const current = { org_lists: 2, user_lists: 1, list_items: null, list_locales: null, ...usage }
  return {
    organization_id: 'org_01h455vb4pex5vsknk084sn02q',
    quotas: [
      { scope: 'org_lists', applies_to: 'organization', limit: 50, current: current.org_lists },
      { scope: 'user_lists', applies_to: 'user', limit: 10, current: current.user_lists },
      { scope: 'list_items', applies_to: 'list', limit: 500, current: current.list_items },
      { scope: 'list_locales', applies_to: 'list', limit: 11, current: current.list_locales },
    ],
  }
}

// ── Contract <-> UI type binding (compile-time) ───────────────────────────────
// Both directions: the UI's QuotaStatus must accept the service response, and
// must not promise anything the service does not send. Failing here is a tsc
// error, not a runtime surprise.
const contractToUi = (c: SelectionListQuotaStatus): QuotaStatus => c
const uiToContract = (u: QuotaStatus): SelectionListQuotaStatus => u
void contractToUi
void uiToContract

// ── fetch stub ────────────────────────────────────────────────────────────────

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()

/** Serve the index's two reads: the lists page and the quota route. */
function serve(quota: () => Response) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/selection-lists/quota')) return quota()
    if (url.startsWith('/api/v1/selection-lists')) return res({ data: [], page: { hasMore: false } })
    throw new Error(`unexpected request ${url}`)
  })
}

const INDEX = '/settings/selection-lists'
const q = (sel: string) => document.querySelector(sel)
const qa = (sel: string) => Array.from(document.querySelectorAll(sel))
const renderIndex = () =>
  renderFlow(<SelectionListManagementFlow />, INDEX, [INDEX, `${INDEX}/:listId`])
/** The flag-ON (shared-lists) variant of the same index reads the same envelope. */
const renderSharedIndex = () =>
  renderFlow(
    <SharedListsFeatureProvider sharedLists organizationId="org_01h455vb4pex5vsknk084sn02q" organizationName="Globex Freight">
      <SelectionListManagementFlow />
    </SharedListsFeatureProvider>,
    INDEX,
    [INDEX, `${INDEX}/:listId`],
  )

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('getQuota() against the contract envelope', () => {
  it('returns the service response as sent: { organization_id, quotas[] } with applies_to', async () => {
    const body = contractQuota()
    serve(() => res(body))
    const out = await getQuota()
    expect(out).toEqual(body)
    expect(out.quotas).toHaveLength(4)
    expect(out.quotas.map(e => e.applies_to)).toEqual(['organization', 'user', 'list', 'list'])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/selection-lists/quota')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('management flow reads the REAL quota envelope (frame 06)', () => {
  it('renders all four meters without throwing: "current / limit" and "— / limit" for per-list scopes', async () => {
    serve(() => res(contractQuota()))
    renderIndex()
    await waitFor(() => expect(q('[data-quota-scope="org_lists"]')).not.toBeNull())
    expect(q('[data-quota-scope="org_lists"]')).toHaveTextContent('2 / 50')
    expect(q('[data-quota-scope="user_lists"]')).toHaveTextContent('1 / 10')
    expect(q('[data-quota-scope="list_items"]')).toHaveTextContent('— / 500')
    expect(q('[data-quota-scope="list_locales"]')).toHaveTextContent('— / 11')
    expect(qa('[data-quota-scope]')).toHaveLength(4)
    expect(q('[data-banner="quota-near"]')).toBeNull()
    expect(q('[data-banner="quota-at"]')).toBeNull()
    // The index did not unmount: heading + CTA are still there.
    expect(screen.getByRole('heading', { name: 'Selection Lists' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it('shows the near-limit banner at >= 80% and keeps the CTA enabled', async () => {
    serve(() => res(contractQuota({ org_lists: 45 })))
    renderIndex()
    await waitFor(() => expect(q('[data-banner="quota-near"]')).not.toBeNull())
    expect(q('[data-banner="quota-at"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it('at the ceiling shows the at-limit banner and disables the CTA with the quota hooks', async () => {
    serve(() => res(contractQuota({ org_lists: 50 })))
    renderIndex()
    await waitFor(() => expect(q('[data-banner="quota-at"]')).not.toBeNull())
    const cta = screen.getByRole('button', { name: 'New list' })
    expect(cta).toBeDisabled()
    expect(cta).toHaveAttribute('data-quota-state', 'at-limit')
    expect(cta).toHaveAttribute('data-tooltip', 'quota')
  })

  it('a per-user ceiling (user_lists) at its limit also disables the CTA', async () => {
    serve(() => res(contractQuota({ user_lists: 10 })))
    renderIndex()
    await waitFor(() => expect(q('[data-banner="quota-at"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'New list' })).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('quota read failures stay fail-OPEN (the server is the authority)', () => {
  it('a 403 on the quota read hides the meters, says so, and keeps the CTA enabled', async () => {
    serve(() => res({ code: 'FORBIDDEN', message: 'nope' }, 403))
    renderIndex()
    await waitFor(() => expect(q('[data-panel="quota"] [data-state="error"]')).not.toBeNull())
    expect(q('[data-panel="quota"]')).toHaveTextContent('Quota information unavailable')
    expect(qa('[data-quota-scope]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it('a 500 on the quota read fails open the same way', async () => {
    serve(() => res({ code: 'INTERNAL', message: 'down' }, 500))
    renderIndex()
    await waitFor(() => expect(q('[data-panel="quota"] [data-state="error"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it.each([
    ['an empty object', {}],
    ['a null body', null],
    ['the retired { scopes } shape', { scopes: [{ scope: 'org_lists', current: 50, limit: 50 }] }],
    ['quotas that is not an array', { organization_id: 'org_x', quotas: 'nope' }],
  ])('a 200 with %s is treated as an unavailable read, not a crash', async (_label, body) => {
    serve(() => res(body))
    renderIndex()
    await waitFor(() => expect(q('[data-panel="quota"] [data-state="error"]')).not.toBeNull())
    expect(screen.getByRole('heading', { name: 'Selection Lists' })).toBeInTheDocument()
    expect(qa('[data-quota-scope]')).toHaveLength(0)
    // fail-open: an unreadable envelope must never lock the user out
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('shared-lists index (flag ON) reads the same envelope', () => {
  it('renders the four meters and keeps the CTA enabled', async () => {
    serve(() => res(contractQuota()))
    renderSharedIndex()
    await waitFor(() => expect(q('[data-quota-scope="org_lists"]')).not.toBeNull())
    expect(q('[data-quota-scope="org_lists"]')).toHaveTextContent('2 / 50')
    expect(qa('[data-quota-scope]')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it('at the ceiling disables the CTA', async () => {
    serve(() => res(contractQuota({ org_lists: 50 })))
    renderSharedIndex()
    await waitFor(() => expect(q('[data-banner="quota-at"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'New list' })).toBeDisabled()
  })

  it.each([
    ['the retired { scopes } shape', { scopes: [{ scope: 'org_lists', current: 50, limit: 50 }] }],
    ['a null body', null],
  ])('a 200 with %s is an unavailable read: no crash, CTA stays enabled', async (_label, body) => {
    serve(() => res(body))
    renderSharedIndex()
    await waitFor(() => expect(q('[data-panel="quota"] [data-state="error"]')).not.toBeNull())
    expect(q('[data-panel="quota"]')).toHaveTextContent('Quota information unavailable')
    expect(qa('[data-quota-scope]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })
})
