/**
 * The Access tab mounts VisibilityControl at its top (frame 08) and hands it the
 * outcome of its own roster call: 200 = manage_access observed, 403 = read-only.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionListAccessFlow } from '../../SelectionListAccessFlow'
import { SharedListsFeatureProvider } from '../core'
import { BASE, callsTo, err, forkList, routedFetch } from '../../test/visibilityHarness'
import { jsonResponse } from '../../test/sharedListsFixtures'

const list = forkList()
const GRANTS = [
  { user_id: 'usr_owner', role: 'list-owner', granted_by: 'usr_x', granted_at: '2026-09-02T09:14:00Z', is_sole_owner: true },
]
const q = (sel: string) => document.querySelector<HTMLElement>(sel)

function mount(flag: boolean) {
  return render(
    <SharedListsFeatureProvider sharedLists={flag}>
      <MemoryRouter initialEntries={[`/settings/selection-lists/${list.id}/access`]}>
        <Routes>
          <Route
            path="/settings/selection-lists/:listId/access"
            element={<SelectionListAccessFlow organizationName="Acme Logistics" />}
          />
        </Routes>
      </MemoryRouter>
    </SharedListsFeatureProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SelectionListAccessFlow + VisibilityControl', () => {
  it('flag ON, roster 200: the control sits ABOVE the 4.0.0 roster and is editable', async () => {
    const fetchMock = routedFetch({
      [`GET ${BASE}/${list.id}/access`]: () => jsonResponse(GRANTS),
      [`GET ${BASE}/${list.id}`]: () => jsonResponse(list),
    })
    mount(true)
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'ready'))
    const control = q("[data-panel='visibility-control']")!
    const roster = q("[data-panel='access']")!
    expect(control.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(q("[data-visibility-option='org']")).toHaveTextContent('Everyone in Acme Logistics')
    // ONE roster call: the control shares the tab's observation, it does not race a second request.
    expect(callsTo(fetchMock, 'GET', `${BASE}/${list.id}/access`)).toHaveLength(1)
  })

  it('flag ON, roster 403: the control is a read-only statement; the 4.0.0 panel keeps its own error', async () => {
    routedFetch({
      [`GET ${BASE}/${list.id}/access`]: () => err(403, 'FORBIDDEN'),
      [`GET ${BASE}/${list.id}`]: () => jsonResponse(list),
    })
    mount(true)
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'read-only'))
    expect(q('[data-visibility-option]')).toBeNull()
    expect(screen.getByText(/failed to load access grants/i)).toBeInTheDocument()
  })

  it('flag ON, roster 500: the control shows its error; Retry re-reads the roster and recovers', async () => {
    let fail = true
    const fetchMock = routedFetch({
      [`GET ${BASE}/${list.id}/access`]: () => (fail ? err(500, 'INTERNAL') : jsonResponse(GRANTS)),
      [`GET ${BASE}/${list.id}`]: () => jsonResponse(list),
    })
    mount(true)
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'error'))
    fail = false
    await userEvent.setup().click(q("[data-panel='visibility-control'] [data-action='retry']")!)
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'ready'))
    expect(callsTo(fetchMock, 'GET', `${BASE}/${list.id}/access`)).toHaveLength(2)
  })

  it('flag OFF: no control and no list read — the Access tab is the 4.0.0 panel', async () => {
    const fetchMock = routedFetch({
      [`GET ${BASE}/${list.id}/access`]: () => jsonResponse(GRANTS),
    })
    mount(false)
    await waitFor(() => expect(q("[data-panel='access']")).not.toBeNull())
    await waitFor(() => expect(q('[data-grant]')).not.toBeNull())
    expect(q("[data-panel='visibility-control']")).toBeNull()
    expect(callsTo(fetchMock, 'GET', `${BASE}/${list.id}`)).toHaveLength(0)
  })

  it('a 403 after the first read (roster refresh after demoting yourself) turns the control read-only', async () => {
    const two = [
      ...GRANTS,
      { user_id: 'usr_other', role: 'list-owner', granted_by: 'usr_x', granted_at: '2026-09-03T09:14:00Z', is_sole_owner: false },
    ]
    let reads = 0
    const fetchMock = routedFetch({
      [`GET ${BASE}/${list.id}/access`]: () => (++reads === 1 ? jsonResponse(two) : err(403, 'FORBIDDEN')),
      [`PUT ${BASE}/${list.id}/access/usr_owner`]: () => jsonResponse({ ...two[0], role: 'list-viewer' }),
      [`GET ${BASE}/${list.id}`]: () => jsonResponse(list),
    })
    mount(true)
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'ready'))
    await userEvent.setup().selectOptions(q("[data-grant='usr_owner'] [data-role-select]")!, 'list-viewer')
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'read-only'))
    expect(q('[data-visibility-option]')).toBeNull()
    expect(callsTo(fetchMock, 'PATCH', `${BASE}/${list.id}`)).toHaveLength(0)
  })

  it('navigating to another list starts a clean control (no stale confirm or roster observation)', async () => {
    const other = forkList({ id: 'front_sl_01jfq3w8z6y5x4c3b2a1n9m8k8', name: 'Severity' })
    const fetchMock = routedFetch({
      [`GET ${BASE}/${list.id}/access`]: () => jsonResponse(GRANTS),
      [`GET ${BASE}/${list.id}`]: () => jsonResponse(list),
      [`GET ${BASE}/${other.id}/access`]: () => err(403, 'FORBIDDEN'),
      [`GET ${BASE}/${other.id}`]: () => jsonResponse(other),
      [`PATCH ${BASE}/${other.id}`]: () => jsonResponse(other),
    })
    function Nav() {
      const navigate = useNavigate()
      return <button onClick={() => navigate(`/settings/selection-lists/${other.id}/access`)}>go</button>
    }
    render(
      <SharedListsFeatureProvider sharedLists>
        <MemoryRouter initialEntries={[`/settings/selection-lists/${list.id}/access`]}>
          <Nav />
          <Routes>
            <Route path="/settings/selection-lists/:listId/access" element={<SelectionListAccessFlow />} />
          </Routes>
        </MemoryRouter>
      </SharedListsFeatureProvider>
    )
    const user = userEvent.setup()
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'ready'))
    await user.click(q("[data-visibility-option='private']")!)
    expect(q("[data-confirm='visibility-to-private']")).not.toBeNull()
    await user.click(screen.getByText('go'))
    await waitFor(() => expect(q("[data-panel='visibility-control']")).toHaveAttribute('data-state', 'read-only'))
    expect(q('[data-confirm]')).toBeNull()
    expect(callsTo(fetchMock, 'PATCH', `${BASE}/${other.id}`)).toHaveLength(0)
  })
})
