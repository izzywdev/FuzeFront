/**
 * SelectionListManagementFlow — frames 01-06 (index, new list, detail / value
 * editor, value + purge modals, reorder, quota).
 *
 * The data layer (`../api`) is mocked at the module boundary; unwrapItems /
 * unwrapCursor stay real so the paged-envelope handling is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionListManagementFlow } from '../SelectionListManagementFlow'
import * as api from '../api'
import {
  apiError,
  deferred,
  makeItem,
  makeList,
  makeQuota,
  renderFlow,
  renderFlowSettled,
  NEVER,
} from './helpers'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listSelectionLists: vi.fn(),
    createSelectionList: vi.fn(),
    getSelectionList: vi.fn(),
    listItems: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    archiveItem: vi.fn(),
    purgeItem: vi.fn(),
    reorderItems: vi.fn(),
    getQuota: vi.fn(),
    probeReorderPermission: vi.fn(),
  }
})

const m = vi.mocked(api)

const INDEX = '/settings/selection-lists'
const DETAIL = '/settings/selection-lists/:listId'

function renderIndex() {
  return renderFlow(<SelectionListManagementFlow />, INDEX, [INDEX, DETAIL])
}
async function renderIndexSettled() {
  return renderFlowSettled(<SelectionListManagementFlow />, INDEX, [INDEX, DETAIL])
}
async function renderDetailSettled(listId = 'sl_01') {
  return renderFlowSettled(<SelectionListManagementFlow />, `${INDEX}/${listId}`, [INDEX, DETAIL])
}
function renderDetail(listId = 'sl_01') {
  return renderFlow(<SelectionListManagementFlow />, `${INDEX}/${listId}`, [INDEX, DETAIL])
}
const q = (sel: string, root: ParentNode = document) => root.querySelector(sel)
const qa = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel))
const itemOrder = () => qa('[data-item]').map(el => el.getAttribute('data-item'))

beforeEach(() => {
  vi.resetAllMocks()
  m.listSelectionLists.mockResolvedValue({ data: [], page: { hasMore: false } })
  m.getQuota.mockResolvedValue(makeQuota())
  m.getSelectionList.mockResolvedValue(makeList())
  m.listItems.mockResolvedValue({ data: [] })
  m.probeReorderPermission.mockResolvedValue(true)
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 01 — list index', () => {
  it('shows skeleton rows while the lists are loading', async () => {
    m.listSelectionLists.mockReturnValue(NEVER)
    await renderIndexSettled()
    expect(qa('[data-panel="list-index"] [data-state="loading"]').length).toBeGreaterThanOrEqual(3)
    expect(q('[data-state="empty"]')).toBeNull()
  })

  it('renders the org lists with key, item count, M badge and archived badge', async () => {
    m.listSelectionLists.mockResolvedValue({
      data: [
        makeList({ id: 'sl_1', key: 'countries', name: 'Countries', item_count: 12 }),
        makeList({ id: 'sl_2', key: 'regions', name: 'Regions', is_machine: true }),
        makeList({ id: 'sl_3', key: 'legacy', name: 'Legacy', status: 'archived' }),
      ],
    })
    renderIndex()

    expect(await screen.findByText('Countries')).toBeInTheDocument()
    const countries = q('[data-list="countries"]')!
    expect(within(countries as HTMLElement).getByText('countries')).toBeInTheDocument()
    expect(within(countries as HTMLElement).getByText('12 items')).toBeInTheDocument()
    expect(q('[data-list="countries"] [data-machine="true"]')).toBeNull()
    expect(q('[data-list="regions"] [data-machine="true"]')).toHaveTextContent('M')
    expect(q('[data-list="legacy"]')).toHaveAttribute('data-status', 'archived')
    expect(within(q('[data-list="legacy"]') as HTMLElement).getByText('Archived')).toBeInTheDocument()
  })

  it('requests the active status by default and re-queries when the filter changes', async () => {
    const user = userEvent.setup()
    renderIndex()
    await waitFor(() => expect(m.listSelectionLists).toHaveBeenCalledWith({ cursor: undefined, status: 'active' }))

    await user.selectOptions(q('[data-filter="status"]') as HTMLSelectElement, 'archived')
    await waitFor(() =>
      expect(m.listSelectionLists).toHaveBeenLastCalledWith({ cursor: undefined, status: 'archived' }),
    )
  })

  it('follows page.nextCursor on "Load more", appends rows and hides the button at the end', async () => {
    const user = userEvent.setup()
    m.listSelectionLists
      .mockResolvedValueOnce({
        data: [makeList({ id: 'sl_1', key: 'one', name: 'One' })],
        page: { nextCursor: 'cur_2', hasMore: true },
      })
      .mockResolvedValueOnce({
        data: [makeList({ id: 'sl_2', key: 'two', name: 'Two' })],
        page: { nextCursor: null, hasMore: false },
      })
    renderIndex()

    await screen.findByText('One')
    await user.click(q('[data-action="load-more"]') as HTMLElement)

    await screen.findByText('Two')
    expect(m.listSelectionLists).toHaveBeenLastCalledWith({ cursor: 'cur_2', status: 'active' })
    // earlier rows are kept, and the pager is gone once hasMore is false
    expect(screen.getByText('One')).toBeInTheDocument()
    expect(q('[data-action="load-more"]')).toBeNull()
  })

  it('also honours the flat next_cursor envelope', async () => {
    m.listSelectionLists.mockResolvedValue({ items: [makeList()], next_cursor: 'c9' })
    renderIndex()
    await screen.findByText('Countries')
    expect(q('[data-action="load-more"]')).toBeInTheDocument()
  })

  it('shows the empty state with a create CTA that opens the new-list form', async () => {
    const user = userEvent.setup()
    renderIndex()
    const empty = await waitFor(() => {
      const el = q('[data-state="empty"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(empty).toHaveTextContent('No lists yet.')
    await user.click(within(empty).getByRole('button', { name: 'Create your first list' }))
    expect(q('[data-frame="02-new-list"]')).toBeInTheDocument()
  })

  it('shows an error with Retry, and Retry reloads the lists', async () => {
    const user = userEvent.setup()
    m.listSelectionLists.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'Lists exploded'))
    renderIndex()

    const err = await waitFor(() => {
      const el = q('[data-state="error"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(err).toHaveTextContent('Lists exploded')
    // an error is not the empty state
    expect(q('[data-panel="list-index"] [data-state="empty"]')).toBeNull()

    m.listSelectionLists.mockResolvedValueOnce({ data: [makeList()] })
    await user.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Countries')).toBeInTheDocument()
    expect(q('[data-state="error"]')).toBeNull()
  })

  it('navigates to the list detail when a row is clicked', async () => {
    const user = userEvent.setup()
    m.listSelectionLists.mockResolvedValue({ data: [makeList({ id: 'sl_42' })] })
    renderIndex()
    await user.click(await screen.findByText('Countries'))
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_42')
  })

  it('rows are keyboard operable (role=button, Enter activates)', async () => {
    const user = userEvent.setup()
    m.listSelectionLists.mockResolvedValue({ data: [makeList({ id: 'sl_7' })] })
    renderIndex()
    const row = await waitFor(() => {
      const el = q('[data-list="countries"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(row).toHaveAttribute('role', 'button')
    row.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_7')
  })

  it('exposes the page heading and a labelled status filter', async () => {
    renderIndex()
    expect(await screen.findByRole('heading', { name: 'Selection Lists' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('active')
    expect(screen.getByRole('button', { name: 'New list' })).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 06 — quota', () => {
  it('shows meters: current/limit for list scopes, "— / limit" for server-side scopes', async () => {
    renderIndex()
    await waitFor(() => expect(q('[data-quota-scope="org_lists"]')).not.toBeNull())
    expect(q('[data-quota-scope="org_lists"]')).toHaveTextContent('2 / 50')
    expect(q('[data-quota-scope="user_lists"]')).toHaveTextContent('1 / 10')
    expect(q('[data-quota-scope="list_items"]')).toHaveTextContent('— / 500')
    expect(q('[data-quota-scope="list_locales"]')).toHaveTextContent('— / 11')
    expect(qa('[data-quota-scope]')).toHaveLength(4)
    expect(q('[data-banner="quota-near"]')).toBeNull()
    expect(q('[data-banner="quota-at"]')).toBeNull()
  })

  it('warns at >= 80% but keeps the CTA enabled', async () => {
    m.getQuota.mockResolvedValue(makeQuota({ org_lists: [45, 50] }))
    renderIndex()
    await waitFor(() => expect(q('[data-banner="quota-near"]')).not.toBeNull())
    expect(q('[data-banner="quota-at"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it('at the ceiling disables the CTA (with a quota tooltip hook) and shows the at-limit banner', async () => {
    m.getQuota.mockResolvedValue(makeQuota({ org_lists: [50, 50] }))
    renderIndex()
    await waitFor(() => expect(q('[data-banner="quota-at"]')).not.toBeNull())
    const cta = screen.getByRole('button', { name: 'New list' })
    expect(cta).toBeDisabled()
    expect(cta).toHaveAttribute('data-quota-state', 'at-limit')
    expect(cta).toHaveAttribute('data-tooltip', 'quota')
  })

  it('fails OPEN: if the quota call fails the meters hide and the CTA stays enabled', async () => {
    m.getQuota.mockRejectedValue(apiError(500, 'INTERNAL', 'quota down'))
    renderIndex()
    await waitFor(() => expect(q('[data-panel="quota"] [data-state="error"]')).not.toBeNull())
    expect(q('[data-panel="quota"]')).toHaveTextContent('Quota information unavailable')
    expect(qa('[data-quota-scope]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'New list' })).toBeEnabled()
  })

  it('shows a loading placeholder while quota is in flight', async () => {
    m.getQuota.mockReturnValue(NEVER)
    await renderIndexSettled()
    expect(q('[data-panel="quota"] [data-state="loading"]')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 02 — new list', () => {
  async function openNewList() {
    const user = userEvent.setup()
    renderIndex()
    await user.click(await screen.findByRole('button', { name: 'New list' }))
    return user
  }
  const keyInput = () => q('[data-field="key"]') as HTMLInputElement

  it('blocks submit and shows the field-level error for an invalid slug', async () => {
    const user = await openNewList()
    await user.type(keyInput(), 'Bad Key!')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    expect(q('[data-field-error="key"]')).toHaveTextContent(/\^\[a-z0-9\]/)
    expect(q('[data-error="VALIDATION_ERROR"]')).toBeInTheDocument()
    expect(m.createSelectionList).not.toHaveBeenCalled()
  })

  it.each(['a', '-abc', 'abc-', 'UPPER', 'a'.repeat(65)])('rejects key %j', async bad => {
    const user = await openNewList()
    await user.type(keyInput(), bad)
    await user.click(screen.getByRole('button', { name: 'Create list' }))
    expect(m.createSelectionList).not.toHaveBeenCalled()
  })

  it('creates the list WITHOUT an id (service mints it) and navigates to the detail', async () => {
    m.createSelectionList.mockResolvedValue(makeList({ id: 'sl_new', key: 'my-list' }))
    const user = await openNewList()
    await user.type(keyInput(), 'my-list')
    await user.selectOptions(q('[data-field="source_locale"]') as HTMLSelectElement, 'fr')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    await waitFor(() =>
      expect(m.createSelectionList).toHaveBeenCalledWith({ key: 'my-list', source_locale: 'fr' }),
    )
    expect(Object.keys(m.createSelectionList.mock.calls[0][0])).not.toContain('id')
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_new'),
    )
  })

  it('disables the button and both identity fields while submitting (no double-submit)', async () => {
    const d = deferred<ReturnType<typeof makeList>>()
    m.createSelectionList.mockReturnValue(d.promise)
    const user = await openNewList()
    await user.type(keyInput(), 'my-list')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    await waitFor(() => expect(q('[data-state="submitting"]')).not.toBeNull())
    expect(keyInput()).toBeDisabled()
    expect(q('[data-field="source_locale"]')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
    expect(m.createSelectionList).toHaveBeenCalledTimes(1)

    d.resolve(makeList({ id: 'sl_new' }))
    await waitFor(() => expect(q('[data-state="submitting"]')).toBeNull())
  })

  it('surfaces a 409 CONFLICT (duplicate key) and re-enables the form', async () => {
    m.createSelectionList.mockRejectedValue(apiError(409, 'CONFLICT', 'dup'))
    const user = await openNewList()
    await user.type(keyInput(), 'countries')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    expect(await screen.findByText('A list with that key already exists.')).toBeInTheDocument()
    expect(q('[data-error="CONFLICT"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create list' })).toBeEnabled()
  })

  it('names scope, current and limit on 403 QUOTA_EXCEEDED', async () => {
    m.createSelectionList.mockRejectedValue(
      apiError(403, 'QUOTA_EXCEEDED', 'quota', { scope: 'org_lists', current: 50, limit: 50 }),
    )
    const user = await openNewList()
    await user.type(keyInput(), 'another')
    await user.click(screen.getByRole('button', { name: 'Create list' }))
    expect(await screen.findByText('Quota exceeded: org_lists (50/50)')).toBeInTheDocument()
  })

  it('403 FORBIDDEN disables (does not hide) the create CTA', async () => {
    m.createSelectionList.mockRejectedValue(apiError(403, 'FORBIDDEN', 'nope'))
    const user = await openNewList()
    await user.type(keyInput(), 'another')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    expect(await screen.findByText('You do not have permission to create lists.')).toBeInTheDocument()
    const cta = screen.getByRole('button', { name: 'Create list' })
    expect(cta).toBeInTheDocument()
    expect(cta).toBeDisabled()
  })

  it('Cancel returns to the index', async () => {
    const user = await openNewList()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(q('[data-frame="01-list-index"]')).toBeInTheDocument()
    expect(q('[data-frame="02-new-list"]')).toBeNull()
  })

  // a11y: each visible <label> should be programmatically tied to its control.
  // Today the labels are plain siblings (no htmlFor / nesting), so assistive
  // tech cannot name the inputs. `it.fails` pins the defect: when the labels are
  // associated this test starts passing and vitest will force the marker off.
  it.fails('a11y: the key and locale controls are named by their labels (KNOWN GAP)', async () => {
    await openNewList()
    expect(screen.getByLabelText('Key (slug)')).toBeInTheDocument()
    expect(screen.getByLabelText('Source locale')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 03 — list detail / value editor', () => {
  const A = makeItem({ id: 'sli_1', code: 'AT', label: 'Austria', sort_order: 1 })
  const B = makeItem({ id: 'sli_2', code: 'BE', label: 'Belgium', sort_order: 2 })
  const C = makeItem({ id: 'sli_3', code: 'CH', label: 'Switzerland', sort_order: 3 })

  async function renderLoadedDetail(items = [A, B, C]) {
    m.listItems.mockResolvedValue({ data: items })
    const utils = renderDetail()
    await screen.findByRole('heading', { name: 'Countries' })
    return { user: userEvent.setup(), ...utils }
  }

  it('shows skeletons while loading', async () => {
    m.getSelectionList.mockReturnValue(NEVER)
    await renderDetailSettled()
    expect(qa('[data-frame="03-list-detail"] [data-state="loading"]').length).toBeGreaterThan(0)
  })

  it('loads the list and its items for the :listId route param', async () => {
    await renderLoadedDetail()
    expect(m.getSelectionList).toHaveBeenCalledWith('sl_01')
    expect(m.listItems).toHaveBeenCalledWith('sl_01')
    expect(m.probeReorderPermission).toHaveBeenCalledWith('sl_01')
  })

  it('renders values in sort_order regardless of response order', async () => {
    await renderLoadedDetail([C, A, B])
    expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
  })

  it('keeps archived rows visible (badged, no Archive button) but still offers Purge', async () => {
    await renderLoadedDetail([A, { ...B, status: 'archived' }])
    const archived = q('[data-item="sli_2"]') as HTMLElement
    expect(archived).toHaveAttribute('data-archived', 'true')
    expect(within(archived).getByText('Archived')).toBeInTheDocument()
    expect(q('[data-item="sli_2"] [data-action="archive-value"]')).toBeNull()
    expect(q('[data-item="sli_2"] [data-action="purge-value"]')).toBeInTheDocument()
    expect(q('[data-item="sli_1"] [data-action="archive-value"]')).toBeInTheDocument()
  })

  it('badges machine-translated values and lists', async () => {
    m.getSelectionList.mockResolvedValue(makeList({ is_machine: true, status: 'archived' }))
    await renderLoadedDetail([{ ...A, is_machine: true }])
    expect(q('[data-panel="value-editor"]')).toBeInTheDocument()
    expect(qa('[data-machine="true"]').length).toBeGreaterThanOrEqual(1)
    expect(q('[data-status="archived"]')).toBeInTheDocument()
  })

  it('shows the empty state when the list has no values', async () => {
    await renderLoadedDetail([])
    expect(q('[data-state="empty"]')).toHaveTextContent('No values yet')
  })

  it('shows an error with Retry that reloads', async () => {
    const user = userEvent.setup()
    m.getSelectionList.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'detail down'))
    renderDetail()
    const err = await waitFor(() => {
      const el = q('[data-frame="03-list-detail"][data-state="error"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(err).toHaveTextContent('detail down')

    m.listItems.mockResolvedValue({ data: [A] })
    await user.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Countries' })).toBeInTheDocument()
  })

  it.each([
    ['HTTP 404', apiError(404, 'SOMETHING', 'x')],
    ['code NOT_FOUND', apiError(400, 'NOT_FOUND', 'x')],
  ])('renders the not-found state on %s (never a 403 oracle)', async (_n, err) => {
    m.getSelectionList.mockRejectedValue(err)
    renderDetail('sl_other_org')
    await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
    expect(q('[data-error="NOT_FOUND"]')).toHaveTextContent('List not found.')
    expect(q('[data-panel="value-editor"]')).toBeNull()
  })

  it('does not treat a 403 as not-found (it is a plain error)', async () => {
    m.getSelectionList.mockRejectedValue(apiError(403, 'FORBIDDEN', 'forbidden!'))
    renderDetail()
    await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
    expect(q('[data-state="not-found"]')).toBeNull()
  })

  it('tabs navigate to translations and access for the same list', async () => {
    const { user } = await renderLoadedDetail()
    await user.click(q('[data-tab="access"]') as HTMLElement)
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_01/access')
  })

  it('translations tab navigates to the workbench', async () => {
    const { user } = await renderLoadedDetail()
    await user.click(q('[data-tab="translations"]') as HTMLElement)
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_01/translations')
  })

  describe('add / edit value modal (frame 04)', () => {
    it('adds a value: code is editable, POST carries code+label, row appended', async () => {
      const created = makeItem({ id: 'sli_9', code: 'FR', label: 'France', sort_order: 9 })
      m.createItem.mockResolvedValue(created)
      const { user } = await renderLoadedDetail()

      await user.click(screen.getByRole('button', { name: 'Add value' }))
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('data-modal', 'add-value')
      const code = q('[data-field="code"]', dialog) as HTMLInputElement
      expect(code).toBeEnabled()
      expect(q('[data-item-id]', dialog)).toBeNull()

      await user.type(code, 'FR')
      await user.type(q('[data-field="label"]', dialog) as HTMLInputElement, 'France')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(m.createItem).toHaveBeenCalledWith('sl_01', { code: 'FR', label: 'France' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3', 'sli_9'])
    })

    it('edit locks the code and reveals the immutable service-minted id', async () => {
      m.updateItem.mockResolvedValue({ ...A, label: 'Österreich' })
      const { user } = await renderLoadedDetail()

      await user.click(screen.getByText('Austria'))
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('data-modal', 'edit-value')
      expect(q('[data-field="code"]', dialog)).toBeDisabled()
      expect(q('[data-field="code"]', dialog)).toHaveValue('AT')
      expect(q('[data-item-id]', dialog)).toHaveTextContent('sli_1')

      const label = q('[data-field="label"]', dialog) as HTMLInputElement
      await user.clear(label)
      await user.type(label, 'Österreich')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(m.updateItem).toHaveBeenCalledWith('sl_01', 'sli_1', { label: 'Österreich' }))
      expect(await screen.findByText('Österreich')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('surfaces 409 CONFLICT on duplicate code and keeps the modal open', async () => {
      m.createItem.mockRejectedValue(apiError(409, 'CONFLICT', 'dup'))
      const { user } = await renderLoadedDetail()
      await user.click(screen.getByRole('button', { name: 'Add value' }))
      const dialog = screen.getByRole('dialog')
      await user.type(q('[data-field="code"]', dialog) as HTMLInputElement, 'AT')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(await within(dialog).findByText('A value with that code already exists.')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('names the list_items scope on 403 QUOTA_EXCEEDED', async () => {
      m.createItem.mockRejectedValue(
        apiError(403, 'QUOTA_EXCEEDED', 'q', { scope: 'list_items', current: 500, limit: 500 }),
      )
      const { user } = await renderLoadedDetail()
      await user.click(screen.getByRole('button', { name: 'Add value' }))
      const dialog = screen.getByRole('dialog')
      await user.type(q('[data-field="code"]', dialog) as HTMLInputElement, 'ZZ')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(await within(dialog).findByText('Quota exceeded for list_items: 500/500')).toBeInTheDocument()
    })

    it('403 FORBIDDEN closes the modal, shows the reason and DISABLES (not hides) Add value', async () => {
      m.createItem.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
      const { user } = await renderLoadedDetail()
      await user.click(screen.getByRole('button', { name: 'Add value' }))
      const dialog = screen.getByRole('dialog')
      await user.type(q('[data-field="code"]', dialog) as HTMLInputElement, 'ZZ')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(q('[data-panel="value-editor"] [data-error="FORBIDDEN"]')).toHaveTextContent(
        'You do not have permission to modify values.',
      )
      expect(screen.getByRole('button', { name: 'Add value' })).toBeDisabled()
    })

    it('Cancel closes the modal without calling the API', async () => {
      const { user } = await renderLoadedDetail()
      await user.click(screen.getByRole('button', { name: 'Add value' }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(m.createItem).not.toHaveBeenCalled()
    })

    it('disables the form while the save is in flight', async () => {
      const d = deferred<ReturnType<typeof makeItem>>()
      m.createItem.mockReturnValue(d.promise)
      const { user } = await renderLoadedDetail()
      await user.click(screen.getByRole('button', { name: 'Add value' }))
      const dialog = screen.getByRole('dialog')
      await user.type(q('[data-field="code"]', dialog) as HTMLInputElement, 'ZZ')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(q('[data-field="code"]', dialog)).toBeDisabled()
      expect(q('[data-field="label"]', dialog)).toBeDisabled()
      d.resolve(makeItem({ id: 'sli_z', code: 'ZZ' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })
  })

  describe('archive and purge (destructive confirms)', () => {
    it('archives in one click and marks the row archived', async () => {
      m.archiveItem.mockResolvedValue(undefined)
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="archive-value"]') as HTMLElement)

      await waitFor(() => expect(m.archiveItem).toHaveBeenCalledWith('sl_01', 'sli_2'))
      await waitFor(() => expect(q('[data-item="sli_2"]')).toHaveAttribute('data-archived', 'true'))
    })

    it('403 on archive flips the panel to the FORBIDDEN state', async () => {
      m.archiveItem.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="archive-value"]') as HTMLElement)
      await waitFor(() => expect(q('[data-panel="value-editor"] [data-error="FORBIDDEN"]')).not.toBeNull())
      expect(screen.getByRole('button', { name: 'Add value' })).toBeDisabled()
    })

    it('purge requires typing the exact code before it is enabled', async () => {
      m.purgeItem.mockResolvedValue(undefined)
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="purge-value"]') as HTMLElement)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('data-modal', 'purge-value')
      expect(dialog).toHaveTextContent('All consumers referencing this ID will receive "missing"')
      const confirm = within(dialog).getByRole('button', { name: 'Permanently purge' })
      expect(confirm).toBeDisabled()

      const input = q('[data-confirm-input]', dialog) as HTMLInputElement
      await user.type(input, 'b')
      expect(confirm).toBeDisabled()
      await user.clear(input)
      await user.type(input, 'BE')
      expect(confirm).toBeEnabled()

      await user.click(confirm)
      await waitFor(() => expect(m.purgeItem).toHaveBeenCalledWith('sl_01', 'sli_2'))
      await waitFor(() => expect(q('[data-item="sli_2"]')).toBeNull())
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('never purges without confirmation (Enter on an empty confirm field is a no-op)', async () => {
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="purge-value"]') as HTMLElement)
      const input = q('[data-confirm-input]') as HTMLInputElement
      await user.type(input, 'wrong{Enter}')
      expect(m.purgeItem).not.toHaveBeenCalled()
    })

    it('offers "Archive instead" as the escape hatch', async () => {
      m.archiveItem.mockResolvedValue(undefined)
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="purge-value"]') as HTMLElement)
      await user.click(screen.getByRole('button', { name: 'Archive instead' }))

      await waitFor(() => expect(m.archiveItem).toHaveBeenCalledWith('sl_01', 'sli_2'))
      expect(m.purgeItem).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(q('[data-item="sli_2"]')).toHaveAttribute('data-archived', 'true')
    })

    it('shows the service error and keeps the row when the purge fails', async () => {
      m.purgeItem.mockRejectedValue(apiError(409, 'CONFLICT', 'still referenced'))
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="purge-value"]') as HTMLElement)
      const dialog = screen.getByRole('dialog')
      await user.type(q('[data-confirm-input]', dialog) as HTMLInputElement, 'BE')
      await user.click(within(dialog).getByRole('button', { name: 'Permanently purge' }))

      expect(await within(dialog).findByText('still referenced')).toBeInTheDocument()
      expect(q('[data-item="sli_2"]')).not.toBeNull()
    })

    it('Cancel dismisses the purge dialog', async () => {
      const { user } = await renderLoadedDetail()
      await user.click(q('[data-item="sli_2"] [data-action="purge-value"]') as HTMLElement)
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(m.purgeItem).not.toHaveBeenCalled()
    })
  })

  describe('frame 05 — reorder', () => {
    const handle = (code: string) => screen.getByLabelText(`Reorder ${code}`)
    const live = () => q('[data-note="reorder-a11y"]') as HTMLElement

    it('renders a labelled, focusable handle per row and an aria-live region', async () => {
      await renderLoadedDetail()
      expect(qa('[data-drag-handle]')).toHaveLength(3)
      expect(handle('AT')).toHaveAttribute('tabindex', '0')
      expect(handle('AT')).toHaveAttribute('role', 'button')
      expect(live()).toHaveAttribute('aria-live', 'polite')
    })

    it('Space lifts, arrows move, Space drops: PUTs the FULL permutation and announces each step', async () => {
      m.reorderItems.mockResolvedValue(undefined)
      await renderLoadedDetail()

      fireEvent.keyDown(handle('AT'), { key: ' ' })
      expect(live()).toHaveTextContent('Lifted item AT')
      expect(q('[data-item="sli_1"]')).toHaveAttribute('data-dragging', 'true')
      expect(q('[data-item="sli_2"]')).toHaveAttribute('data-drop-target', 'true')

      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      expect(live()).toHaveTextContent('Moved AT down to position 2')
      expect(itemOrder()).toEqual(['sli_2', 'sli_1', 'sli_3'])

      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      expect(itemOrder()).toEqual(['sli_2', 'sli_3', 'sli_1'])
      fireEvent.keyDown(handle('AT'), { key: 'ArrowUp' })
      expect(live()).toHaveTextContent('Moved AT up to position 2')
      expect(itemOrder()).toEqual(['sli_2', 'sli_1', 'sli_3'])

      fireEvent.keyDown(handle('AT'), { key: ' ' })
      expect(live()).toHaveTextContent('Dropped AT at position 2')
      await waitFor(() =>
        expect(m.reorderItems).toHaveBeenCalledWith('sl_01', ['sli_2', 'sli_1', 'sli_3']),
      )
      expect(m.reorderItems).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(q('[data-state="saving"]')).toBeNull())
      expect(itemOrder()).toEqual(['sli_2', 'sli_1', 'sli_3'])
    })

    // SelectionListItemReorder: "`item_ids` must be a permutation of exactly the
    // list's non-archived item ids", and the endpoint rejects anything else with
    // 400 VALIDATION_ERROR. Archived rows stay visible (greyed) and keep their
    // handle, but they carry no sort position, so their id must NOT be sent.
    it('excludes archived rows from the permutation (contract: non-archived ids only)', async () => {
      m.reorderItems.mockResolvedValue(undefined)
      await renderLoadedDetail([A, { ...B, status: 'archived' }, C])
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      await waitFor(() => expect(m.reorderItems).toHaveBeenCalledTimes(1))
      expect(m.reorderItems).toHaveBeenCalledWith('sl_01', ['sli_1', 'sli_3'])
    })

    it('reorders the active rows around an archived one without sending its id', async () => {
      m.reorderItems.mockResolvedValue(undefined)
      await renderLoadedDetail([A, { ...B, status: 'archived' }, C])
      // AT (sli_1) past the archived row AND past CH (sli_3): the active order flips.
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      await waitFor(() => expect(m.reorderItems).toHaveBeenCalledTimes(1))
      expect(m.reorderItems).toHaveBeenCalledWith('sl_01', ['sli_3', 'sli_1'])
    })

    it('shows "Saving order…" while the PUT is in flight', async () => {
      const d = deferred<void>()
      m.reorderItems.mockReturnValue(d.promise)
      await renderLoadedDetail()
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      expect(await screen.findByText('Saving order…')).toBeInTheDocument()
      d.resolve()
      await waitFor(() => expect(q('[data-state="saving"]')).toBeNull())
    })

    it('Escape cancels the lift and restores the original order without a PUT', async () => {
      await renderLoadedDetail()
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      expect(itemOrder()).toEqual(['sli_2', 'sli_1', 'sli_3'])
      fireEvent.keyDown(handle('AT'), { key: 'Escape' })
      expect(live()).toHaveTextContent('Reorder cancelled.')
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
      expect(m.reorderItems).not.toHaveBeenCalled()
    })

    it('arrow keys do nothing unless an item has been lifted', async () => {
      await renderLoadedDetail()
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
    })

    it('rolls the rows back and shows the failure when the PUT fails (no rejected order left on screen)', async () => {
      m.reorderItems.mockRejectedValue(apiError(500, 'INTERNAL_ERROR', 'Reorder exploded'))
      await renderLoadedDetail()
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })

      // regression: a non-VALIDATION_ERROR code used to render NO message at all
      expect(await screen.findByText('Reorder exploded')).toBeInTheDocument()
      expect(q('[data-error="reorder-failed"]')).toBeInTheDocument()
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
    })

    it('a code-less (network) failure also rolls back and reports', async () => {
      m.reorderItems.mockRejectedValue(new Error('Failed to fetch'))
      await renderLoadedDetail()
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      expect(await screen.findByText('Failed to fetch')).toBeInTheDocument()
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
    })

    it('a 400 VALIDATION_ERROR (list changed mid-drag) restores the order and reports it', async () => {
      m.reorderItems.mockRejectedValue(apiError(400, 'VALIDATION_ERROR', 'Not a full permutation'))
      await renderLoadedDetail()
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })

      expect(await screen.findByText('Not a full permutation')).toBeInTheDocument()
      expect(q('[data-error="VALIDATION_ERROR"]')).toBeInTheDocument()
      expect(q('[data-error="reorder-failed"]')).toBeNull()
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
    })

    // Frame 05 says a VALIDATION_ERROR reload "reloads the list" so the user sees
    // the server's current order. The flow only restores its stale local copy.
    it.fails('a 400 VALIDATION_ERROR reloads the list from the server (KNOWN GAP vs frame 05)', async () => {
      m.reorderItems.mockRejectedValue(apiError(400, 'VALIDATION_ERROR', 'Not a full permutation'))
      await renderLoadedDetail()
      expect(m.listItems).toHaveBeenCalledTimes(1)
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      fireEvent.keyDown(handle('AT'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('AT'), { key: ' ' })
      await screen.findByText('Not a full permutation')
      expect(m.listItems).toHaveBeenCalledTimes(2)
    })

    it('fail-closed: roles without update_value get NO drag handles and a FORBIDDEN notice', async () => {
      m.probeReorderPermission.mockResolvedValue(false)
      await renderLoadedDetail()
      expect(qa('[data-drag-handle]')).toHaveLength(0)
      expect(q('[data-reorderable] [data-error="FORBIDDEN"]')).toHaveTextContent(
        'You do not have permission to reorder items.',
      )
      // rows still render read-only
      expect(itemOrder()).toEqual(['sli_1', 'sli_2', 'sli_3'])
    })

    it('keyboard reorder is a no-op without permission', async () => {
      m.probeReorderPermission.mockResolvedValue(false)
      await renderLoadedDetail()
      expect(screen.queryByLabelText('Reorder AT')).toBeNull()
      expect(m.reorderItems).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('orchestrator routing', () => {
  it('shows the index (not the detail) at the bare route', async () => {
    renderIndex()
    expect(await screen.findByRole('heading', { name: 'Selection Lists' })).toBeInTheDocument()
    expect(m.getSelectionList).not.toHaveBeenCalled()
  })

  it('shows the detail at /:listId', async () => {
    renderDetail('sl_77')
    await waitFor(() => expect(m.getSelectionList).toHaveBeenCalledWith('sl_77'))
    expect(m.listSelectionLists).not.toHaveBeenCalled()
  })
})
