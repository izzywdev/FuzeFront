/**
 * Shared test helpers for the selection-lists-ui unit tests.
 *
 * The flows import their data layer from `./api` (the same-origin REST client),
 * so that module is the boundary every test mocks (`vi.mock('../api')`). These
 * helpers only build fixtures, error objects shaped like `api.ts`'s `request()`
 * failures, and a MemoryRouter harness — none of them touch the network.
 */
import React from 'react'
import { act, render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type {
  AccessGrant,
  ApiError,
  LocaleIndexEntry,
  QuotaStatus,
  SelectionList,
  SelectionListItem,
  TranslationEntry,
} from '../types'

// ── Errors ────────────────────────────────────────────────────────────────────

/** Mirrors the Error `api.ts#request` throws: ApiError fields + `status`. */
export function apiError(
  status: number,
  code: string,
  message = code,
  extra: Partial<ApiError> = {},
): Error & ApiError & { status: number } {
  const e = new Error(message) as Error & ApiError & { status: number }
  Object.assign(e, { code, message, status, ...extra })
  return e
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export function makeList(over: Partial<SelectionList> = {}): SelectionList {
  return {
    id: 'sl_01',
    key: 'countries',
    name: 'Countries',
    is_machine: false,
    status: 'active',
    item_count: 3,
    source_locale: 'en',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...over,
  }
}

export function makeItem(over: Partial<SelectionListItem> = {}): SelectionListItem {
  return {
    id: 'sli_01',
    list_id: 'sl_01',
    code: 'DE',
    label: 'Germany',
    is_machine: false,
    status: 'active',
    sort_order: 1,
    source_hash: 'h1',
    ...over,
  }
}

export function makeQuota(
  over: Partial<Record<'org_lists' | 'user_lists' | 'list_items' | 'list_locales', [number | null, number]>> = {},
): QuotaStatus {
  const base: Record<string, [number | null, number]> = {
    org_lists: [2, 50],
    user_lists: [1, 10],
    list_items: [null, 500],
    list_locales: [null, 11],
    ...over,
  }
  return {
    scopes: Object.entries(base).map(([scope, [current, limit]]) => ({
      scope: scope as QuotaStatus['scopes'][number]['scope'],
      current,
      limit,
    })),
  }
}

export function makeLocale(over: Partial<LocaleIndexEntry> = {}): LocaleIndexEntry {
  return {
    locale: 'fr',
    is_source: false,
    translated: 0,
    total: 4,
    machine_count: 0,
    stale_count: 0,
    ...over,
  }
}

export function makeTranslation(over: Partial<TranslationEntry> = {}): TranslationEntry {
  return {
    item_id: 'sli_01',
    locale: 'fr',
    label: 'Allemagne',
    is_machine: false,
    source_hash: 'h1',
    source_hash_current: 'h1',
    ...over,
  }
}

export function makeGrant(over: Partial<AccessGrant> = {}): AccessGrant {
  return {
    user_id: 'usr_alice',
    role: 'list-owner',
    granted_by: 'usr_root',
    granted_at: '2026-01-01T00:00:00Z',
    is_sole_owner: false,
    ...over,
  }
}

// ── Router harness ────────────────────────────────────────────────────────────

/** Prints the current router location so tests can assert navigation. */
export function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

/**
 * Render `element` at `initialPath`, registered under each of `routePaths`
 * (so `useParams` resolves exactly as it does in the shell). Every route also
 * renders a `LocationProbe`.
 */
export function renderFlow(
  element: React.ReactElement,
  initialPath: string,
  routePaths: string[] = [initialPath],
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        {routePaths.map(p => (
          <Route key={p} path={p} element={element} />
        ))}
        {/* navigation targets outside the flow under test (e.g. /access) */}
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  )
}

/** A promise the test resolves/rejects by hand — to observe in-flight states. */
export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export const NEVER = new Promise<never>(() => {})

/**
 * Like `renderFlow`, but flushes the mount effects inside `act` — use when the
 * mocked API never settles (in-flight / loading assertions), so the effects'
 * synchronous state updates don't trip React's act() warning.
 */
export async function renderFlowSettled(
  element: React.ReactElement,
  initialPath: string,
  routePaths: string[] = [initialPath],
): Promise<RenderResult> {
  let utils!: RenderResult
  await act(async () => {
    utils = renderFlow(element, initialPath, routePaths)
  })
  return utils
}
