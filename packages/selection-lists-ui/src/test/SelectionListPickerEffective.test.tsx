/**
 * SelectionListPicker + SelectionListPickerHarness with the shared-lists flag
 * (SL9 flow `effective-picker`, frames 09, 10, 15). `fetch` is the boundary
 * (see effectivePickerWorld); the whole data path is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  SelectionListPicker,
  SelectionListPickerHarness,
  type SelectionListPickerProps,
} from '../SelectionListPickerHarness'
import { SharedListsFeatureProvider } from '../shared-lists/core'
import {
  COMMON_ITEMS,
  FORK_ITEMS,
  callsMade,
  commonWorld,
  forbidden,
  forkWorld,
  mountWorld,
  resolved,
  serverError,
  type World,
} from './effectivePickerWorld'
import { COMMON_ID, FORK_ID, makeForkList } from './sharedListsFixtures'

afterEach(() => {
  vi.unstubAllGlobals()
})

const q = (sel: string, root: ParentNode = document) => root.querySelector(sel)
const qa = (sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel))
const persisted = () => q('[data-persisted]')?.getAttribute('data-persisted')
const control = () => q('[data-combo-control]') as HTMLButtonElement
const optionLabels = () => screen.queryAllByRole('option').map(o => o.textContent?.replace('✓', ''))
const panel = () => q("[data-panel='picker']") as HTMLElement

type Props = {
  mode?: 'single' | 'multi'
  initialValue?: string | string[]
  max?: number
  showSource?: boolean
  showInspector?: boolean
  onEffectiveValue?: (a: string, b: string) => void
  onChange?: (v: never) => void
}

function mount(world: World, props: Props = {}, sharedLists = true) {
  const fetchMock = mountWorld(world)
  const user = userEvent.setup()
  const utils = render(
    <SharedListsFeatureProvider sharedLists={sharedLists}>
      <SelectionListPicker
        {...({ listKey: 'priority', mode: 'single', ...props } as SelectionListPickerProps)}
      />
    </SharedListsFeatureProvider>
  )
  return { fetchMock, user, ...utils }
}
const ready = () => waitFor(() => expect(control()).not.toBeNull())

describe('frame 09 — the picker renders the EFFECTIVE list', () => {
  it('org fork: ONE lookup, items of the fork only, never merged with the common list', async () => {
    const { fetchMock, user } = mount(forkWorld())
    await ready()
    expect(panel()).toHaveAttribute('data-effective-source', 'own')
    await user.click(control())
    expect(optionLabels()).toEqual(['Low', 'Medium', 'High'])
    const calls = callsMade(fetchMock)
    expect(calls.filter(c => c.path === '/v1/selection-lists')).toHaveLength(1)
    const lookup = calls[0]
    expect(lookup.query.get('include_shared')).toBe('true')
    expect(lookup.query.get('limit')).toBe('1')
    const itemPaths = calls.filter(c => /items/.test(c.path)).map(c => c.path)
    expect(itemPaths).toEqual([`/v1/selection-lists/${FORK_ID}/items`])
    expect(screen.queryByText('Normal')).toBeNull()
  })

  it('no fork: the common list, active values only', async () => {
    const { user } = mount(commonWorld())
    await ready()
    expect(panel()).toHaveAttribute('data-effective-source', 'platform')
    await user.click(control())
    expect(optionLabels()).toEqual(['Low', 'Normal', 'High'])
  })

  it('the host contract is unchanged: a pick emits the effective list\'s item ID', async () => {
    const onChange = vi.fn()
    const { user } = mount(forkWorld(), { onChange })
    await ready()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: /Medium/ }))
    expect(onChange).toHaveBeenCalledWith(FORK_ITEMS.medium)
    expect(persisted()).toBe(FORK_ITEMS.medium)
    expect(q('[data-selected-label]')).toHaveTextContent('Medium')
  })

  it('the menu is inline in the flow with 44px-token targets (frame 15 follows frame 4d)', async () => {
    const { user } = mount(forkWorld())
    await ready()
    await user.click(control())
    const menu = q('[data-combo-menu]') as HTMLElement
    expect(menu).toHaveAttribute('data-menu-placement', 'inline')
    expect(menu.style.position).toBe('static')
    expect(control().style.minBlockSize).toBe('var(--touch-target)')
    for (const o of qa('[data-item]')) {
      expect((o as HTMLElement).style.minBlockSize).toBe('var(--touch-target)')
    }
  })

  it('options are keyboard-operable: Enter and Space pick, Escape closes', async () => {
    const onChange = vi.fn()
    const { user } = mount(forkWorld(), { onChange })
    await ready()
    await user.click(control())
    const high = screen.getByRole('option', { name: /High/ })
    high.focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(FORK_ITEMS.high)
    expect(screen.queryByRole('listbox')).toBeNull()

    await user.click(control())
    screen.getByRole('option', { name: /Low/ }).focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(FORK_ITEMS.low)

    await user.click(control())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    // other keys do nothing
    await user.click(control())
    screen.getByRole('option', { name: /Low/ }).focus()
    await user.keyboard('a')
    expect(screen.queryByRole('listbox')).not.toBeNull()
  })

  it('the selected option is marked with a check; the control exposes its value, not a fixed label', async () => {
    const { user } = mount(forkWorld(), { initialValue: FORK_ITEMS.medium })
    await ready()
    await waitFor(() => expect(q('[data-selected-label]')).toHaveTextContent('Medium'))
    expect(control()).not.toHaveAttribute('aria-label')
    await user.click(control())
    const opt = screen.getByRole('option', { name: /Medium/ })
    expect(opt).toHaveAttribute('aria-selected', 'true')
    expect(within(opt).getByText('✓')).toBeInTheDocument()
  })

  describe('opt-in source caption', () => {
    it('absent without showSource', async () => {
      mount(forkWorld())
      await ready()
      expect(q('[data-effective-source-caption]')).toBeNull()
    })
    it('org fork: "Your organization\'s version of the common list"', async () => {
      mount(forkWorld(), { showSource: true })
      await ready()
      const cap = q("[data-effective-source-caption='own']")!
      expect(cap.querySelector("[data-badge='fork']")).not.toBeNull()
      expect(cap).toHaveTextContent('of the common list Priority')
    })
    it('common list: "Common list — provided by FuzeFront"', async () => {
      mount(commonWorld(), { showSource: true })
      await ready()
      const cap = q("[data-effective-source-caption='platform']")!
      expect(cap.querySelector("[data-badge='common']")).not.toBeNull()
    })
    it('private fork (a draft) returned to its role-holder', async () => {
      mount(
        forkWorld({ lookupPages: [{ items: [makeForkList({ visibility: 'private' })] }] }),
        { showSource: true }
      )
      await ready()
      expect(q("[data-effective-source-caption='own']")).toHaveTextContent(/Draft/)
    })
    it('comes WITH the options, never before them, and costs no extra request', async () => {
      const { fetchMock } = mount(forkWorld(), { showSource: true })
      expect(q('[data-effective-source-caption]')).toBeNull()
      expect(q("[data-state='loading']")).not.toBeNull()
      await ready()
      expect(q('[data-effective-source-caption]')).not.toBeNull()
      expect(callsMade(fetchMock).map(c => c.path)).toEqual([
        '/v1/selection-lists',
        `/v1/selection-lists/${FORK_ID}/items`,
      ])
    })
  })

  describe('harness inspector', () => {
    it('shows which list the key resolved to, only when asked', async () => {
      mount(forkWorld(), { showInspector: true })
      await ready()
      const el = q('[data-effective-inspector]')!
      expect(el).toHaveTextContent(FORK_ID)
      expect(el).toHaveTextContent(COMMON_ID)
      expect(el).toHaveTextContent('visibility org')
    })
    it('absent by default', async () => {
      mount(forkWorld())
      await ready()
      expect(q('[data-effective-inspector]')).toBeNull()
    })
  })

  describe('states', () => {
    it('loading: one skeleton, no control, state on the panel', async () => {
      mount(forkWorld())
      expect(panel()).toHaveAttribute('data-state', 'loading')
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
      expect(control()).toBeNull()
      await ready()
    })

    it('lookup failure: in-place Retry, the host value kept, NO fallback list; retry recovers', async () => {
      let failures = 1
      const { fetchMock, user } = mount(
        forkWorld({
          fail: url =>
            /selection-lists\?/.test(url) && failures-- > 0 ? serverError() : undefined,
        }),
        { initialValue: FORK_ITEMS.medium }
      )
      await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'))
      expect(q("[data-error='load-failed']")).not.toBeNull()
      expect(persisted()).toBe(FORK_ITEMS.medium)
      expect(callsMade(fetchMock).filter(c => /items/.test(c.path))).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      await ready()
      expect(callsMade(fetchMock).filter(c => c.path === '/v1/selection-lists')).toHaveLength(2)
    })

    it('a 403 on the lookup is the error state — never "List unavailable"', async () => {
      mount(forkWorld({ fail: url => (/selection-lists\?/.test(url) ? forbidden() : undefined) }))
      await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'))
      expect(panel()).not.toHaveTextContent(/list unavailable/i)
    })

    it('a failed items read: Retry re-reads the SAME list', async () => {
      let failures = 1
      const { fetchMock, user } = mount(
        forkWorld({ fail: url => (/\/items/.test(url) && failures-- > 0 ? serverError() : undefined) })
      )
      await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'))
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      await ready()
      const paths = callsMade(fetchMock).filter(c => /items/.test(c.path)).map(c => c.path)
      expect(new Set(paths).size).toBe(1)
    })

    it('no effective list (200, terminal empty page): "List unavailable", disabled, nothing thrown', async () => {
      mount(forkWorld({ lookupPages: [{ items: [] }] }), { initialValue: FORK_ITEMS.medium })
      await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'not-found'))
      expect(q("[data-error='NOT_FOUND']")).toHaveTextContent(/list unavailable/i)
      expect(control()).toBeDisabled()
      expect(persisted()).toBe(FORK_ITEMS.medium)
    })

    it('an empty list: "No options available", control disabled', async () => {
      mount(forkWorld({ items: { [FORK_ID]: [] } }))
      await waitFor(() => expect(q("[data-state='empty']")).not.toBeNull())
      expect(control()).toBeDisabled()
    })
  })
})

describe('frame 10 — stored values across a fork', () => {
  const STORED = COMMON_ITEMS.normal
  const redirect = {
    [STORED]: resolved('Medium', { effective_item_id: FORK_ITEMS.medium }),
  }

  it('a redirected id shows the FORK label with no badge/notice/dirty marker; the value is NOT rewritten', async () => {
    const { fetchMock, user } = mount(forkWorld({ resolve: redirect }), { initialValue: STORED })
    const label = await waitFor(() => {
      const el = q('[data-selected-label]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(label).toHaveAttribute('data-redirected', 'true')
    expect(label).toHaveTextContent('Medium')
    expect(panel()).toHaveAttribute('data-state', 'redirected')
    for (const hook of ['[data-badge]', "[role='alert']", "[role='status']", '[data-dirty]', '[data-error]']) {
      expect(q(hook, panel())).toBeNull()
    }
    expect(persisted()).toBe(STORED)
    expect(callsMade(fetchMock).filter(c => c.path === '/v1/resolve')).toHaveLength(1)
    await user.click(control())
    expect(screen.getByRole('option', { name: /Medium/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('a pick replaces the redirected value and emits the fork item id', async () => {
    const onChange = vi.fn()
    const { user } = mount(forkWorld({ resolve: redirect }), { initialValue: STORED, onChange })
    await waitFor(() => expect(q('[data-redirected]')).not.toBeNull())
    await user.click(control())
    await user.click(screen.getByRole('option', { name: /High/ }))
    expect(onChange).toHaveBeenCalledWith(FORK_ITEMS.high)
    expect(persisted()).toBe(FORK_ITEMS.high)
    expect(q('[data-redirected]')).toBeNull()
    expect(panel()).toHaveAttribute('data-state', 'ready')
  })

  it('onEffectiveValue(stored, effective) is called once after a successful resolve', async () => {
    const onEffectiveValue = vi.fn()
    mount(forkWorld({ resolve: redirect }), { initialValue: STORED, onEffectiveValue })
    await waitFor(() => expect(onEffectiveValue).toHaveBeenCalledTimes(1))
    expect(onEffectiveValue).toHaveBeenCalledWith(STORED, FORK_ITEMS.medium)
  })

  it('resolving: a skeleton, the control is NOT editable, the stored id is never a label', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const fetchMock = mountWorld(forkWorld({ resolve: redirect }))
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (/resolve/.test(url)) await gate
      return base(url, init)
    })
    render(
      <SharedListsFeatureProvider sharedLists>
        <SelectionListPicker listKey="priority" mode="single" initialValue={STORED} />
      </SharedListsFeatureProvider>
    )
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'resolving'))
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(control()).toBeNull()
    expect(panel()).not.toHaveTextContent(STORED)
    expect(persisted()).toBe(STORED)
    release()
    await waitFor(() => expect(q('[data-redirected="true"]')).not.toBeNull())
  })

  it('missing: "Unknown value" stays in the form', async () => {
    mount(forkWorld(), { initialValue: 'front_sli_gone' })
    await waitFor(() => expect(q('[data-selected-label][data-missing="true"]')).not.toBeNull())
    expect(q('[data-selected-label]')).toHaveTextContent(/unknown value/i)
    expect(persisted()).toBe('front_sli_gone')
  })

  it('archived: greyed with a badge, not newly selectable', async () => {
    const { user } = mount(
      forkWorld({ resolve: { [COMMON_ITEMS.high]: resolved('Critical (legacy)', { status: 'archived' }) } }),
      { initialValue: COMMON_ITEMS.high }
    )
    await waitFor(() => expect(q('[data-selected-label][data-archived="true"]')).not.toBeNull())
    expect(q('[data-selected-label]')).toHaveAttribute('data-status', 'archived')
    await user.click(control())
    expect(q(`[data-item='${COMMON_ITEMS.high}']`)).toBeNull()
    expect(persisted()).toBe(COMMON_ITEMS.high)
  })

  it('a common id the fork does not redirect (private fork / purged copy) renders its own label as-is', async () => {
    mount(forkWorld({ resolve: { [COMMON_ITEMS.normal]: resolved('Normal') } }), {
      initialValue: COMMON_ITEMS.normal,
    })
    await waitFor(() => expect(q('[data-selected-label]')).toHaveTextContent('Normal'))
    expect(q('[data-selected-label]')).not.toHaveAttribute('data-redirected')
    expect(q('[data-selected-label]')).not.toHaveAttribute('data-archived')
    expect(persisted()).toBe(COMMON_ITEMS.normal)
  })

  it('resolve failed: in-place Retry, the stored id untouched, onEffectiveValue not called; retry recovers', async () => {
    let failures = 1
    const onEffectiveValue = vi.fn()
    const { user } = mount(
      forkWorld({
        resolve: redirect,
        fail: url => (/resolve/.test(url) && failures-- > 0 ? serverError() : undefined),
      }),
      { initialValue: STORED, onEffectiveValue }
    )
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'resolve-error'))
    expect(q("[data-error='resolve-failed']")).not.toBeNull()
    expect(persisted()).toBe(STORED)
    expect(onEffectiveValue).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(q('[data-redirected="true"]')).not.toBeNull())
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
  })

  it('the host value is held from the first render (before options or resolve answer)', async () => {
    mount(forkWorld({ resolve: redirect }), { initialValue: STORED })
    expect(persisted()).toBe(STORED)
    await ready()
  })

  it('a new initialValue re-seeds the picker', async () => {
    const world = forkWorld()
    const fetchMock = mountWorld(world)
    const view = render(
      <SharedListsFeatureProvider sharedLists>
        <SelectionListPicker listKey="priority" mode="single" initialValue={FORK_ITEMS.low} />
      </SharedListsFeatureProvider>
    )
    await waitFor(() => expect(persisted()).toBe(FORK_ITEMS.low))
    view.rerender(
      <SharedListsFeatureProvider sharedLists>
        <SelectionListPicker listKey="priority" mode="single" initialValue={FORK_ITEMS.high} />
      </SharedListsFeatureProvider>
    )
    await waitFor(() => expect(persisted()).toBe(FORK_ITEMS.high))
    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('the flag arriving after the picker is editable', () => {
  const tree = (sharedLists: boolean, props: Partial<SelectionListPickerProps> = {}) => (
    <SharedListsFeatureProvider sharedLists={sharedLists}>
      <SelectionListPicker
        {...({ listKey: 'priority', mode: 'single', initialValue: FORK_ITEMS.low, ...props } as SelectionListPickerProps)}
      />
    </SharedListsFeatureProvider>
  )

  it('keeps a pick the user already made (no reset to initialValue, no onChange)', async () => {
    mountWorld(forkWorld())
    const onChange = vi.fn()
    const user = userEvent.setup()
    const view = render(tree(false, { onChange } as never))
    await ready()
    await user.click(control())
    await user.click(screen.getByRole('option', { name: /High/ }))
    expect(persisted()).toBe(FORK_ITEMS.high)
    onChange.mockClear()

    view.rerender(tree(true, { onChange } as never))
    await waitFor(() => expect(panel()).toHaveAttribute('data-effective-source', 'own'))
    expect(persisted()).toBe(FORK_ITEMS.high)
    expect(q('[data-selected-label]')).toHaveTextContent('High')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an untouched picker still holds the host value across the switch', async () => {
    mountWorld(forkWorld())
    const view = render(tree(false))
    await waitFor(() => expect(persisted()).toBe(FORK_ITEMS.low))
    view.rerender(tree(true))
    await waitFor(() => expect(panel()).toHaveAttribute('data-effective-source', 'own'))
    expect(persisted()).toBe(FORK_ITEMS.low)
  })
})

describe('multi mode with the effective list', () => {
  const STORED = COMMON_ITEMS.normal
  const redirect = {
    [STORED]: resolved('Medium', { effective_item_id: FORK_ITEMS.medium }),
  }

  it('a redirected id is a plain chip with the fork label, and its option reads selected', async () => {
    const { user } = mount(forkWorld({ resolve: redirect }), {
      mode: 'multi',
      initialValue: [STORED, FORK_ITEMS.low],
    })
    await waitFor(() => expect(q(`[data-chip='${STORED}']`)).not.toBeNull())
    const chip = q(`[data-chip='${STORED}']`)!
    expect(chip).toHaveTextContent('Medium')
    expect(chip).toHaveAttribute('data-redirected', 'true')
    expect(chip).not.toHaveAttribute('data-archived')
    expect(persisted()).toContain(STORED)
    await user.click(control())
    expect(screen.getByRole('option', { name: /Medium/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('deselecting the option a stored id was redirected to removes that stored id', async () => {
    const onChange = vi.fn()
    const { user } = mount(forkWorld({ resolve: redirect }), {
      mode: 'multi',
      initialValue: [STORED, FORK_ITEMS.low],
      onChange,
    })
    await waitFor(() => expect(q(`[data-chip='${STORED}']`)).not.toBeNull())
    await user.click(control())
    await user.click(screen.getByRole('option', { name: /Medium/ }))
    expect(onChange).toHaveBeenLastCalledWith([FORK_ITEMS.low])
    expect(q(`[data-chip='${STORED}']`)).toBeNull()
  })

  it('an option held BOTH directly and through a redirected stored id: one click removes both', async () => {
    const onChange = vi.fn()
    const { user } = mount(forkWorld({ resolve: redirect }), {
      mode: 'multi',
      initialValue: [STORED, FORK_ITEMS.medium, FORK_ITEMS.low],
      onChange,
    })
    await waitFor(() => expect(q(`[data-chip='${STORED}']`)).not.toBeNull())
    await user.click(control())
    const medium = screen.getByRole('option', { name: /Medium/ })
    expect(medium).toHaveAttribute('aria-selected', 'true')
    await user.click(medium)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith([FORK_ITEMS.low])
    expect(q(`[data-chip='${STORED}']`)).toBeNull()
    expect(q(`[data-chip='${FORK_ITEMS.medium}']`)).toBeNull()
    expect(screen.getByRole('option', { name: /Medium/ })).toHaveAttribute('aria-selected', 'false')
    // and selecting it again adds only its own id
    await user.click(screen.getByRole('option', { name: /Medium/ }))
    expect(onChange).toHaveBeenLastCalledWith([FORK_ITEMS.low, FORK_ITEMS.medium])
  })

  it('keeps archived and missing chips, and picks add to the set', async () => {
    const onChange = vi.fn()
    const { user } = mount(
      forkWorld({ resolve: { [COMMON_ITEMS.high]: resolved('Critical (legacy)', { status: 'archived' }) } }),
      { mode: 'multi', initialValue: [COMMON_ITEMS.high, 'front_sli_gone'], onChange }
    )
    await waitFor(() => expect(q("[data-chip][data-missing='true']")).not.toBeNull())
    expect(q(`[data-chip='${COMMON_ITEMS.high}']`)).toHaveAttribute('data-archived', 'true')
    await user.click(control())
    await user.click(screen.getByRole('option', { name: /Low/ }))
    // the pick swaps the purged id out; the archived value stays
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([COMMON_ITEMS.high, FORK_ITEMS.low])
    )
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).not.toContain('front_sli_gone')
  })
})

describe('flag OFF — the approved 4.0.0 picker, untouched', () => {
  it('sends no include_shared, no resolve redirect handling, and renders none of the new elements', async () => {
    const world = forkWorld({
      resolve: { [FORK_ITEMS.medium]: resolved('Medium', { effective_item_id: FORK_ITEMS.high }) },
    })
    const fetchMock = mountWorld(world)
    render(
      <SharedListsFeatureProvider sharedLists={false}>
        <SelectionListPicker
          listKey="priority"
          mode="single"
          initialValue={FORK_ITEMS.medium}
          showSource
          showInspector
          onEffectiveValue={() => {
            throw new Error('never called while the flag is OFF')
          }}
        />
      </SharedListsFeatureProvider>
    )
    await waitFor(() => expect(control()).not.toBeNull())
    await waitFor(() => expect(q('[data-selected-label]')).toHaveTextContent('Medium'))
    for (const c of callsMade(fetchMock).filter(c => c.path === '/v1/selection-lists')) {
      expect(c.query.has('include_shared')).toBe(false)
    }
    expect(callsMade(fetchMock).filter(c => /items/.test(c.path))[0].query.has('status')).toBe(false)
    expect(
      qa('[data-effective-source-caption], [data-effective-source], [data-effective-inspector], [data-badge], [data-redirected]')
    ).toHaveLength(0)
    expect(persisted()).toBe(FORK_ITEMS.medium)
  })

  it('without any provider it is OFF too', async () => {
    const fetchMock = mountWorld(forkWorld())
    render(<SelectionListPicker listKey="priority" mode="single" />)
    await waitFor(() => expect(control()).not.toBeNull())
    expect(callsMade(fetchMock)[0].query.has('include_shared')).toBe(false)
  })
})

describe('harness switches (?showSource=1, ?migrate=1)', () => {
  function mountHarness(search: string, world: World) {
    mountWorld(world)
    return render(
      <SharedListsFeatureProvider sharedLists>
        <MemoryRouter initialEntries={[`/embed/selection-list-picker?${search}`]}>
          <SelectionListPickerHarness />
        </MemoryRouter>
      </SharedListsFeatureProvider>
    )
  }

  it('showSource=1 passes the opt-in caption; the inspector is always on in the harness', async () => {
    mountHarness('list=priority&mode=single&showSource=1', forkWorld())
    await ready()
    expect(q('[data-effective-source-caption]')).not.toBeNull()
    expect(q('[data-effective-inspector]')).not.toBeNull()
    expect(q('[data-migration]')).toBeNull()
  })

  it('without showSource there is no caption', async () => {
    mountHarness('list=priority&mode=single', forkWorld())
    await ready()
    expect(q('[data-effective-source-caption]')).toBeNull()
  })

  it('migrate=1 records every onEffectiveValue call on [data-migration="host-opt-in"]', async () => {
    mountHarness(
      `list=priority&mode=single&migrate=1&value=${COMMON_ITEMS.normal}`,
      forkWorld({
        resolve: {
          [COMMON_ITEMS.normal]: resolved('Medium', { effective_item_id: FORK_ITEMS.medium }),
        },
      })
    )
    const m = await screen.findByText(/onEffectiveValue calls/)
    expect(m).toHaveAttribute('data-migration', 'host-opt-in')
    await waitFor(() =>
      expect(JSON.parse(m.getAttribute('data-effective-calls')!)).toEqual([
        [COMMON_ITEMS.normal, FORK_ITEMS.medium],
      ])
    )
  })

  it('multi mode through the harness', async () => {
    mountHarness(`list=priority&mode=multi&value=${FORK_ITEMS.low}`, forkWorld())
    await ready()
    expect(q("[data-mode='multi']")).not.toBeNull()
  })
})
