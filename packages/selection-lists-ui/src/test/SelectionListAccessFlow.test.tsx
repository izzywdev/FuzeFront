/**
 * SelectionListAccessFlow — frame 10 (access panel) and frame 11 (add-access
 * modal). `../api` is mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectionListAccessFlow, { SelectionListAccessFlow as NamedFlow } from '../SelectionListAccessFlow'
import * as api from '../api'
import { apiError, deferred, makeGrant, renderFlow, renderFlowSettled, NEVER } from './helpers'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    getAccessGrants: vi.fn(),
    updateAccessGrant: vi.fn(),
    revokeAccessGrant: vi.fn(),
    searchUsers: vi.fn(),
  }
})

const m = vi.mocked(api)

const ROUTE = '/settings/selection-lists/:listId/access'
const PATH = '/settings/selection-lists/sl_01/access'
const renderPanel = () => renderFlow(<NamedFlow />, PATH, [ROUTE])

const q = (sel: string, root: ParentNode = document) => root.querySelector(sel)
const qa = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel))
const row = (userId: string) => q(`[data-grant="${userId}"]`) as HTMLElement

const OWNER = makeGrant({ user_id: 'usr_alice', role: 'list-owner', is_sole_owner: true })
const TRANSLATOR = makeGrant({ user_id: 'usr_bob', role: 'list-translator' })
const VIEWER = makeGrant({ user_id: 'usr_cara', role: 'list-viewer' })

async function renderLoaded(grants = [OWNER, TRANSLATOR, VIEWER]) {
  m.getAccessGrants.mockResolvedValue(grants)
  const utils = renderPanel()
  await screen.findByRole('heading', { name: 'Access Control' })
  if (grants.length) await waitFor(() => expect(row(grants[0].user_id)).toBeInTheDocument())
  return { user: userEvent.setup(), ...utils }
}

beforeEach(() => {
  vi.resetAllMocks()
  m.getAccessGrants.mockResolvedValue([])
  m.updateAccessGrant.mockResolvedValue(makeGrant())
  m.revokeAccessGrant.mockResolvedValue(undefined)
  m.searchUsers.mockResolvedValue([])
})

// ─────────────────────────────────────────────────────────────────────────────
describe('SelectionListAccessFlow routing', () => {
  it('default and named exports are the same component', () => {
    expect(SelectionListAccessFlow).toBe(NamedFlow)
  })

  it('shows a clear message (and calls nothing) when :listId is missing', () => {
    renderFlow(<NamedFlow />, '/x')
    expect(screen.getByText('Missing list ID in URL.')).toBeInTheDocument()
    expect(m.getAccessGrants).not.toHaveBeenCalled()
  })

  it('loads grants for the :listId route param', async () => {
    await renderLoaded()
    expect(m.getAccessGrants).toHaveBeenCalledWith('sl_01')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 10 — access panel', () => {
  it('shows a loading state while grants load', async () => {
    m.getAccessGrants.mockReturnValue(NEVER)
    await renderFlowSettled(<NamedFlow />, PATH, [ROUTE])
    expect(screen.getByText('Loading access grants...')).toBeInTheDocument()
    expect(qa('[data-grant]')).toHaveLength(0)
  })

  it('shows the empty state with an Add Access prompt', async () => {
    renderPanel()
    await waitFor(() => expect(q('[data-state="empty"]')).not.toBeNull())
    expect(q('[data-state="empty"]')).toHaveTextContent('No access grants')
  })

  it('shows an error with Retry that reloads', async () => {
    const user = userEvent.setup()
    m.getAccessGrants.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'grants down'))
    renderPanel()
    await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
    expect(q('[data-state="error"]')).toHaveTextContent('Failed to load access grants.')

    m.getAccessGrants.mockResolvedValue([TRANSLATOR])
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(row('usr_bob')).toBeInTheDocument())
    expect(q('[data-state="error"]')).toBeNull()
  })

  it('renders one row per grant with its role and the sole-owner flag', async () => {
    await renderLoaded()
    expect(qa('[data-grant]')).toHaveLength(3)
    expect(row('usr_alice')).toHaveAttribute('data-role', 'list-owner')
    expect(row('usr_alice')).toHaveAttribute('data-sole-owner', 'true')
    expect(row('usr_alice')).toHaveTextContent('Sole owner')
    expect(row('usr_bob')).toHaveAttribute('data-role', 'list-translator')
    expect(row('usr_bob')).not.toHaveAttribute('data-sole-owner')
    expect(screen.getByLabelText('Role for usr_cara')).toHaveValue('list-viewer')
  })

  it('offers the three roles in each select', async () => {
    await renderLoaded()
    const options = within(screen.getByLabelText('Role for usr_bob')).getAllByRole('option')
    expect(options.map(o => o.getAttribute('value'))).toEqual(['list-owner', 'list-translator', 'list-viewer'])
  })

  it('changing a role PUTs {role} and re-syncs from the server', async () => {
    const user = userEvent.setup()
    m.getAccessGrants
      .mockResolvedValueOnce([OWNER, TRANSLATOR])
      .mockResolvedValueOnce([OWNER, { ...TRANSLATOR, role: 'list-viewer' }])
    renderPanel()
    await waitFor(() => expect(row('usr_bob')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Role for usr_bob'), 'list-viewer')
    await waitFor(() => expect(m.updateAccessGrant).toHaveBeenCalledWith('sl_01', 'usr_bob', { role: 'list-viewer' }))
    await waitFor(() => expect(m.getAccessGrants).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(row('usr_bob')).toHaveAttribute('data-role', 'list-viewer'))
    expect(screen.getByLabelText('Role for usr_bob')).toBeEnabled()
  })

  it('disables the row while a role change is in flight', async () => {
    const d = deferred<ReturnType<typeof makeGrant>>()
    m.updateAccessGrant.mockReturnValue(d.promise)
    const { user } = await renderLoaded([OWNER, TRANSLATOR])
    await user.selectOptions(screen.getByLabelText('Role for usr_bob'), 'list-viewer')

    await waitFor(() => expect(screen.getByLabelText('Role for usr_bob')).toBeDisabled())
    expect(screen.getByLabelText('Revoke access for usr_bob')).toBeDisabled()
    d.resolve(makeGrant())
    await waitFor(() => expect(screen.getByLabelText('Role for usr_bob')).toBeEnabled())
  })

  it('revoking DELETEs the grant and removes the row', async () => {
    const { user } = await renderLoaded()
    await user.click(screen.getByLabelText('Revoke access for usr_cara'))
    await waitFor(() => expect(m.revokeAccessGrant).toHaveBeenCalledWith('sl_01', 'usr_cara'))
    await waitFor(() => expect(row('usr_cara')).toBeNull())
    expect(row('usr_alice')).toBeInTheDocument()
  })

  describe('fail-closed: the last list-owner (409 CONFLICT)', () => {
    it('demoting the sole owner renders the error inline, reverts the select and re-enables Remove', async () => {
      m.updateAccessGrant.mockRejectedValue(apiError(409, 'CONFLICT', 'last owner'))
      const { user } = await renderLoaded([OWNER])
      const select = screen.getByLabelText('Role for usr_alice')

      // NOT pre-emptively disabled: the server is the authority
      expect(select).toBeEnabled()
      expect(screen.getByLabelText('Revoke access for usr_alice')).toBeEnabled()

      await user.selectOptions(select, 'list-viewer')

      await waitFor(() => expect(q('[data-error="CONFLICT"]', row('usr_alice'))).not.toBeNull())
      const err = q('[data-error="CONFLICT"]', row('usr_alice')) as HTMLElement
      expect(err).toHaveTextContent('Cannot demote/remove the sole owner.')
      expect(err).toHaveAttribute('data-case', 'last-owner')
      expect(screen.getByLabelText('Role for usr_alice')).toHaveValue('list-owner')
      expect(row('usr_alice')).toHaveAttribute('data-role', 'list-owner')
      expect(screen.getByLabelText('Revoke access for usr_alice')).toBeEnabled()
      // the panel is not locked down by a 409
      expect(q('[data-error="FORBIDDEN"]')).toBeNull()
      expect(screen.getByRole('button', { name: 'Add Access' })).toBeEnabled()
    })

    it('revoking the sole owner renders the same inline error and keeps the row', async () => {
      m.revokeAccessGrant.mockRejectedValue(apiError(409, 'CONFLICT', 'last owner'))
      const { user } = await renderLoaded([OWNER, TRANSLATOR])
      await user.click(screen.getByLabelText('Revoke access for usr_alice'))

      await waitFor(() => expect(q('[data-error="CONFLICT"]', row('usr_alice'))).not.toBeNull())
      expect(q('[data-case="last-owner"]', row('usr_alice'))).toBeInTheDocument()
      expect(row('usr_alice')).toBeInTheDocument()
      expect(screen.getByLabelText('Revoke access for usr_alice')).toBeEnabled()
      // sibling rows are untouched
      expect(q('[data-error]', row('usr_bob'))).toBeNull()
    })

    it('treats a bare HTTP 409 (no code) as the same last-owner conflict', async () => {
      m.revokeAccessGrant.mockRejectedValue(apiError(409, 'WHATEVER', 'x'))
      const { user } = await renderLoaded([OWNER])
      await user.click(screen.getByLabelText('Revoke access for usr_alice'))
      await waitFor(() => expect(q('[data-case="last-owner"]')).not.toBeNull())
    })
  })

  describe('fail-closed: without manage_access (403)', () => {
    it('a 403 on role change locks the whole panel read-only but keeps the table visible', async () => {
      m.updateAccessGrant.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
      const { user } = await renderLoaded([OWNER, TRANSLATOR])
      await user.selectOptions(screen.getByLabelText('Role for usr_bob'), 'list-viewer')

      await waitFor(() => expect(q('[data-error="FORBIDDEN"]')).not.toBeNull())
      expect(q('[data-error="FORBIDDEN"]')).toHaveTextContent(/table is read-only/)
      // governance stays legible: rows still rendered, role reverted
      expect(qa('[data-grant]')).toHaveLength(2)
      expect(screen.getByLabelText('Role for usr_bob')).toHaveValue('list-translator')
      // …and every control is disabled (not hidden)
      expect(screen.getByRole('button', { name: 'Add Access' })).toBeDisabled()
      for (const id of ['usr_alice', 'usr_bob']) {
        expect(screen.getByLabelText(`Role for ${id}`)).toBeDisabled()
        expect(screen.getByLabelText(`Revoke access for ${id}`)).toBeDisabled()
      }
      // the per-row slot does not duplicate the panel banner
      expect(q('[data-error="FORBIDDEN"]', row('usr_bob'))).toBeNull()
    })

    it('a 403 on revoke locks the panel and keeps the row', async () => {
      m.revokeAccessGrant.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
      const { user } = await renderLoaded([OWNER, TRANSLATOR])
      await user.click(screen.getByLabelText('Revoke access for usr_bob'))
      await waitFor(() => expect(q('[data-error="FORBIDDEN"]')).not.toBeNull())
      expect(row('usr_bob')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add Access' })).toBeDisabled()
    })

    it('an unexpected error code is shown on the row and does not lock the panel', async () => {
      m.updateAccessGrant.mockRejectedValue(apiError(500, 'BOOM', 'x'))
      const { user } = await renderLoaded([OWNER, TRANSLATOR])
      await user.selectOptions(screen.getByLabelText('Role for usr_bob'), 'list-viewer')
      await waitFor(() => expect(q('[data-error="BOOM"]', row('usr_bob'))).not.toBeNull())
      expect(screen.getByLabelText('Role for usr_bob')).toHaveValue('list-translator')
      expect(screen.getByRole('button', { name: 'Add Access' })).toBeEnabled()
    })
  })

  describe('role capability matrix', () => {
    const cells = (role: string) =>
      Array.from((q(`[data-panel="role-matrix"] tr[data-role="${role}"]`) as HTMLElement).querySelectorAll('td')).map(
        td => td.textContent,
      )

    it('is an accessibly named table with owner / translator / viewer rows', async () => {
      await renderLoaded()
      const table = screen.getByRole('table', { name: 'Role capability matrix' })
      expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual([
        'Role',
        'View',
        'Translate',
        'Manage Values',
        'Manage Access',
      ])
      expect(qa('[data-panel="role-matrix"] tbody tr')).toHaveLength(3)
    })

    it('list-translator can translate but cannot manage values or access', async () => {
      await renderLoaded()
      expect(cells('list-translator')).toEqual(['Translator', '✓', '✓', '—', '—'])
    })

    it('list-owner can do everything; list-viewer can only view', async () => {
      await renderLoaded()
      expect(cells('list-owner')).toEqual(['List Owner', '✓', '✓', '✓', '✓'])
      expect(cells('list-viewer')).toEqual(['Viewer', '✓', '—', '—', '—'])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 11 — add-access modal', () => {
  const searchBox = () => q('[data-user-search]') as HTMLInputElement

  async function openModal(grants = [OWNER]) {
    const utils = await renderLoaded(grants)
    await utils.user.click(screen.getByRole('button', { name: 'Add Access' }))
    const dialog = screen.getByRole('dialog')
    return { ...utils, dialog, confirm: () => q('[data-action="confirm-add-access"]', dialog) as HTMLButtonElement }
  }

  it('opens as an aria-modal dialog with the confirm disabled until a user is chosen', async () => {
    const { dialog, confirm } = await openModal()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(q('[data-modal="add-access"]', dialog)).toBeInTheDocument()
    expect(confirm()).toBeDisabled()
    expect(q('[data-role-select]', dialog)).toHaveValue('list-viewer')
  })

  it('searches (debounced), shows loading immediately, then the results', async () => {
    m.searchUsers.mockResolvedValue([
      { id: 'usr_dan', name: 'Dan Doe', email: 'dan@example.com' },
      { id: 'usr_eve', name: 'Eve Roe', email: 'eve@example.com' },
    ])
    const { user, dialog } = await openModal()
    await user.type(searchBox(), 'd')

    expect(q('[data-panel="user-search"][data-state="loading"]', dialog)).toBeInTheDocument()
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    expect(q('[data-user="usr_eve"]', dialog)).toBeInTheDocument()
    expect(m.searchUsers).toHaveBeenCalledWith('d')
    expect(m.searchUsers).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveTextContent('dan@example.com')
  })

  it('debounces rapid typing into a single search for the final text', async () => {
    m.searchUsers.mockResolvedValue([{ id: 'usr_dan', name: 'Dan', email: 'd@x.io' }])
    const { user } = await openModal()
    await user.type(searchBox(), 'dan')
    await waitFor(() => expect(m.searchUsers).toHaveBeenCalledWith('dan'))
    expect(m.searchUsers).toHaveBeenCalledTimes(1)
  })

  it('shows the no-matches state', async () => {
    m.searchUsers.mockResolvedValue([])
    const { user, dialog } = await openModal()
    await user.type(searchBox(), 'zzz')
    await waitFor(() => expect(q('[data-panel="user-search"][data-state="empty"]', dialog)).not.toBeNull())
    expect(dialog).toHaveTextContent('No users found.')
  })

  it('a failed search falls back to the no-matches state (does not throw)', async () => {
    m.searchUsers.mockRejectedValue(apiError(500, 'INTERNAL', 'search down'))
    const { user, dialog } = await openModal()
    await user.type(searchBox(), 'zzz')
    await waitFor(() => expect(q('[data-state="empty"]', dialog)).not.toBeNull())
  })

  it('clearing the search returns to idle (no loading / empty panels)', async () => {
    const { user, dialog } = await openModal()
    await user.type(searchBox(), 'a')
    await user.clear(searchBox())
    expect(q('[data-panel="user-search"]', dialog)).toBeNull()
    expect(m.searchUsers).not.toHaveBeenCalled()
  })

  it('a user who already holds a role is marked and cannot be added twice', async () => {
    m.searchUsers.mockResolvedValue([
      { id: 'usr_alice', name: 'Alice', email: 'a@x.io' }, // already in grants, flag omitted by the API
      { id: 'usr_dan', name: 'Dan', email: 'd@x.io', already_granted: true },
    ])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'a')
    await waitFor(() => expect(q('[data-user="usr_alice"]', dialog)).not.toBeNull())

    expect(q('[data-user="usr_alice"]', dialog)).toHaveAttribute('data-already-granted', 'true')
    expect(q('[data-user="usr_dan"]', dialog)).toHaveAttribute('data-already-granted', 'true')
    expect(q('[data-user="usr_alice"]', dialog)).toHaveTextContent('Already granted')

    await user.click(q('[data-user="usr_alice"]', dialog) as HTMLElement)
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    expect(confirm()).toBeDisabled()
    expect(m.updateAccessGrant).not.toHaveBeenCalled()
  })

  it('confirm PUTs {role} for the chosen user, closes, and reloads the grants', async () => {
    m.searchUsers.mockResolvedValue([{ id: 'usr_dan', name: 'Dan', email: 'd@x.io' }])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'dan')
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    expect(confirm()).toBeEnabled()
    await user.selectOptions(q('[data-role-select]', dialog) as HTMLSelectElement, 'list-translator')

    m.getAccessGrants.mockResolvedValue([OWNER, makeGrant({ user_id: 'usr_dan', role: 'list-translator' })])
    await user.click(confirm())

    await waitFor(() =>
      expect(m.updateAccessGrant).toHaveBeenCalledWith('sl_01', 'usr_dan', { role: 'list-translator' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(row('usr_dan')).toBeInTheDocument())
    expect(row('usr_dan')).toHaveAttribute('data-role', 'list-translator')
  })

  it('defaults the role to the least-privileged list-viewer', async () => {
    m.searchUsers.mockResolvedValue([{ id: 'usr_dan', name: 'Dan', email: 'd@x.io' }])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'dan')
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    await user.click(confirm())
    await waitFor(() =>
      expect(m.updateAccessGrant).toHaveBeenCalledWith('sl_01', 'usr_dan', { role: 'list-viewer' }),
    )
  })

  it('shows "Adding..." and blocks a second confirm while in flight', async () => {
    const d = deferred<ReturnType<typeof makeGrant>>()
    m.updateAccessGrant.mockReturnValue(d.promise)
    m.searchUsers.mockResolvedValue([{ id: 'usr_dan', name: 'Dan', email: 'd@x.io' }])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'dan')
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    await user.click(confirm())

    await waitFor(() => expect(confirm()).toHaveTextContent('Adding...'))
    expect(confirm()).toBeDisabled()
    expect(m.updateAccessGrant).toHaveBeenCalledTimes(1)
    d.resolve(makeGrant())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('404 NOT_FOUND (user left the org mid-dialog) shows the error and drops them from results', async () => {
    m.updateAccessGrant.mockRejectedValue(apiError(404, 'NOT_FOUND', 'gone'))
    m.searchUsers.mockResolvedValue([
      { id: 'usr_dan', name: 'Dan', email: 'd@x.io' },
      { id: 'usr_eve', name: 'Eve', email: 'e@x.io' },
    ])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'x')
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    await user.click(confirm())

    await waitFor(() => expect(q('[data-error="NOT_FOUND"]', dialog)).not.toBeNull())
    expect(q('[data-error="NOT_FOUND"]', dialog)).toHaveTextContent('User not found in the organization.')
    expect(q('[data-user="usr_dan"]', dialog)).toBeNull()
    expect(q('[data-user="usr_eve"]', dialog)).toBeInTheDocument()
    expect(confirm()).toBeDisabled() // selection was cleared
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('fail-closed: 403 FORBIDDEN disables the confirm and role select and explains why', async () => {
    m.updateAccessGrant.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
    m.searchUsers.mockResolvedValue([{ id: 'usr_dan', name: 'Dan', email: 'd@x.io' }])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'dan')
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    await user.click(confirm())

    await waitFor(() => expect(q('[data-error="FORBIDDEN"]', dialog)).not.toBeNull())
    expect(q('[data-error="FORBIDDEN"]', dialog)).toHaveTextContent(/do not have permission to manage access/)
    expect(confirm()).toBeDisabled()
    expect(q('[data-role-select]', dialog)).toBeDisabled()
  })

  it('surfaces any other API error code verbatim and keeps the dialog open', async () => {
    m.updateAccessGrant.mockRejectedValue(apiError(500, 'EXPLODED', 'x'))
    m.searchUsers.mockResolvedValue([{ id: 'usr_dan', name: 'Dan', email: 'd@x.io' }])
    const { user, dialog, confirm } = await openModal([OWNER])
    await user.type(searchBox(), 'dan')
    await waitFor(() => expect(q('[data-user="usr_dan"]', dialog)).not.toBeNull())
    await user.click(q('[data-user="usr_dan"]', dialog) as HTMLElement)
    await user.click(confirm())
    expect(await within(dialog).findByText('Error: EXPLODED')).toBeInTheDocument()
    expect(confirm()).toBeEnabled()
  })

  it('Cancel closes without calling the API', async () => {
    const { user, dialog } = await openModal()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.updateAccessGrant).not.toHaveBeenCalled()
  })

  it('focuses the search box on open (keyboard users land in the dialog)', async () => {
    await openModal()
    expect(searchBox()).toHaveFocus()
  })

  // a11y: "Search users" / "Role" labels are not associated with their controls
  // (no htmlFor / nesting), so the fields have no accessible name. `it.fails`
  // pins the gap and will flip red once the labels are wired up.
  it.fails('a11y: the search and role controls are named by their labels (KNOWN GAP)', async () => {
    await openModal()
    expect(screen.getByLabelText('Search users')).toBeInTheDocument()
    expect(screen.getByLabelText('Role', { selector: 'select' })).toBeInTheDocument()
  })
})
