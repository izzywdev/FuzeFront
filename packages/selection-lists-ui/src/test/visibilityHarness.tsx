/**
 * Harness for the visibility-flow tests: a URL-routed `fetch` stand-in for the
 * list / access / PATCH endpoints, and a renderer that mounts the control under
 * the feature provider. Nothing here touches the network.
 */
import { render, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import {
  SharedListsFeatureProvider,
  type SharedList,
} from '../shared-lists/core'
import { VisibilityControl } from '../shared-lists/visibility'
import type { AccessObservation } from '../shared-lists/visibility'
import {
  jsonResponse,
  makeSharedList,
  stubFetch,
  type FetchCall,
} from './sharedListsFixtures'

export const BASE = '/api/v1/selection-lists'

export const PLATFORM_ORG_ID = 'org_01jf0000000000000000platform'

type Handler = (init: RequestInit | undefined, url: string) => Promise<Response> | Response

/** A route table keyed `METHOD /path`; unmatched requests fail the test loudly. */
export function routedFetch(routes: Record<string, Handler>) {
  const mock = stubFetch()
  mock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.split('?')[0]
    const handler = routes[`${method} ${path}`]
    if (!handler) throw new Error(`unrouted request: ${method} ${url}`)
    return handler(init, url)
  })
  return mock
}

export function callsTo(mock: ReturnType<typeof stubFetch>, method: string, path: string) {
  return (mock.mock.calls as FetchCall[]).filter(
    ([url, init]) =>
      (init?.method ?? 'GET').toUpperCase() === method && url.split('?')[0] === path
  )
}

export function bodyOf(call: FetchCall) {
  return JSON.parse(call[1]!.body as string)
}

export const err = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  jsonResponse({ code, message: code, ...extra }, status)

/** Mutable server state behind the routes. */
export function world(initial: SharedList) {
  const state = { list: initial }
  const path = `${BASE}/${initial.id}`
  const routes: Record<string, Handler> = {
    [`GET ${path}`]: () => jsonResponse(state.list),
    [`PATCH ${path}`]: init => {
      state.list = { ...state.list, visibility: JSON.parse(init!.body as string).visibility }
      return jsonResponse(state.list)
    },
  }
  return { state, routes, path }
}

export interface RenderOpts {
  flag?: boolean
  platformOrg?: boolean
  access?: AccessObservation
  organizationName?: string
  activeOrganizationId?: string
  onRetryAccess?: () => void
  onChanged?: (list: SharedList) => void
  dir?: 'ltr' | 'rtl'
}

export function renderControl(list: SharedList, opts: RenderOpts = {}): RenderResult {
  return render(
    <div dir={opts.dir ?? 'ltr'}>
      <SharedListsFeatureProvider
        sharedLists={opts.flag ?? true}
        isPlatformOrg={opts.platformOrg ?? false}
      >
        <VisibilityControl
          listId={list.id}
          access={opts.access ?? 'granted'}
          onRetryAccess={opts.onRetryAccess ?? (() => undefined)}
          organizationName={opts.organizationName ?? 'Acme Logistics'}
          activeOrganizationId={opts.activeOrganizationId}
          onChanged={opts.onChanged}
        />
      </SharedListsFeatureProvider>
    </div>
  )
}

/** Make `matchMedia` answer for the compact (phone) breakpoint. */
export function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  let current = matches
  const mql = {
    get matches() {
      return current
    },
    media: '',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', () => mql)
  return {
    set(next: boolean) {
      current = next
      listeners.forEach(l => l())
    },
    listeners,
  }
}

export const forkList = (over: Partial<SharedList> = {}) =>
  makeSharedList({
    forked_from: {
      list_id: 'front_sl_01jf8k2m3n4p5q6r7s8t9v0w1x',
      organization_id: PLATFORM_ORG_ID,
      revision: 3,
      forked_at: '2026-09-02T00:00:00Z',
    },
    ...over,
  })

export const platformOwned = (over: Partial<SharedList> = {}) =>
  makeSharedList({
    id: 'front_sl_01jfticketchannel0000000a1',
    key: 'ticket-channel',
    name: 'Ticket channel',
    organization_id: PLATFORM_ORG_ID,
    visibility: 'org',
    ...over,
  })
