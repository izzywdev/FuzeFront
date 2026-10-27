/**
 * A tiny in-memory service for the effective-picker tests: routes the three
 * requests the picker makes (`GET /selection-lists?key=`, `GET …/items`,
 * `POST /resolve`) through a stubbed `fetch`, and records every call.
 */
import { vi } from 'vitest'
import type { SharedList } from '../shared-lists/core/types'
import {
  COMMON_ID,
  FORK_ID,
  jsonResponse,
  makeCommonList,
  makeForkList,
  page,
  stubFetch,
} from './sharedListsFixtures'

export const FORK_ITEMS = {
  low: 'front_sli_f1',
  medium: 'front_sli_f2',
  high: 'front_sli_f3',
} as const
export const COMMON_ITEMS = {
  low: 'front_sli_c1',
  normal: 'front_sli_c2',
  high: 'front_sli_c3',
} as const

const item = (id: string, listId: string, label: string, n: number, status = 'active') => ({
  id,
  list_id: listId,
  code: label.toUpperCase(),
  label,
  is_machine: false,
  status,
  sort_order: n,
  source_hash: `h${n}`,
})

export const forkItems = () => [
  // deliberately out of sort_order so the order assertions can only pass by following it
  item(FORK_ITEMS.high, FORK_ID, 'High', 3),
  item(FORK_ITEMS.low, FORK_ID, 'Low', 1),
  item(FORK_ITEMS.medium, FORK_ID, 'Medium', 2),
]
export const commonItems = () => [
  item(COMMON_ITEMS.low, COMMON_ID, 'Low', 1),
  item(COMMON_ITEMS.normal, COMMON_ID, 'Normal', 2),
  item(COMMON_ITEMS.high, COMMON_ID, 'High', 3),
]

export interface World {
  /** What `GET /selection-lists?key=priority` answers, page by page (default: one page with the list). */
  lookupPages: Array<{ items: SharedList[]; nextCursor?: string | null }>
  items: Record<string, unknown[]>
  /** `POST /resolve` `results`, by id; ids with no entry are `missing`. */
  resolve: Record<string, Record<string, unknown>>
  /** Make a request fail: return a Response to short-circuit it. */
  fail?: (url: string, init?: RequestInit) => Response | undefined
}

export function forkWorld(over: Partial<World> = {}): World {
  return {
    lookupPages: [{ items: [makeForkList({ name: 'Priority' })] }],
    items: { [FORK_ID]: forkItems(), [COMMON_ID]: commonItems() },
    resolve: {},
    ...over,
  }
}

export function commonWorld(over: Partial<World> = {}): World {
  return forkWorld({
    lookupPages: [{ items: [makeCommonList({ name: 'Priority' })] }],
    ...over,
  })
}

export function resolved(label: string, over: Record<string, unknown> = {}) {
  return { label, locale: 'en', is_machine: false, status: 'active', ...over }
}

export function mountWorld(world: World) {
  const fetchMock = stubFetch()
  let lookupIndex = 0
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const failed = world.fail?.(url, init)
    if (failed) return failed
    const path = url.split('?')[0]
    if (path === '/api/v1/resolve') {
      const ids: string[] = JSON.parse(String(init?.body)).ids
      return jsonResponse({
        results: Object.fromEntries(
          ids.filter(id => world.resolve[id]).map(id => [id, world.resolve[id]])
        ),
        missing: ids.filter(id => !world.resolve[id]),
      })
    }
    const items = /^\/api\/v1\/selection-lists\/([^/]+)\/items$/.exec(path)
    if (items) {
      const all = world.items[decodeURIComponent(items[1])] ?? []
      const status = new URLSearchParams(url.split('?')[1] ?? '').get('status')
      return jsonResponse(
        page(status ? all.filter(i => (i as { status: string }).status === status) : all)
      )
    }
    if (path === '/api/v1/selection-lists') {
      const current = world.lookupPages[Math.min(lookupIndex, world.lookupPages.length - 1)]
      lookupIndex += 1
      return jsonResponse(page(current.items, current.nextCursor ?? null))
    }
    return jsonResponse({ code: 'NOT_FOUND', message: 'nope' }, 404)
  })
  return fetchMock
}

/** A response the service would send for a 5xx / 403. */
export const serverError = () => jsonResponse({ code: 'INTERNAL', message: 'boom' }, 500)
export const forbidden = () => jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)

/** Requests the mock saw, as `{method, path, query, body}`. */
export function callsMade(fetchMock: ReturnType<typeof vi.fn>) {
  return (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).map(
    ([url, init]) => ({
      method: init?.method ?? 'GET',
      path: url.split('?')[0].replace('/api', ''),
      query: new URLSearchParams(url.split('?')[1] ?? ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
  )
}
