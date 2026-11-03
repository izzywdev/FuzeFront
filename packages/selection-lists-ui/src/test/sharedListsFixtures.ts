/**
 * Fixtures for the shared-lists (`src/shared-lists/**`) unit tests. Nothing here
 * touches the network: `fetch` is stubbed by the tests that use it.
 */
import { vi } from 'vitest'
import type { SharedList } from '../shared-lists/core/types'

export const COMMON_ID = 'front_sl_01jf8k2m3n4p5q6r7s8t9v0w1x'
export const FORK_ID = 'front_sl_01jfq3w8z6y5x4c3b2a1n9m8k7'

export function makeSharedList(over: Partial<SharedList> = {}): SharedList {
  return {
    id: FORK_ID,
    organization_id: 'org_01jf000000000000000000acme',
    key: 'priority',
    source_locale: 'en',
    status: 'active',
    name: 'Priority',
    resolved_locale: 'en',
    is_machine: false,
    item_count: 5,
    seed: null,
    visibility: 'org',
    forked_from: null,
    editable: true,
    created_by: 'usr_01jf00000000000000000000d1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    ...over,
  }
}

/** A common (platform) list, read-only for the caller. */
export function makeCommonList(over: Partial<SharedList> = {}): SharedList {
  return makeSharedList({
    id: COMMON_ID,
    organization_id: 'org_01jf0000000000000000platform',
    visibility: 'platform',
    editable: false,
    created_by: 'system:selection-list-service',
    ...over,
  })
}

/** A fork of the common list, owned by the caller's org. */
export function makeForkList(over: Partial<SharedList> = {}): SharedList {
  return makeSharedList({
    forked_from: {
      list_id: COMMON_ID,
      organization_id: 'org_01jf0000000000000000platform',
      revision: 3,
      forked_at: '2026-09-02T00:00:00Z',
    },
    ...over,
  })
}

/** A `fetch` Response stand-in with the shape `api.ts#request` reads. */
export function jsonResponse(
  body: unknown,
  status = 200,
  statusText = 'OK'
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as Response
}

/** A response whose body is not JSON (an ingress error page). */
export function htmlResponse(
  status: number,
  statusText = 'Bad Gateway'
): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => {
      throw new SyntaxError('Unexpected token <')
    },
  } as unknown as Response
}

/** The page envelope the service sends. */
export function page(items: unknown[], nextCursor: string | null = null) {
  return { items, page: { nextCursor, hasMore: nextCursor !== null } }
}

/** Mirrors the Error `api.ts#request` throws: the error body's fields plus `status`. */
export function requestError(
  status: number,
  body: Record<string, unknown> = {}
): Error & Record<string, unknown> {
  const e = new Error(String(body.message ?? `HTTP ${status}`)) as Error &
    Record<string, unknown>
  Object.assign(e, body, { status })
  return e
}

/** Stub `fetch` for a test; returns the mock so calls can be asserted. */
export function stubFetch() {
  const mock = vi.fn()
  vi.stubGlobal('fetch', mock)
  return mock
}

export type FetchCall = [string, RequestInit | undefined]

export function callsOf(mock: ReturnType<typeof stubFetch>): FetchCall[] {
  return mock.mock.calls as FetchCall[]
}

/** The most recent call. */
export function lastCallOf(mock: ReturnType<typeof stubFetch>): FetchCall {
  const calls = callsOf(mock)
  return calls[calls.length - 1]
}

/** The query string of a call's URL as a plain object. */
export function queryOf(url: string): Record<string, string> {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  return Object.fromEntries(new URLSearchParams(q))
}

/** Let pending promise callbacks and React effects settle. */
export const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))
