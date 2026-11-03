/**
 * The shared-lists flag is evaluated by the HOST and settles after first paint
 * (`GET /api/flags`). Until it settles the package must not choose a data path:
 * a consumer that mounts early used to run the 4.0.0 path (flag fail-closed
 * OFF) and, once the flag turned ON, the shared path again — double lookups,
 * and a single injected 5xx eaten by the first request so no error state showed.
 *
 * `SharedListsFeatureProvider ready={false}` is the "not settled yet" state;
 * every consumer that issues requests waits for it. `fetch` is the boundary.
 */
import { renderHook, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SelectionListPicker,
  type SelectionListPickerProps,
} from '../SelectionListPickerHarness'
import { SelectionListManagementFlow } from '../SelectionListManagementFlow'
import { SelectionListAccessFlow } from '../SelectionListAccessFlow'
import { TranslationWorkbenchFlow } from '../TranslationWorkbenchFlow'
import { SharedListsFeatureProvider } from '../shared-lists/core'
import { useEffectiveList } from '../shared-lists/core/useEffectiveList'
import { useSharedListIndex } from '../shared-lists/core/useSharedListIndex'
import { useStoredValues } from '../shared-lists/core/useStoredValues'
import { onGet, page, stubApi } from './browseHarness'
import {
  FORK_ITEMS,
  callsMade,
  forkWorld,
  mountWorld,
  serverError,
  type World,
} from './effectivePickerWorld'
import { FORK_ID, makeForkList } from './sharedListsFixtures'

afterEach(() => vi.unstubAllGlobals())

const q = (sel: string) => document.querySelector(sel)
const persisted = () => q('[data-persisted]')?.getAttribute('data-persisted')
const control = () => q('[data-combo-control]') as HTMLButtonElement | null

interface Flag {
  on: boolean
  ready: boolean
}
const picker = (flag: Flag, props: Partial<SelectionListPickerProps> = {}) => (
  <SharedListsFeatureProvider sharedLists={flag.on} ready={flag.ready}>
    <SelectionListPicker
      {...({
        listKey: 'priority',
        mode: 'single',
        initialValue: FORK_ITEMS.low,
        ...props,
      } as SelectionListPickerProps)}
    />
  </SharedListsFeatureProvider>
)

describe('picker — waits for the flag before choosing a data path', () => {
  it('flag not settled: no request at all, the loading state, the host value held', async () => {
    const fetchMock = mountWorld(forkWorld())
    render(picker({ on: false, ready: false }))
    // give any (wrongly) eager effect the chance to run
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(q("[data-state='loading']")).not.toBeNull()
  })

  it('settles ON: exactly ONE lookup (include_shared), ONE items read, ONE resolve', async () => {
    const fetchMock = mountWorld(forkWorld())
    const view = render(picker({ on: false, ready: false }))
    view.rerender(picker({ on: true, ready: true }))
    await waitFor(() => expect(control()).not.toBeNull())
    await waitFor(() => expect(persisted()).toBe(FORK_ITEMS.low))
    const calls = callsMade(fetchMock)
    expect(calls.map(c => `${c.method} ${c.path}`).sort()).toEqual(
      [
        'GET /v1/selection-lists',
        `GET /v1/selection-lists/${FORK_ID}/items`,
        'POST /v1/resolve',
      ].sort()
    )
    const byPath = (path: string) => calls.find(c => c.path === path)!
    expect(byPath('/v1/selection-lists').query.get('include_shared')).toBe('true')
    expect(byPath(`/v1/selection-lists/${FORK_ID}/items`).query.get('status')).toBe('active')
  })

  it('settles OFF (an unauthenticated embed): exactly the 4.0.0 path, once, no include_shared', async () => {
    const fetchMock = mountWorld(forkWorld())
    const view = render(picker({ on: false, ready: false }))
    view.rerender(picker({ on: false, ready: true }))
    await waitFor(() => expect(control()).not.toBeNull())
    const calls = callsMade(fetchMock)
    expect(calls.map(c => `${c.method} ${c.path}`).sort()).toEqual(
      [
        'GET /v1/selection-lists',
        `GET /v1/selection-lists/${FORK_ID}/items`,
        'POST /v1/resolve',
      ].sort()
    )
    for (const c of calls) {
      expect(c.query.has('include_shared')).toBe(false)
      expect(c.query.has('visibility')).toBe(false)
    }
  })

  it('a single injected 5xx on the lookup is seen (not eaten by a throw-away 4.0.0 request)', async () => {
    let lookups = 0
    const world: World = forkWorld({
      fail: url => {
        if (url.split('?')[0] === '/api/v1/selection-lists') {
          lookups += 1
          if (lookups === 1) return serverError()
        }
        return undefined
      },
    })
    mountWorld(world)
    const view = render(picker({ on: false, ready: false }))
    view.rerender(picker({ on: true, ready: true }))
    await waitFor(() => expect(q("[data-state='error']")).not.toBeNull())
    expect(lookups).toBe(1)
    // the host's value is kept while the options are unavailable
    expect(persisted()).toBe(FORK_ITEMS.low)
  })

  it('a flag that is ready from the first render (no waiting) loads once, as before', async () => {
    const fetchMock = mountWorld(forkWorld())
    render(picker({ on: true, ready: true }))
    await waitFor(() => expect(control()).not.toBeNull())
    expect(
      callsMade(fetchMock).filter(c => c.path === '/v1/selection-lists')
    ).toHaveLength(1)
  })

  it('flag ON → OFF mid-session: the 4.0.0 path takes over, the pick survives, no crash', async () => {
    const fetchMock = mountWorld(forkWorld())
    const onChange = vi.fn()
    const user = userEvent.setup()
    const view = render(picker({ on: true, ready: true }, { onChange } as never))
    await waitFor(() => expect(control()).not.toBeNull())
    await user.click(control()!)
    await user.click(screen.getByRole('option', { name: /High/ }))
    expect(persisted()).toBe(FORK_ITEMS.high)
    onChange.mockClear()
    fetchMock.mockClear()

    view.rerender(picker({ on: false, ready: true }, { onChange } as never))
    await waitFor(() => expect(control()).not.toBeNull())
    // the 4.0.0 data path ran (a lookup WITHOUT include_shared) and the user's pick was kept
    const lookups = callsMade(fetchMock).filter(c => c.path === '/v1/selection-lists')
    expect(lookups).toHaveLength(1)
    expect(lookups[0].query.has('include_shared')).toBe(false)
    expect(persisted()).toBe(FORK_ITEMS.high)
    expect(onChange).not.toHaveBeenCalled()
    expect(q('[data-effective-source]')).toBeNull()
  })
})

describe('hooks — idle until the flag settles', () => {
  const wrapperFor =
    (ready: boolean, on = true) =>
    ({ children }: { children?: ReactNode }) => (
      <SharedListsFeatureProvider sharedLists={on} ready={ready}>
        {children}
      </SharedListsFeatureProvider>
    )

  it('useEffectiveList: no lookup, then one after it settles', async () => {
    const fetchMock = mountWorld(forkWorld())
    let ready = false
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <SharedListsFeatureProvider sharedLists ready={ready}>
        {children}
      </SharedListsFeatureProvider>
    )
    const { result, rerender } = renderHook(() => useEffectiveList('priority'), { wrapper })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    ready = true
    rerender()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useStoredValues: no resolve until the flag settles', async () => {
    const fetchMock = mountWorld(forkWorld())
    const { result } = renderHook(() => useStoredValues([FORK_ITEMS.low]), {
      wrapper: wrapperFor(false),
    })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('useSharedListIndex: no list read until the flag settles (still reports loading)', async () => {
    const api = stubApi(onGet('/v1/selection-lists', page([makeForkList()])))
    const { result } = renderHook(() => useSharedListIndex({ status: 'active' }), {
      wrapper: wrapperFor(false),
    })
    await new Promise(r => setTimeout(r, 20))
    expect(api.calls).toHaveLength(0)
    expect(result.current.phase).toBe('loading')
  })
})

describe('4.0.0 flows — wait for the flag instead of running the OFF path first', () => {
  const INDEX = '/settings/selection-lists'
  const mountFlow = (element: ReactNode, path: string, route: string) =>
    render(
      <SharedListsFeatureProvider sharedLists={false} ready={false}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={element} />
          </Routes>
        </MemoryRouter>
      </SharedListsFeatureProvider>
    )

  it.each([
    ['management index', <SelectionListManagementFlow key="m" />, INDEX, INDEX],
    ['management detail', <SelectionListManagementFlow key="d" />, `${INDEX}/${FORK_ID}`, `${INDEX}/:listId`],
    ['translation workbench', <TranslationWorkbenchFlow key="t" />, `${INDEX}/${FORK_ID}/translations`, `${INDEX}/:listId/translations`],
    ['access', <SelectionListAccessFlow key="a" />, `${INDEX}/${FORK_ID}/access`, `${INDEX}/:listId/access`],
  ])('%s: no request and a status placeholder while the flag has not settled', async (_n, element, path, route) => {
    const api = stubApi()
    mountFlow(element, path, route)
    await new Promise(r => setTimeout(r, 30))
    expect(api.calls).toEqual([])
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
