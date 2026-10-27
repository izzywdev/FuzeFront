/**
 * Harness for the fork-flow unit tests (`shared-lists/fork/**`): a path-routed
 * `fetch` stub, a router + feature-provider wrapper, and a controllable
 * `matchMedia` for the Modal / BottomSheet switch. Nothing touches the network.
 */
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { SharedListsFeatureProvider } from '../shared-lists/core/SharedListsFeatureProvider'
import { jsonResponse } from './sharedListsFixtures'

export type RouteHandler = (
  init: RequestInit | undefined,
  url: string
) => Response | Promise<Response>

/**
 * `fetch` stub routed by `"METHOD /path"` (query string ignored, `/api` prefix
 * kept). An unrouted request answers 404 NOT_FOUND so a missing route fails
 * loudly in the assertion that needed it instead of hanging.
 */
export function routeFetch(routes: Record<string, RouteHandler>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]
    const method = (init?.method ?? 'GET').toUpperCase()
    const handler = routes[`${method} ${path}`]
    if (!handler)
      return jsonResponse({ code: 'NOT_FOUND', message: 'unrouted' }, 404)
    return handler(init, url)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** The parsed JSON bodies of every call to `METHOD path`. */
export function bodiesOf(
  mock: ReturnType<typeof routeFetch>,
  method: string,
  path: string
): unknown[] {
  return mock.mock.calls
    .filter(
      ([url, init]) =>
        url.split('?')[0] === path &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === method
    )
    .map(([, init]) =>
      (init as RequestInit | undefined)?.body
        ? JSON.parse((init as RequestInit).body as string)
        : undefined
    )
}

export function callCount(
  mock: ReturnType<typeof routeFetch>,
  method: string,
  path: string
): number {
  return bodiesOf(mock, method, path).length
}

/** The error body shape of the service (`{ code, message, reason?, … }`). */
export function errorResponse(
  status: number,
  code: string,
  extra: Record<string, unknown> = {}
): Response {
  return jsonResponse({ code, message: code, ...extra }, status)
}

export function LocationState() {
  const loc = useLocation()
  return (
    <>
      <div data-testid="path">{loc.pathname}</div>
      <div data-testid="state">{JSON.stringify(loc.state)}</div>
    </>
  )
}

export interface RenderForkOptions {
  flag?: boolean
  at?: string
  organizationId?: string
  organizationName?: string | null
  isPlatformOrg?: boolean
}

/** Render `ui` inside a router and the feature provider (flag ON by default). */
export function renderFork(
  ui: ReactElement,
  opts: RenderForkOptions = {}
): RenderResult {
  const {
    flag = true,
    at = '/settings/selection-lists/x',
    organizationId = 'org_globex',
    organizationName = 'Globex Freight',
  } = opts
  return render(
    <MemoryRouter initialEntries={[at]}>
      <SharedListsFeatureProvider
        sharedLists={flag}
        organizationId={organizationId}
        organizationName={organizationName ?? undefined}
        isPlatformOrg={opts.isPlatformOrg}
      >
        <LocationState />
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </SharedListsFeatureProvider>
    </MemoryRouter>
  )
}

/**
 * Make `window.matchMedia` answer the 40em query: `wide` true = Modal. Returns a
 * setter that flips the answer and notifies listeners (a viewport resize).
 */
export function stubViewport(wide: boolean) {
  let matches = wide
  const listeners = new Set<() => void>()
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        media: query,
        get matches() {
          return matches
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      }) as unknown as MediaQueryList
  )
  return (next: boolean) => {
    matches = next
    listeners.forEach(fn => fn())
  }
}
