import { describe, expect, it, vi } from 'vitest'
import {
  CONFIG_CHANGED_TOPIC,
  ConfigCache,
  ConfigClient,
  parseConfigChangedEvent,
  type EffectiveConfig,
} from '../src'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('revealSecret / listConfigHistory reachability', () => {
  it('revealSecret POSTs /v1/config/secrets/reveal with the body', async () => {
    const fetchMock = vi.fn(async () => json({ value: 's3cret' }))
    const client = new ConfigClient({ baseUrl: '/api/config', token: 't', fetch: fetchMock as never })
    const out = await client.revealSecret({
      namespace: 'ns',
      scope: { scopeType: 'org', scopeId: 'o1' },
      key: 'api.token',
      reason: 'rotate',
    })
    expect(out.value).toBe('s3cret')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/config/v1/config/secrets/reveal')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ key: 'api.token', reason: 'rotate' })
  })

  it('listConfigHistory GETs /v1/config/history with scope + key + paging', async () => {
    const fetchMock = vi.fn(async () => json({ items: [], pageInfo: { hasNextPage: false } }))
    const client = new ConfigClient({ baseUrl: 'http://cfg', fetch: fetchMock as never })
    await client.listConfigHistory({
      namespace: 'ns',
      scope: { scopeType: 'platform', scopeId: null },
      key: 'k',
      limit: 10,
      cursor: 'c1',
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const u = new URL(url)
    expect(u.pathname).toBe('/v1/config/history')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      namespace: 'ns',
      scopeType: 'platform',
      key: 'k',
      limit: '10',
      cursor: 'c1',
    })
    expect(init.method).toBe('GET')
  })
})

describe('parseConfigChangedEvent', () => {
  const payload = { namespace: 'ns', scope: { scopeType: 'org', scopeId: 'o1' }, changedKeys: ['a'] }
  it('accepts an envelope or a bare payload', () => {
    expect(parseConfigChangedEvent({ topic: CONFIG_CHANGED_TOPIC, payload })).toEqual(payload)
    expect(parseConfigChangedEvent(payload)).toEqual(payload)
  })
  it('rejects malformed input', () => {
    expect(parseConfigChangedEvent(null)).toBeNull()
    expect(parseConfigChangedEvent({ ...payload, changedKeys: [1] })).toBeNull()
    expect(parseConfigChangedEvent({ ...payload, scope: { scopeType: 'x', scopeId: null } })).toBeNull()
  })
  it('topic constant matches the producer', () => {
    expect(CONFIG_CHANGED_TOPIC).toBe('config.changed')
  })
})

describe('ConfigCache', () => {
  const ORG = { scopeType: 'org', scopeId: 'o1' } as const
  const cfg = (version: string): EffectiveConfig =>
    ({ namespace: 'ns', scope: ORG, version, entries: [] }) as EffectiveConfig

  function setup(responses: Array<() => Response>, maxAgeMs = 60_000) {
    let t = 0
    const fetchMock = vi.fn(async () => (responses.shift() as () => Response)())
    const client = new ConfigClient({ baseUrl: 'http://cfg', fetch: fetchMock as never })
    const cache = new ConfigCache(client, { maxAgeMs, now: () => t })
    return { cache, fetchMock, advance: (ms: number) => (t += ms) }
  }
  const headerOf = (m: ReturnType<typeof vi.fn>, i: number) =>
    ((m.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['If-None-Match']

  it('serves from cache within maxAge', async () => {
    const { cache, fetchMock } = setup([() => json(cfg('v1'))])
    await cache.get('ns', ORG)
    await cache.get('ns', ORG)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a config.changed event invalidates; the next read does a FULL re-resolve', async () => {
    const { cache, fetchMock } = setup([() => json(cfg('v1')), () => json(cfg('v2'))])
    await cache.get('ns', ORG)
    expect(cache.handleEvent({ namespace: 'ns', scope: ORG, changedKeys: ['a'] })).toBe(true)
    const fresh = await cache.get('ns', ORG)
    expect(fresh.version).toBe('v2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(headerOf(fetchMock, 1)).toBeUndefined() // unconditional
  })

  it('an ancestor-scope event invalidates descendants in the same namespace only', async () => {
    const { cache } = setup([() => json(cfg('v1'))])
    await cache.get('ns', ORG)
    expect(cache.handleEvent({ namespace: 'ns', scope: { scopeType: 'portal', scopeId: 'p' }, changedKeys: ['a'] })).toBe(true)
    expect(cache.handleEvent({ namespace: 'other', scope: ORG, changedKeys: ['a'] })).toBe(false)
  })

  it('ignores a malformed event', () => {
    const { cache } = setup([])
    expect(cache.handleEvent({ nonsense: true })).toBe(false)
  })

  it('missed event: after maxAge it revalidates by version (If-None-Match -> 304 keeps the cache)', async () => {
    const { cache, fetchMock, advance } = setup([() => json(cfg('v1')), () => new Response(null, { status: 304 })], 1000)
    await cache.get('ns', ORG)
    advance(1001)
    const again = await cache.get('ns', ORG)
    expect(again.version).toBe('v1')
    expect(headerOf(fetchMock, 1)).toBe('v1')
  })

  it('missed event: a changed version is picked up by the poll', async () => {
    const { cache, advance } = setup([() => json(cfg('v1')), () => json(cfg('v2'))], 1000)
    await cache.get('ns', ORG)
    advance(1001)
    expect((await cache.get('ns', ORG)).version).toBe('v2')
  })
})
