/**
 * Harness for the shared-read (browse) tests: a path-routed `fetch` stub and a
 * MemoryRouter + feature-provider mount. Nothing here touches the network.
 */
import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { SharedListsFeatureProvider } from '../shared-lists/core/SharedListsFeatureProvider'
import { jsonResponse, page } from './sharedListsFixtures'

export interface ApiRequest {
  method: string
  path: string
  query: URLSearchParams
}

export type ApiReply = { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>
export type ApiHandler = (req: ApiRequest) => ApiReply | undefined

export interface ApiStub {
  calls: ApiRequest[]
  /** Calls to `path` (exact) with the given method. */
  callsTo: (method: string, path: string | RegExp) => ApiRequest[]
  /** Prepend a handler (most recent first). */
  use: (handler: ApiHandler) => void
}

/**
 * Stub `fetch` with `handlers` (first one returning a reply wins). Anything
 * unhandled is a 404 NOT_FOUND, like the service for an unknown route.
 */
export function stubApi(...handlers: ApiHandler[]): ApiStub {
  const chain = [...handlers]
  const calls: ApiRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      const req: ApiRequest = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^\/api/, ''),
        query: url.searchParams,
      }
      calls.push(req)
      for (const handler of chain) {
        const reply = handler(req)
        if (reply !== undefined) {
          const { status = 200, body } = await reply
          return jsonResponse(body, status)
        }
      }
      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    })
  )
  return {
    calls,
    callsTo: (method, path) =>
      calls.filter(
        c =>
          c.method === method &&
          (typeof path === 'string' ? c.path === path : path.test(c.path))
      ),
    use: handler => chain.unshift(handler),
  }
}

/** Reply `body` to GET `path`. */
export function onGet(
  path: string | RegExp,
  reply: object | ((req: ApiRequest) => ApiReply | undefined)
): ApiHandler {
  return req => {
    if (req.method !== 'GET') return undefined
    if (typeof path === 'string' ? req.path !== path : !path.test(req.path))
      return undefined
    return typeof reply === 'function'
      ? (reply as (r: ApiRequest) => ApiReply | undefined)(req)
      : { body: reply }
  }
}

export { page }

/**
 * `GET …/items` as the service answers it: `status` is `active` (default) or
 * `archived` — anything else, including the openapi's `all`, is a 400.
 */
export function onItems(
  path: string,
  rows: Array<{ status: string }>,
  resolve?: (row: never, locale: string | null) => object
): ApiHandler {
  return onGet(path, req => {
    const status = req.query.get('status') ?? 'active'
    if (status !== 'active' && status !== 'archived')
      return { status: 400, body: { code: 'VALIDATION_ERROR' } }
    const mine = rows.filter(row => row.status === status)
    return {
      body: page(
        resolve ? mine.map(row => resolve(row as never, req.query.get('locale'))) : mine
      ),
    }
  })
}

export function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

/** Mount `element` at `initialPath` under `routePaths`, inside the feature provider. */
export function renderShared(
  element: ReactElement,
  initialPath: string,
  options: { routePaths?: string[]; sharedLists?: boolean } = {}
): RenderResult {
  const { routePaths = [initialPath.split('?')[0]], sharedLists = true } = options
  return render(
    <SharedListsFeatureProvider sharedLists={sharedLists}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          {routePaths.map(p => (
            <Route key={p} path={p} element={element} />
          ))}
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </SharedListsFeatureProvider>
  )
}
