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
} from '../SelectionListPickerHarness'
import * as api from '../api'
import { apiError, makeItem, renderFlow, renderFlowSettled, NEVER } from './helpers'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, listItems: vi.fn(), resolveItems: vi.fn() }
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

beforeEach(() => {
  vi.resetAllMocks()
  m.listItems.mockResolvedValue({ data: [MANGO, ZEBRA, APPLE, OLD] })
  m.resolveItems.mockResolvedValue({ resolved: [], missing: [] })
})

async function renderPicker(props: Partial<React.ComponentProps<typeof SelectionListPicker>> = {}) {
  const user = userEvent.setup()
  const utils = render(<SelectionListPicker listKey="fruit" mode="single" {...props} />)
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
    const { container } = render(<SelectionListPicker listKey="fruit" mode="single" />)
    await Promise.resolve()
    const frame = q('[data-frame="12-picker-single"]', container)
    expect(frame).toHaveAttribute('data-picker', 'fruit')
    expect(q('[data-state="loading"]', frame as HTMLElement)).toHaveAttribute('aria-busy', 'true')
    expect(q('[data-combo-control]')).toBeNull()
  })

  it('loads items by list key', async () => {
    await renderPicker()
    expect(m.listItems).toHaveBeenCalledWith('fruit', {})
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
      render(<SelectionListPicker listKey="fruit" mode="single" />)

      await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
      expect(q('[data-state="error"]')).toHaveTextContent('Failed to load options.')
      expect(q('[data-persisted]')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(q('[data-combo-control]')).not.toBeNull())
      expect(q('[data-state="error"]')).toBeNull()
      expect(m.listItems).toHaveBeenCalledTimes(2)
    })

    it('renders the not-found state for an unknown/unreadable key (404)', async () => {
      m.listItems.mockRejectedValue(apiError(404, 'NOT_FOUND', 'nope'))
      render(<SelectionListPicker listKey="ghost" mode="single" />)
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
      expect(q('[data-error="NOT_FOUND"]')).toHaveTextContent('List "ghost" not found or you do not have access.')
      expect(q('[data-combo-control]')).toBeNull()
    })

    it('also treats a NOT_FOUND code as not-found, but a 403 as a retryable error', async () => {
      m.listItems.mockRejectedValue(apiError(400, 'NOT_FOUND', 'nope'))
      const { unmount } = render(<SelectionListPicker listKey="ghost" mode="single" />)
      await waitFor(() => expect(q('[data-state="not-found"]')).not.toBeNull())
      unmount()

      m.listItems.mockRejectedValue(apiError(403, 'FORBIDDEN', 'nope'))
      render(<SelectionListPicker listKey="ghost" mode="single" />)
      await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
      expect(q('[data-state="not-found"]')).toBeNull()
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
  const multi = (props: Partial<React.ComponentProps<typeof SelectionListPicker>> = {}) =>
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
    await waitFor(() => expect(m.listItems).toHaveBeenCalledWith('fruit', {}))
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
