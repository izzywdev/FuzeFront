/**
 * Fixtures for the fork-provenance (`src/shared-lists/provenance/**`) tests.
 * Nothing here touches the network: `fetch` is routed to in-memory handlers.
 */
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  COMMON_ID,
  FORK_ID,
  jsonResponse,
  makeCommonList,
  makeForkList,
  page,
  stubFetch,
} from './sharedListsFixtures'
import { withSharedLists } from './sharedListsWrapper'
import type { SharedList } from '../shared-lists/core/types'

export { COMMON_ID, FORK_ID, jsonResponse, page }

export const COMMON_ITEM = {
  low: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa1',
  normal: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa2',
}
export const FORK_ITEM = {
  low: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b1',
  medium: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b2',
  blocker: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b6',
}

/** The fork of frame 07: copied at revision 7 on Sep 2, 2026. */
export function priorityFork(over: Partial<SharedList> = {}): SharedList {
  return makeForkList({
    forked_from: {
      list_id: COMMON_ID,
      organization_id: 'org_01jf0000000000000000platform',
      revision: 7,
      forked_at: '2026-09-02T09:14:00Z',
    },
    ...over,
  })
}

/** The common list; `revision` is the 4.2.0 field a 4.1.x service does not send. */
export function priorityCommon(
  over: Partial<SharedList> & { revision?: number } = {}
): SharedList {
  return makeCommonList({ id: COMMON_ID, ...over })
}

export function commonItems() {
  return [
    { id: COMMON_ITEM.low, label: 'Low', code: 'LOW', status: 'active' },
    { id: COMMON_ITEM.normal, label: 'Normal', code: 'NORMAL', status: 'active' },
  ]
}

export function forkItems() {
  return [
    { id: FORK_ITEM.low, label: 'Low', code: 'LOW', origin_item_id: COMMON_ITEM.low },
    { id: FORK_ITEM.medium, label: 'Medium', code: 'NORMAL', origin_item_id: COMMON_ITEM.normal },
    { id: FORK_ITEM.blocker, label: 'Blocker', code: 'BLOCKER', origin_item_id: null },
  ]
}

export type Handler = (
  url: string,
  init?: RequestInit
) => Response | Promise<Response>

/**
 * Route `fetch` by `"METHOD /path"` (the query is ignored for matching). An
 * unrouted request throws, so a test cannot pass by an unexpected call.
 */
export function routeFetch(routes: Record<string, Handler>) {
  const mock = stubFetch()
  mock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`
    const handler = routes[key]
    if (!handler) throw new Error(`unrouted request: ${key}`)
    return handler(url, init)
  })
  return mock
}

export const API = '/api/v1/selection-lists'
export const forkPath = `GET ${API}/${FORK_ID}`
export const sourcePath = `GET ${API}/${COMMON_ID}`
export const sourceItemsPath = `GET ${API}/${COMMON_ID}/items`
export const archivePath = `POST ${API}/${FORK_ID}/archive`

export function error(status: number, code: string, reason?: string) {
  return jsonResponse({ code, message: code, ...(reason ? { reason } : {}) }, status)
}

/** Render inside a router and the shared-lists flag provider. */
export function renderProvenance(
  ui: ReactElement,
  { flag = true, route = `/settings/selection-lists/${FORK_ID}` } = {}
) {
  const Wrapper = withSharedLists(flag)
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Wrapper>{ui}</Wrapper>
    </MemoryRouter>
  )
}

/** Stub `matchMedia` so `(max-width: 40em)` matches (or not). */
export function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const state = { matches }
  const mql = {
    get matches() {
      return state.matches
    },
    media: '(max-width: 40em)',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  const original = window.matchMedia
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      state.matches = next
      listeners.forEach(l => l())
    },
    restore() {
      window.matchMedia = original
    },
  }
}
