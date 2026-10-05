/**
 * Client projection of contract 4.1.0 (shared lists, common lists, forks).
 *
 * Verifies only what the client puts on the wire and how it surfaces the new
 * response/error fields — never the service's behaviour.
 */
import { describe, expect, it } from 'vitest'
import {
  SelectionListApiError,
  SelectionListClient,
  type SelectionList,
} from '../src/index'

const COMMON = 'front_sl_01h455vb4pex5vsknk084sn02q'
const FORK = 'front_sl_01h455vb4pex5vsknk084sn03r'
const NOW = '2026-10-05T12:00:00Z'

const FORKED: SelectionList = {
  id: FORK,
  organization_id: 'org_01h455vb4pex5vsknk084sn02q',
  key: 'priority',
  source_locale: 'en',
  status: 'active',
  name: 'Priority',
  resolved_locale: 'en',
  is_machine: false,
  seed: null,
  visibility: 'org',
  forked_from: {
    list_id: COMMON,
    organization_id: 'org_01h455vb4pex5vsknk084sn0pf',
    revision: 3,
    forked_at: NOW,
  },
  editable: true,
  created_by: 'usr_01h455vb4pex5vsknk084sn02q',
  created_at: NOW,
  updated_at: NOW,
}

type Call = { method: string; url: URL; body: unknown }

function client(status: number, payload: unknown): { c: SelectionListClient; calls: Call[] } {
  const calls: Call[] = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: new URL(String(input)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { c: new SelectionListClient({ baseUrl: 'http://client.invalid', token: 't', fetch: fakeFetch }), calls }
}

describe('contract 4.1.0 — shared lists and forks', () => {
  it('getLists sends include_shared and visibility', async () => {
    const { c, calls } = client(200, { items: [FORKED], page: { nextCursor: null, hasMore: false } })
    const page = await c.getLists({ include_shared: true, visibility: 'platform' })
    expect(calls[0]!.url.searchParams.get('include_shared')).toBe('true')
    expect(calls[0]!.url.searchParams.get('visibility')).toBe('platform')
    expect(page.items[0]!.forked_from?.list_id).toBe(COMMON)
  })

  it('getEffectiveList is one key lookup with include_shared, null when empty', async () => {
    const { c, calls } = client(200, { items: [], page: { nextCursor: null, hasMore: false } })
    expect(await c.getEffectiveList('priority')).toBeNull()
    expect(calls).toHaveLength(1)
    const q = calls[0]!.url.searchParams
    expect([q.get('key'), q.get('include_shared'), q.get('limit')]).toEqual(['priority', 'true', '1'])
  })

  it.each([
    [201, true],
    [200, false],
  ])('forkList on HTTP %i reports created=%s and sends no id', async (status, created) => {
    const { c, calls } = client(status, FORKED)
    const res = await c.forkList(COMMON, { visibility: 'private' })
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.pathname).toBe(`/v1/selection-lists/${COMMON}/fork`)
    expect(calls[0]!.body).toEqual({ visibility: 'private' })
    expect(res).toEqual({ list: FORKED, created })
  })

  it('a fork_required conflict exposes the fork hints', async () => {
    const { c } = client(409, {
      code: 'CONFLICT',
      message: 'Fork the common list to change it.',
      reason: 'fork_required',
      fork_url: `/v1/selection-lists/${COMMON}/fork`,
      source_list_id: COMMON,
    })
    const err = await c.updateList(COMMON, { name: 'Urgency' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SelectionListApiError)
    const e = err as SelectionListApiError
    expect(e.isConflict).toBe(true)
    expect(e.isForkRequired).toBe(true)
    expect(e.sourceListId).toBe(COMMON)
    expect(e.forkUrl).toBe(`/v1/selection-lists/${COMMON}/fork`)
  })

  it('a plain conflict is not fork_required', async () => {
    const { c } = client(409, { code: 'CONFLICT', message: 'duplicate key' })
    const e = (await c.createList({ key: 'priority', name: 'P' }).catch((x: unknown) => x)) as SelectionListApiError
    expect(e.isConflict).toBe(true)
    expect(e.isForkRequired).toBe(false)
  })
})
