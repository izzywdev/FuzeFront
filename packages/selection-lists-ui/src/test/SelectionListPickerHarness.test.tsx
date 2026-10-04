/**
 * SelectionListPicker + SelectionListPickerHarness — frames 12 (single),
 * 13 (multi) and 14 (archived / purged stored value). `../api` is mocked at the
 * module boundary; unwrapItems / unwrapCursor stay real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectionListPickerHarnessDefault, {
  SelectionListPicker,
  SelectionListPickerHarness,
  type SelectionListPickerProps,
} from '../SelectionListPickerHarness'
import * as api from '../api'
import { apiError, makeItem, makeList, renderFlowSettled, NEVER } from './helpers'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, listSelectionLists: vi.fn(), listItems: vi.fn(), resolveItems: vi.fn() }
})

const m = vi.mocked(api)

const q = (sel: string, root: ParentNode = document) => root.querySelector(sel)
const qa = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel))
const persisted = () => q('[data-persisted]')?.getAttribute('data-persisted')
const optionLabels = () => screen.queryAllByRole('option').map(o => o.textContent)

// Deliberately NOT alphabetical and with ids that sort differently from
// sort_order, so ordering assertions can only pass by following sort_order.
const ZEBRA = makeItem({ id: 'sli_c', code: 'Z', label: 'Zebra', sort_order: 1 })
const APPLE = makeItem({ id: 'sli_b', code: 'A', label: 'Apple', sort_order: 2 })
const MANGO = makeItem({ id: 'sli_a', code: 'M', label: 'Mango', sort_order: 3 })
const OLD = makeItem({ id: 'sli_old', code: 'O', label: 'Old', sort_order: 4, status: 'archived' })

// The picker is bound by list KEY ("fruit") but the contract reads items by list ID.
const FRUIT_LIST = makeList({ id: 'front_sl_fruit', key: 'fruit', name: 'Fruit' })
const OTHER_LIST = makeList({ id: 'front_sl_other', key: 'other', name: 'Other' })

beforeEach(() => {
  vi.resetAllMocks()
  m.listSelectionLists.mockResolvedValue({ items: [OTHER_LIST, FRUIT_LIST], page: { hasMore: false } })
  m.listItems.mockResolvedValue({ data: [MANGO, ZEBRA, APPLE, OLD] })
  m.resolveItems.mockResolvedValue({ resolved: [], missing: [] })
})

type PickerOpts = {
  listKey?: string
  mode?: 'single' | 'multi'
  initialValue?: string
  max?: number
  onChange?: (value: never) => void
}
const pickerEl = (props: PickerOpts) => (
  <SelectionListPicker {...({ listKey: 'fruit', mode: 'single', ...props } as SelectionListPickerProps)} />
)

async function renderPicker(props: PickerOpts = {}) {
  const user = userEvent.setup()
  const utils = render(pickerEl(props))
  await waitFor(() => expect(q('[data-state="loading"]')).toBeNull())
  return { user, ...utils }
}
const control = () => q('[data-combo-control]') as HTMLButtonElement

// ─────────────────────────────────────────────────────────────────────────────
describe('exports', () => {
  it('default export is the harness', () => {
    expect(SelectionListPickerHarnessDefault).toBe(SelectionListPickerHarness)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 12 — single select', () => {
  it('shows a skeleton at control size while loading (aria-busy, no reflow)', async () => {
    m.listItems.mockReturnValue(NEVER)
    const { container } = render(pickerEl({}))
    await Promise.resolve()
    const frame = q('[data-frame="12-picker-single"]', container)
    expect(frame).toHaveAttribute('data-picker', 'fruit')
    expect(q('[data-state="loading"]', frame as HTMLElement)).toHaveAttribute('aria-busy', 'true')
    expect(q('[data-combo-control]')).toBeNull()
  })

  it('looks the list up by KEY, then loads items by the list ID the contract requires', async () => {
    await renderPicker()
    expect(m.listSelectionLists).toHaveBeenCalledWith({})
    expect(m.listItems).toHaveBeenCalledWith('front_sl_fruit', {})
  })

  it('opens a listbox of ACTIVE items only, in sort_order (not alphabetical, not by id)', async () => {
    const { user } = await renderPicker()
    await user.click(control())

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(optionLabels()).toEqual(['Zebra', 'Apple', 'Mango'])
    expect(screen.queryByText('Old')).toBeNull() // archived never offered
  })

  it('selecting an option shows its label, closes the menu and persists the item ID only', async () => {
    const { user } = await renderPicker()
    expect(persisted()).toBe('')
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))

    expect(q('[data-selected-label]')).toHaveTextContent('Apple')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(persisted()).toBe('sli_b') // id, not label or code
  })

  it('re-selecting replaces the previous value (single mode)', async () => {
    const { user } = await renderPicker()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    await user.click(control())
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('option', { name: 'Mango' }))
    expect(persisted()).toBe('sli_a')
    expect(q('[data-selected-label]')).toHaveTextContent('Mango')
  })

  it('exposes combobox semantics: aria-haspopup, aria-expanded, option/aria-selected, focused search', async () => {
    const { user } = await renderPicker()
    expect(control()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(control()).toHaveAttribute('aria-expanded', 'false')
    expect(control()).toHaveAttribute('aria-label', 'Open selection list')

    await user.click(control())
    expect(control()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Search options' })).toHaveFocus()
    for (const o of screen.getAllByRole('option')) expect(o).toHaveAttribute('aria-selected', 'false')
  })

  it('toggles closed when the control is clicked again', async () => {
    const { user } = await renderPicker()
    await user.click(control())
    await user.click(control())
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on an outside mousedown', async () => {
    const { user } = await renderPicker()
    await user.click(control())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('filters by label or code (case-insensitive) and shows an explanatory empty state', async () => {
    const { user } = await renderPicker()
    await user.click(control())
    const search = screen.getByRole('textbox', { name: 'Search options' })

    await user.type(search, 'APP')
    expect(optionLabels()).toEqual(['Apple'])

    await user.clear(search)
    await user.type(search, 'm') // Mango only (label or code contains "m")
    expect(optionLabels()).toEqual(['Mango'])

    await user.clear(search)
    await user.type(search, 'z') // Zebra via both label and code
    expect(optionLabels()).toEqual(['Zebra'])

    await user.clear(search)
    await user.type(search, 'nothing-like-this')
    expect(q('[data-state="no-matches"]')).toHaveTextContent('No matches found.')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  describe('empty list', () => {
    it('disables the control with "No options available" instead of opening an empty menu', async () => {
      m.listItems.mockResolvedValue({ data: [OLD] }) // only archived values
      const { user } = await renderPicker()
      expect(q('[data-state="empty"]')).toHaveTextContent('No options available.')
      expect(control()).toBeDisabled()
      expect(control()).toHaveAttribute('aria-label', 'No options available')
      await user.click(control())
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('treats a list with no items at all the same way', async () => {
      m.listItems.mockResolvedValue({ data: [] })
      await renderPicker()
      expect(control()).toBeDisabled()
    })
  })

  describe('load failure', () => {
    it('shows an in-place retry (does not throw into the host) and still renders the persisted slot', async () => {
      m.listItems.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'down'))
      const user = userEvent.setup()
      render(pickerEl({}))

      await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
      expect(q('[data-state="error"]')).toHaveTextContent('Failed to load options.')
      expect(q('[data-persisted]')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(q('[data-combo-control]')).not.toBeNull())
      expect(q('[data-state="error"]')).toBeNull()
      expect(m.listItems).toHaveBeenCalledTimes(2)
    })

    it('renders the not-found state when no list has that key (absent == unreadable) — items are never requested', async () => {
      render(pickerEl({ listKey: 'ghost' }))
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
      expect(q('[data-error="NOT_FOUND"]')).toHaveTextContent('List "ghost" not found or you do not have access.')
      expect(q('[data-combo-control]')).toBeNull()
      expect(m.listItems).not.toHaveBeenCalled()
    })

    it('a 404 from the list lookup or from the items read is also not-found', async () => {
      m.listSelectionLists.mockRejectedValueOnce(apiError(404, 'NOT_FOUND', 'nope'))
      const first = render(pickerEl({}))
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
      first.unmount()

      m.listItems.mockRejectedValue(apiError(404, 'NOT_FOUND', 'nope'))
      render(pickerEl({}))
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
    })

    it('also treats a NOT_FOUND code as not-found, but a 403 as a retryable error', async () => {
      m.listItems.mockRejectedValue(apiError(400, 'NOT_FOUND', 'nope'))
      const { unmount } = render(pickerEl({}))
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
      unmount()

      m.listItems.mockRejectedValue(apiError(403, 'FORBIDDEN', 'nope'))
      render(pickerEl({}))
      await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
      expect(q('[data-state="not-found"]')).toBeNull()
    })

    it('a failing list lookup (500) is a retryable error that does not throw into the host', async () => {
      m.listSelectionLists.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'down'))
      const user = userEvent.setup()
      render(pickerEl({}))
      await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(q('[data-combo-control]')).not.toBeNull())
    })
  })

  describe('list addressing (key vs id) and pagination', () => {
    it('uses a front_sl_ list ID as-is, without a lookup', async () => {
      await renderPicker({ listKey: 'front_sl_direct' })
      expect(m.listSelectionLists).not.toHaveBeenCalled()
      expect(m.listItems).toHaveBeenCalledWith('front_sl_direct', {})
    })

    it('never passes the KEY as the list id path segment', async () => {
      await renderPicker({ listKey: 'fruit' })
      for (const call of m.listItems.mock.calls) expect(call[0]).not.toBe('fruit')
    })

    it('follows page.nextCursor through the list lookup until the key is found', async () => {
      m.listSelectionLists
        .mockResolvedValueOnce({ items: [OTHER_LIST], page: { hasMore: true, nextCursor: 'c2' } })
        .mockResolvedValueOnce({ items: [FRUIT_LIST], page: { hasMore: false } })
      await renderPicker()
      expect(m.listSelectionLists).toHaveBeenNthCalledWith(1, {})
      expect(m.listSelectionLists).toHaveBeenNthCalledWith(2, { cursor: 'c2' })
      expect(m.listItems).toHaveBeenCalledWith('front_sl_fruit', {})
    })

    it('gives up (not-found) rather than loop forever on a never-ending lookup', async () => {
      m.listSelectionLists.mockResolvedValue({ items: [OTHER_LIST], page: { hasMore: true, nextCursor: 'again' } })
      render(pickerEl({}))
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
      expect(m.listSelectionLists.mock.calls.length).toBeLessThanOrEqual(20)
    })

    it('follows the items cursor envelope so values beyond page one are offered and kept', async () => {
      const PAGE2 = makeItem({ id: 'sli_p2', code: 'P', label: 'Papaya', sort_order: 9 })
      m.listItems
        .mockResolvedValueOnce({ data: [ZEBRA], page: { hasMore: true, nextCursor: 'n2' } })
        .mockResolvedValueOnce({ data: [PAGE2], page: { hasMore: false } })
      m.resolveItems.mockResolvedValue({
        resolved: [{ id: 'sli_p2', label: 'Papaya', locale: 'en', is_machine: false, status: 'active' }],
        missing: [],
      })
      const { user } = await renderPicker({ initialValue: 'sli_p2' })
      expect(m.listItems).toHaveBeenNthCalledWith(1, 'front_sl_fruit', {})
      expect(m.listItems).toHaveBeenNthCalledWith(2, 'front_sl_fruit', { cursor: 'n2' })
      await waitFor(() => expect(persisted()).toBe('sli_p2')) // not dropped for being on page 2
      await user.click(control())
      expect(optionLabels()).toEqual(['Zebra', 'Papaya'])
    })

    it('stops following the items cursor after a bounded number of pages', async () => {
      m.listItems.mockResolvedValue({ data: [ZEBRA], page: { hasMore: true, nextCursor: 'more' } })
      await renderPicker()
      expect(m.listItems.mock.calls.length).toBeLessThanOrEqual(20)
    })
  })

  describe('pre-selected (initial) value', () => {
    it('resolves an ACTIVE stored id and pre-selects it', async () => {
      m.resolveItems.mockResolvedValue({
        resolved: [{ id: 'sli_b', label: 'Apple', locale: 'en', is_machine: false, status: 'active' }],
        missing: [],
      })
      await renderPicker({ initialValue: 'sli_b' })
      await waitFor(() => expect(q('[data-selected-label]')).toHaveTextContent('Apple'))
      expect(persisted()).toBe('sli_b')
      expect(m.resolveItems).toHaveBeenCalledWith(['sli_b'])
    })

    it('does not call /resolve when there is no initial value', async () => {
      await renderPicker()
      expect(m.resolveItems).not.toHaveBeenCalled()
    })

    it('fails open: if /resolve errors, an existing selection is kept', async () => {
      m.resolveItems.mockRejectedValue(apiError(500, 'INTERNAL', 'resolve down'))
      await renderPicker({ initialValue: 'sli_b' })
      await waitFor(() => expect(persisted()).toBe('sli_b'))
      expect(q('[data-selected-label]')).toHaveTextContent('Apple')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 13 — multi select', () => {
  const multi = (props: PickerOpts = {}) =>
    renderPicker({ mode: 'multi', ...props })

  it('uses the multi frame, starts with no selection and no Clear all', async () => {
    await multi()
    expect(q('[data-frame="13-picker-multi"]')).toBeInTheDocument()
    expect(q('[data-state="empty-selection"]')).toHaveTextContent('No items selected.')
    expect(q('[data-action="clear-all"]')).toBeNull()
    expect(q('[data-chips]')).toBeNull()
    expect(persisted()).toBe('')
  })

  it('stacks selections as removable chips; menu stays open for more', async () => {
    const { user } = await multi()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    await user.click(screen.getByRole('option', { name: 'Mango' }))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(qa('[data-chip]').map(c => c.getAttribute('data-chip'))).toEqual(['sli_b', 'sli_a'])
    expect(screen.getByRole('button', { name: 'Remove Apple' })).toBeInTheDocument()
    expect(q('[data-action="clear-all"]')).toBeInTheDocument()
    expect(q('[data-state="empty-selection"]')).toBeNull()
  })

  it('submits IDs in the list sort_order, not click order', async () => {
    const { user } = await multi()
    await user.click(control())
    // click order: Mango (3), Zebra (1), Apple (2)
    await user.click(screen.getByRole('option', { name: 'Mango' }))
    await user.click(screen.getByRole('option', { name: 'Zebra' }))
    await user.click(screen.getByRole('option', { name: 'Apple' }))

    expect(persisted()).toBe('sli_c,sli_b,sli_a')
    expect(qa('[data-chip]').map(c => c.getAttribute('data-chip'))).toEqual(['sli_c', 'sli_b', 'sli_a'])
  })

  it('two different click orders for the same set yield identical submitted values', async () => {
    const first = await multi()
    await first.user.click(control())
    await first.user.click(screen.getByRole('option', { name: 'Mango' }))
    await first.user.click(screen.getByRole('option', { name: 'Zebra' }))
    const a = persisted()
    first.unmount()

    const second = await multi()
    await second.user.click(control())
    await second.user.click(screen.getByRole('option', { name: 'Zebra' }))
    await second.user.click(screen.getByRole('option', { name: 'Mango' }))
    expect(persisted()).toBe(a)
  })

  it('clicking a selected option again deselects it', async () => {
    const { user } = await multi()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    expect(qa('[data-chip]')).toHaveLength(0)
    expect(persisted()).toBe('')
  })

  it('a chip × removes just that selection', async () => {
    const { user } = await multi()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    await user.click(screen.getByRole('option', { name: 'Mango' }))
    await user.click(screen.getByRole('button', { name: 'Remove Apple' }))
    expect(qa('[data-chip]').map(c => c.getAttribute('data-chip'))).toEqual(['sli_a'])
    expect(persisted()).toBe('sli_a')
  })

  it('Clear all empties the selection and then disappears', async () => {
    const { user } = await multi()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    await user.click(screen.getByRole('option', { name: 'Mango' }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(qa('[data-chip]')).toHaveLength(0)
    expect(persisted()).toBe('')
    expect(q('[data-action="clear-all"]')).toBeNull()
  })

  it('filtering to no matches explains itself and preserves the existing chips', async () => {
    const { user } = await multi()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    await user.type(screen.getByRole('textbox', { name: 'Search options' }), 'zzzz')

    expect(q('[data-state="no-matches"]')).toHaveTextContent('No matches found.')
    expect(qa('[data-chip]').map(c => c.getAttribute('data-chip'))).toEqual(['sli_b'])
    expect(persisted()).toBe('sli_b')
  })

  describe('host-supplied max', () => {
    it('blocks further selections with a message, but still lets existing ones be removed', async () => {
      const { user } = await multi({ max: 2 })
      await user.click(control())
      await user.click(screen.getByRole('option', { name: 'Zebra' }))
      expect(q('[data-state="max-reached"]')).toBeNull()
      await user.click(screen.getByRole('option', { name: 'Apple' }))

      expect(q('[data-error="max-selected"]')).toHaveTextContent('Maximum selections reached (2).')
      await user.click(screen.getByRole('option', { name: 'Mango' })) // refused
      expect(qa('[data-chip]').map(c => c.getAttribute('data-chip'))).toEqual(['sli_c', 'sli_b'])
      expect(persisted()).toBe('sli_c,sli_b')

      // deselecting a chosen option is still allowed and lifts the cap
      await user.click(screen.getByRole('option', { name: 'Apple' }))
      expect(q('[data-state="max-reached"]')).toBeNull()
      await user.click(screen.getByRole('option', { name: 'Mango' }))
      expect(persisted()).toBe('sli_c,sli_a')
    })

    it('max is a host constraint, worded differently from a service quota', async () => {
      const { user } = await multi({ max: 1 })
      await user.click(control())
      await user.click(screen.getByRole('option', { name: 'Zebra' }))
      const msg = q('[data-error="max-selected"]')!.textContent!
      expect(msg).not.toMatch(/quota/i)
    })

    it('max=0 / undefined means unlimited', async () => {
      const { user } = await multi({ max: 0 })
      await user.click(control())
      for (const name of ['Zebra', 'Apple', 'Mango']) await user.click(screen.getByRole('option', { name }))
      expect(qa('[data-chip]')).toHaveLength(3)
      expect(q('[data-state="max-reached"]')).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 14 — archived and purged stored values', () => {
  const resolveArchived = (locale = 'ja') =>
    m.resolveItems.mockResolvedValue({
      resolved: [{ id: 'sli_old', label: 'Old', locale, is_machine: false, status: 'archived' }],
      missing: [],
    })

  it('an ARCHIVED id renders its real label greyed with an Archived badge and stays in the form', async () => {
    resolveArchived()
    await renderPicker({ initialValue: 'sli_old' })
    await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())

    expect(m.resolveItems).toHaveBeenCalledWith(['sli_old'])
    const label = q('[data-selected-label]') as HTMLElement
    expect(label).toHaveAttribute('data-archived', 'true')
    expect(label).toHaveAttribute('data-status', 'archived')
    expect(label).toHaveTextContent('Old')
    expect(within(label).getByText('Archived')).toBeInTheDocument()
    expect(persisted()).toBe('sli_old')
    expect(q('[data-state="archived-selected"]')).toBeInTheDocument()
  })

  it('the archived value is ABSENT from the option menu (read-only, not newly selectable) and says so', async () => {
    resolveArchived()
    const { user } = await renderPicker({ initialValue: 'sli_old' })
    await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
    await user.click(control())

    expect(optionLabels()).toEqual(['Zebra', 'Apple', 'Mango'])
    expect(q('[data-item="sli_old"]')).toBeNull()
    expect(q('[data-note="archived-not-offerable"]')).toHaveTextContent(/cannot be newly selected/)
  })

  it('choosing a live value replaces the archived one (single mode)', async () => {
    resolveArchived()
    const { user } = await renderPicker({ initialValue: 'sli_old' })
    await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Apple' }))

    expect(q('[data-frame="12-picker-single"]')).toBeInTheDocument()
    expect(q('[data-selected-label]')).toHaveTextContent('Apple')
    expect(persisted()).toBe('sli_b')
  })

  it('resolve matrix: one label per viewer locale, non-source locales marked as falling back', async () => {
    resolveArchived('ja')
    await renderPicker({ initialValue: 'sli_old' })
    await waitFor(() => expect(q('[data-panel="resolve-matrix"]')).not.toBeNull())

    for (const loc of ['en', 'ja', 'fr', 'de']) {
      expect(q(`[data-panel="resolve-matrix"] [data-locale="${loc}"]`)).toHaveTextContent('Old')
    }
    // ja is the resolved locale: no fallback note; others fall back from ja — never an empty string
    expect(q('[data-locale="ja"]')).not.toHaveTextContent('fallback')
    for (const loc of ['en', 'fr', 'de']) {
      expect(q(`[data-locale="${loc}"]`)).toHaveTextContent('(fallback from ja)')
    }
  })

  it('a PURGED id (in `missing`) renders "Unknown value" but KEEPS the id in the form', async () => {
    m.resolveItems.mockResolvedValue({ resolved: [], missing: ['sli_gone'] })
    await renderPicker({ initialValue: 'sli_gone' })
    await waitFor(() => expect(q('[data-state="missing"]')).not.toBeNull())

    expect(q('[data-selected-label][data-missing="true"]')).toHaveTextContent('Unknown value')
    expect(q('[data-error="missing"]')).toHaveTextContent('Unknown')
    // re-saving must not silently drop data the user never chose to change
    expect(persisted()).toBe('sli_gone')
    expect(q('[data-frame="14-picker-archived"]')).toBeInTheDocument()
  })

  it('a purged value is never rendered as blank', async () => {
    m.resolveItems.mockResolvedValue({ resolved: [], missing: ['sli_gone'] })
    await renderPicker({ initialValue: 'sli_gone' })
    await waitFor(() => expect(q('[data-state="missing"]')).not.toBeNull())
    expect((q('[data-selected-label]') as HTMLElement).textContent?.trim()).not.toBe('')
  })

  it('multi mode surfaces the archived value the same way', async () => {
    resolveArchived()
    await renderPicker({ mode: 'multi', initialValue: 'sli_old' })
    await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
    expect(q('[data-frame="14-picker-archived"]')).toHaveAttribute('data-mode', 'multi')
    expect(persisted()).toBe('sli_old')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('onChange — the host receives the selection (item IDs, never labels/codes)', () => {
  const pick = (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.click(screen.getByRole('option', { name }))
  const lastIds = (fn: ReturnType<typeof vi.fn>) => fn.mock.lastCall![0] as string[]
  const multi = (props: PickerOpts = {}) => renderPicker({ mode: 'multi', ...props })
  const archivedOld = () =>
    m.resolveItems.mockResolvedValue({
      resolved: [{ id: 'sli_old', label: 'Old', locale: 'en', is_machine: false, status: 'archived' }],
      missing: [],
    })

  describe('single mode', () => {
    it('emits the chosen item ID (not the label or code) exactly once per pick', async () => {
      const onChange = vi.fn()
      const { user } = await renderPicker({ onChange })
      expect(onChange).not.toHaveBeenCalled() // nothing on mount
      await user.click(control())
      await pick(user, 'Apple')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith('sli_b')
      expect(onChange).not.toHaveBeenCalledWith('Apple')
      expect(onChange).not.toHaveBeenCalledWith('A')
    })

    it('emits the replacement when a different value is picked', async () => {
      const onChange = vi.fn()
      const { user } = await renderPicker({ onChange })
      await user.click(control())
      await pick(user, 'Apple')
      await user.click(control())
      await pick(user, 'Mango')
      expect(onChange.mock.calls).toEqual([['sli_b'], ['sli_a']])
    })

    it('does not re-emit when the already-selected value is picked again', async () => {
      const onChange = vi.fn()
      const { user } = await renderPicker({ onChange })
      await user.click(control())
      await pick(user, 'Apple')
      await user.click(control())
      await pick(user, 'Apple')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(persisted()).toBe('sli_b')
    })

    it('what onChange emitted is exactly what the form slot holds', async () => {
      const onChange = vi.fn()
      const { user } = await renderPicker({ onChange })
      await user.click(control())
      await pick(user, 'Zebra')
      expect(persisted()).toBe(onChange.mock.lastCall![0])
    })

    it('does not require onChange (uncontrolled use without a callback still works)', async () => {
      const { user } = await renderPicker()
      await user.click(control())
      await pick(user, 'Apple')
      expect(persisted()).toBe('sli_b')
    })

    it('seeding an ACTIVE initialValue does not fire onChange (the host already has it)', async () => {
      const onChange = vi.fn()
      m.resolveItems.mockResolvedValue({
        resolved: [{ id: 'sli_b', label: 'Apple', locale: 'en', is_machine: false, status: 'active' }],
        missing: [],
      })
      await renderPicker({ initialValue: 'sli_b', onChange })
      await waitFor(() => expect(persisted()).toBe('sli_b'))
      expect(onChange).not.toHaveBeenCalled()
    })

    it('picking the SAME id as an active initialValue is not a change; picking another is', async () => {
      const onChange = vi.fn()
      m.resolveItems.mockResolvedValue({
        resolved: [{ id: 'sli_b', label: 'Apple', locale: 'en', is_machine: false, status: 'active' }],
        missing: [],
      })
      const { user } = await renderPicker({ initialValue: 'sli_b', onChange })
      await waitFor(() => expect(persisted()).toBe('sli_b'))
      await user.click(control())
      await pick(user, 'Apple')
      expect(onChange).not.toHaveBeenCalled()
      await user.click(control())
      await pick(user, 'Mango')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith('sli_a')
    })

    it('an ARCHIVED stored value is not re-emitted on seed; replacing it emits the live id', async () => {
      const onChange = vi.fn()
      archivedOld()
      const { user } = await renderPicker({ initialValue: 'sli_old', onChange })
      await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
      expect(onChange).not.toHaveBeenCalled()
      expect(persisted()).toBe('sli_old')

      await user.click(control())
      expect(screen.queryByRole('option', { name: 'Old' })).toBeNull() // archived is not offerable
      await pick(user, 'Mango')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith('sli_a')
      expect(persisted()).toBe('sli_a')
    })

    it('a PURGED stored value offers no control, so nothing can be emitted and the id is kept', async () => {
      const onChange = vi.fn()
      m.resolveItems.mockResolvedValue({ resolved: [], missing: ['sli_gone'] })
      await renderPicker({ initialValue: 'sli_gone', onChange })
      await waitFor(() => expect(q('[data-state="missing"]')).not.toBeNull())
      expect(q('[data-combo-control]')).toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      expect(persisted()).toBe('sli_gone')
    })

    it('a late /resolve of the initial value never overwrites a pick the user already made', async () => {
      const onChange = vi.fn()
      let release!: (v: Awaited<ReturnType<typeof api.resolveItems>>) => void
      m.resolveItems.mockReturnValue(new Promise(r => { release = r }))
      const { user } = await renderPicker({ initialValue: 'sli_old', onChange })
      await user.click(control())
      await pick(user, 'Mango')
      expect(persisted()).toBe('sli_a')

      release({ resolved: [{ id: 'sli_old', label: 'Old', locale: 'en', is_machine: false, status: 'archived' }], missing: [] })
      await new Promise(r => setTimeout(r, 0))
      expect(persisted()).toBe('sli_a') // host and picker still agree
      expect(q('[data-frame="14-picker-archived"]')).toBeNull()
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith('sli_a')
    })

    it('a late FAILED /resolve does not overwrite a user pick either', async () => {
      let fail!: (e: Error) => void
      m.resolveItems.mockReturnValue(new Promise((_, rej) => { fail = rej }))
      const { user } = await renderPicker({ initialValue: 'sli_old' })
      await user.click(control())
      await pick(user, 'Mango')
      fail(apiError(500, 'INTERNAL', 'down'))
      await new Promise(r => setTimeout(r, 0))
      expect(persisted()).toBe('sli_a')
    })

    it('a NEW initialValue re-seeds the picker (it is a seed, not a binding)', async () => {
      const onChange = vi.fn()
      m.resolveItems.mockImplementation(async ids => ({
        resolved: [{ id: ids[0], label: ids[0] === 'sli_b' ? 'Apple' : 'Mango', locale: 'en', is_machine: false, status: 'active' }],
        missing: [],
      }))
      const { user, rerender } = await renderPicker({ initialValue: 'sli_b', onChange })
      await waitFor(() => expect(persisted()).toBe('sli_b'))
      await user.click(control())
      await pick(user, 'Zebra')
      expect(persisted()).toBe('sli_c')

      rerender(pickerEl({ initialValue: 'sli_a', onChange }))
      await waitFor(() => expect(persisted()).toBe('sli_a'))
      expect(onChange).toHaveBeenCalledTimes(1) // only the user's own pick
      expect(onChange).toHaveBeenLastCalledWith('sli_c')
    })
  })

  describe('multi mode', () => {
    it('emits the full ID array after each select, in sort_order (not click order)', async () => {
      const onChange = vi.fn()
      const { user } = await multi({ onChange })
      expect(onChange).not.toHaveBeenCalled()
      await user.click(control())
      await pick(user, 'Mango') // sort 3
      expect(onChange).toHaveBeenLastCalledWith(['sli_a'])
      await pick(user, 'Zebra') // sort 1
      expect(onChange).toHaveBeenLastCalledWith(['sli_c', 'sli_a'])
      await pick(user, 'Apple') // sort 2
      expect(onChange).toHaveBeenLastCalledWith(['sli_c', 'sli_b', 'sli_a'])
      expect(onChange).toHaveBeenCalledTimes(3)
    })

    it('deselecting emits the reduced array', async () => {
      const onChange = vi.fn()
      const { user } = await multi({ onChange })
      await user.click(control())
      await pick(user, 'Apple')
      await pick(user, 'Mango')
      await pick(user, 'Apple') // toggle off
      expect(lastIds(onChange)).toEqual(['sli_a'])
      await pick(user, 'Mango')
      expect(lastIds(onChange)).toEqual([]) // emptied, still reported
    })

    it('a chip x emits the array without that id', async () => {
      const onChange = vi.fn()
      const { user } = await multi({ onChange })
      await user.click(control())
      await pick(user, 'Apple')
      await pick(user, 'Mango')
      await user.click(screen.getByRole('button', { name: 'Remove Apple' }))
      expect(lastIds(onChange)).toEqual(['sli_a'])
    })

    it('Clear all emits an empty array', async () => {
      const onChange = vi.fn()
      const { user } = await multi({ onChange })
      await user.click(control())
      await pick(user, 'Apple')
      await pick(user, 'Mango')
      await user.click(screen.getByRole('button', { name: 'Clear all' }))
      expect(onChange).toHaveBeenLastCalledWith([])
      expect(persisted()).toBe('')
    })

    it('the emitted array and the form slot never disagree', async () => {
      const onChange = vi.fn()
      const { user } = await multi({ onChange })
      await user.click(control())
      for (const name of ['Mango', 'Zebra', 'Apple', 'Zebra']) {
        await pick(user, name)
        expect(persisted()).toBe(lastIds(onChange).join(','))
      }
    })

    it('hands the host a fresh array each time (no shared mutable state)', async () => {
      const onChange = vi.fn()
      const { user } = await multi({ onChange })
      await user.click(control())
      await pick(user, 'Apple')
      const first = lastIds(onChange)
      await pick(user, 'Mango')
      expect(first).toEqual(['sli_b'])
      expect(lastIds(onChange)).not.toBe(first)
    })

    describe('max selections', () => {
      it('a selection refused by the cap does NOT call onChange; removing one does and lifts the cap', async () => {
        const onChange = vi.fn()
        const { user } = await multi({ max: 2, onChange })
        await user.click(control())
        await pick(user, 'Zebra')
        await pick(user, 'Apple')
        expect(onChange).toHaveBeenCalledTimes(2)

        await pick(user, 'Mango') // refused
        expect(onChange).toHaveBeenCalledTimes(2)
        expect(lastIds(onChange)).toEqual(['sli_c', 'sli_b'])
        expect(persisted()).toBe('sli_c,sli_b')

        await pick(user, 'Apple') // deselect at the cap is allowed
        expect(lastIds(onChange)).toEqual(['sli_c'])
        await pick(user, 'Mango')
        expect(lastIds(onChange)).toEqual(['sli_c', 'sli_a'])
      })

      it('never emits more ids than max, whatever the click sequence', async () => {
        const onChange = vi.fn()
        const { user } = await multi({ max: 1, onChange })
        await user.click(control())
        for (const name of ['Zebra', 'Apple', 'Mango']) await pick(user, name)
        for (const [ids] of onChange.mock.calls) expect((ids as string[]).length).toBeLessThanOrEqual(1)
        expect(lastIds(onChange)).toEqual(['sli_c'])
      })

      it('max=0 means unlimited: all three can be emitted', async () => {
        const onChange = vi.fn()
        const { user } = await multi({ max: 0, onChange })
        await user.click(control())
        for (const name of ['Zebra', 'Apple', 'Mango']) await pick(user, name)
        expect(lastIds(onChange)).toEqual(['sli_c', 'sli_b', 'sli_a'])
      })
    })

    describe('archived / purged stored values', () => {
      it('seeding an archived value emits nothing and keeps the id in the form', async () => {
        const onChange = vi.fn()
        archivedOld()
        await multi({ initialValue: 'sli_old', onChange })
        await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
        expect(onChange).not.toHaveBeenCalled()
        expect(persisted()).toBe('sli_old')
      })

      it('live toggles on top of an archived value emit what the form slot holds; emptying restores the archived id', async () => {
        const onChange = vi.fn()
        archivedOld()
        const { user } = await multi({ initialValue: 'sli_old', onChange })
        await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
        await user.click(control())
        await pick(user, 'Mango')
        expect(lastIds(onChange)).toEqual(['sli_a'])
        expect(persisted()).toBe('sli_a')
        await pick(user, 'Mango') // nothing live chosen any more -> the stored (archived) id is not dropped
        expect(lastIds(onChange)).toEqual(['sli_old'])
        expect(persisted()).toBe('sli_old')
      })

      it('a purged stored value renders no control, so nothing is emitted and the id stays', async () => {
        const onChange = vi.fn()
        m.resolveItems.mockResolvedValue({ resolved: [], missing: ['sli_gone'] })
        await multi({ initialValue: 'sli_gone', onChange })
        await waitFor(() => expect(q('[data-state="missing"]')).not.toBeNull())
        expect(q('[data-combo-control]')).toBeNull()
        expect(onChange).not.toHaveBeenCalled()
        expect(persisted()).toBe('sli_gone')
      })
    })
  })

  describe('RTL', () => {
    const ARABIC = [
      makeItem({ id: 'sli_ar1', code: 'EG', label: 'مصر', sort_order: 1 }),
      makeItem({ id: 'sli_ar2', code: 'SA', label: 'السعودية', sort_order: 2 }),
    ]
    const HEBREW = makeItem({ id: 'sli_he1', code: 'IL', label: 'ישראל', sort_order: 3 })

    it('inside a dir="rtl" host, picking an RTL-labelled option emits the ID, never the localized text', async () => {
      m.listItems.mockResolvedValue({ data: [...ARABIC, HEBREW] })
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<div dir="rtl" lang="ar">{pickerEl({ onChange })}</div>)
      await waitFor(() => expect(q('[data-state="loading"]')).toBeNull())

      await user.click(control())
      expect(optionLabels()).toEqual(['مصر', 'السعودية', 'ישראל'])
      await user.click(screen.getByRole('option', { name: 'السعودية' }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith('sli_ar2')
      expect(q('[data-selected-label]')).toHaveTextContent('السعودية')
      expect(persisted()).toBe('sli_ar2')
    })

    it('multi in an RTL host emits sort_order IDs and chips render the translated labels', async () => {
      m.listItems.mockResolvedValue({ data: [...ARABIC, HEBREW] })
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<div dir="rtl" lang="he">{pickerEl({ mode: 'multi', onChange })}</div>)
      await waitFor(() => expect(q('[data-state="loading"]')).toBeNull())

      await user.click(control())
      await user.click(screen.getByRole('option', { name: 'ישראל' }))
      await user.click(screen.getByRole('option', { name: 'مصر' }))
      expect(onChange).toHaveBeenLastCalledWith(['sli_ar1', 'sli_he1'])
      expect(screen.getByRole('button', { name: 'Remove مصر' })).toBeInTheDocument()
      expect(qa('[data-chip]').map(c => c.getAttribute('data-chip'))).toEqual(['sli_ar1', 'sli_he1'])
    })

    it('search matches RTL labels', async () => {
      m.listItems.mockResolvedValue({ data: [...ARABIC, HEBREW] })
      const user = userEvent.setup()
      render(<div dir="rtl">{pickerEl({})}</div>)
      await waitFor(() => expect(q('[data-state="loading"]')).toBeNull())
      await user.click(control())
      await user.type(screen.getByRole('textbox', { name: 'Search options' }), 'مص')
      expect(optionLabels()).toEqual(['مصر'])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('SelectionListPickerHarness (query-param route)', () => {
  const ROUTE = '/embed/selection-list-picker'
  const at = (search: string) => renderFlowSettled(<SelectionListPickerHarness />, `${ROUTE}${search}`, [ROUTE])

  it('is marked embeddable and says which parameter is missing', async () => {
    await at('')
    expect(q('[data-note="embeddable"]')).toBeInTheDocument()
    expect(screen.getByText(/Missing/)).toHaveTextContent('?list=')
    expect(m.listItems).not.toHaveBeenCalled()
  })

  it('renders a single picker for ?list=<key> by default', async () => {
    await at('?list=fruit')
    await waitFor(() => expect(m.listItems).toHaveBeenCalledWith('front_sl_fruit', {}))
    expect(q('[data-frame="12-picker-single"]')).toHaveAttribute('data-picker', 'fruit')
  })

  it('?mode=multi renders the multi picker; any other mode falls back to single', async () => {
    const first = await at('?list=fruit&mode=multi')
    await waitFor(() => expect(q('[data-frame="13-picker-multi"]')).not.toBeNull())
    first.unmount()

    await at('?list=fruit&mode=bogus')
    await waitFor(() => expect(q('[data-frame="12-picker-single"]')).not.toBeNull())
  })

  it('passes ?max= (parsed as a number) through to the picker', async () => {
    await at('?list=fruit&mode=multi&max=1')
    await waitFor(() => expect(q('[data-combo-control]')).not.toBeNull())
    const user = userEvent.setup()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: 'Zebra' }))
    expect(q('[data-error="max-selected"]')).toHaveTextContent('Maximum selections reached (1).')
  })

  it('passes ?value= through so an archived stored id resolves', async () => {
    m.resolveItems.mockResolvedValue({
      resolved: [{ id: 'sli_old', label: 'Old', locale: 'en', is_machine: false, status: 'archived' }],
      missing: [],
    })
    await at('?list=fruit&value=sli_old')
    await waitFor(() => expect(q('[data-frame="14-picker-archived"]')).not.toBeNull())
    expect(m.resolveItems).toHaveBeenCalledWith(['sli_old'])
  })
})
