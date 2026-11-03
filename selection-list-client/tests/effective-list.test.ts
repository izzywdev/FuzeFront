/**
 * `getEffectiveList` follows empty, non-terminal pages (2.2.0).
 *
 * The service paginates BEFORE it drops rows the caller cannot read, so a key
 * lookup can return an EMPTY page that still carries a next cursor. Verifies
 * only what the client sends and how it walks — never the service.
 */
import { describe, expect, it } from 'vitest'
import {
  EffectiveLookupIncompleteError,
  MAX_EFFECTIVE_LOOKUP_PAGES,
  SelectionListApiError,
  SelectionListClient,
  isEffectiveLookupIncompleteError,
  type SelectionList,
} from '../src/index'

const NOW = '2026-10-05T12:00:00Z'
const COMMON: SelectionList = {
  id: 'front_sl_01h455vb4pex5vsknk084sn02q',
  organization_id: 'org_01h455vb4pex5vsknk084sn0pf',
  key: 'priority',
  source_locale: 'en',
  status: 'active',
  name: 'Priority',
  resolved_locale: 'en',
  is_machine: false,
  seed: null,
  visibility: 'platform',
  forked_from: null,
  editable: false,
  created_by: 'system:platform',
  created_at: NOW,
  updated_at: NOW,
}

type Reply = { status?: number; body: unknown }
const page = (items: SelectionList[], nextCursor: string | null): Reply => ({
  body: { items, page: { nextCursor, hasMore: nextCursor !== null } },
})

/** A client whose fetch answers `replies` in order and records every URL it was asked for. */
function scripted(replies: Reply[], onCall?: (n: number) => void) {
  const urls: URL[] = []
  const fakeFetch = (async (input: string | URL | Request) => {
    urls.push(new URL(String(input)))
    onCall?.(urls.length)
    const r = replies[urls.length - 1]
    if (!r) throw new Error(`unexpected request #${urls.length}`)
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { c: new SelectionListClient({ baseUrl: 'http://client.invalid', token: 't', fetch: fakeFetch }), urls }
}

describe('getEffectiveList — empty non-terminal pages', () => {
  it('follows an empty page that has a next cursor, then returns the hit', async () => {
    const { c, urls } = scripted([page([], 'c1'), page([COMMON], null)])
    expect(await c.getEffectiveList('priority')).toEqual(COMMON)
    expect(urls).toHaveLength(2)
    // Same query on every page; only the cursor is added.
    for (const u of urls) {
      expect([u.searchParams.get('key'), u.searchParams.get('include_shared'), u.searchParams.get('limit')]).toEqual([
        'priority',
        'true',
        '1',
      ])
    }
    expect(urls[0]!.searchParams.has('cursor')).toBe(false)
    expect(urls[1]!.searchParams.get('cursor')).toBe('c1')
  })

  it('walks several empty pages, passing each page’s own cursor', async () => {
    const { c, urls } = scripted([page([], 'c1'), page([], 'c2'), page([], 'c3'), page([COMMON], 'c4')])
    expect(await c.getEffectiveList('priority')).toEqual(COMMON)
    expect(urls.map((u) => u.searchParams.get('cursor'))).toEqual([null, 'c1', 'c2', 'c3'])
  })

  it('a terminal empty page is "no list" (null)', async () => {
    const { c, urls } = scripted([page([], 'c1'), page([], null)])
    expect(await c.getEffectiveList('priority')).toBeNull()
    expect(urls).toHaveLength(2)
  })

  it('hasMore=false ends the walk even if a cursor is present', async () => {
    const { c, urls } = scripted([{ body: { items: [], page: { nextCursor: 'c1', hasMore: false } } }])
    expect(await c.getEffectiveList('priority')).toBeNull()
    expect(urls).toHaveLength(1)
  })

  it('ignores a row for a different key and keeps walking', async () => {
    const other = { ...COMMON, key: 'urgency' }
    const { c } = scripted([page([other], 'c1'), page([COMMON], null)])
    expect(await c.getEffectiveList('priority')).toEqual(COMMON)
  })

  it(`exhausting ${MAX_EFFECTIVE_LOOKUP_PAGES} pages rejects as incomplete — never null`, async () => {
    const replies = Array.from({ length: MAX_EFFECTIVE_LOOKUP_PAGES + 1 }, (_, i) => page([], `c${i + 1}`))
    const { c, urls } = scripted(replies)
    const err = await c.getEffectiveList('priority').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EffectiveLookupIncompleteError)
    expect(isEffectiveLookupIncompleteError(err)).toBe(true)
    expect((err as EffectiveLookupIncompleteError).incomplete).toBe(true)
    expect((err as EffectiveLookupIncompleteError).pages).toBe(MAX_EFFECTIVE_LOOKUP_PAGES)
    expect(urls).toHaveLength(MAX_EFFECTIVE_LOOKUP_PAGES)
  })

  it('a failed page rejects with the API error and does not fall back', async () => {
    const { c, urls } = scripted([page([], 'c1'), { status: 500, body: { code: 'INTERNAL_ERROR', message: 'boom' } }])
    const err = await c.getEffectiveList('priority').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SelectionListApiError)
    expect(urls).toHaveLength(2)
  })

  it('an already-aborted signal makes no request', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const { c, urls } = scripted([page([COMMON], null)])
    const err = await c.getEffectiveList('priority', undefined, ctl.signal).catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(urls).toHaveLength(0)
  })

  it('aborting mid-walk stops before the next page', async () => {
    const ctl = new AbortController()
    const { c, urls } = scripted([page([], 'c1'), page([COMMON], null)], (n) => {
      if (n === 1) ctl.abort()
    })
    const err = await c.getEffectiveList('priority', undefined, ctl.signal).catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(urls).toHaveLength(1)
  })
})
