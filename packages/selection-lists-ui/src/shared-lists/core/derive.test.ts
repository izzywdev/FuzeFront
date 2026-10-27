import { describe, expect, it } from 'vitest'
import {
  appendUnique,
  canOfferPlatformPublish,
  createdByKind,
  editableStateOf,
  effectiveSourceOf,
  forkCtaFor,
  forkedKeysOf,
  forkProvenanceOf,
  groupBySource,
  groupingApplies,
  isCommonList,
  isFork,
  isSameOriginPath,
  redirectsOf,
  toListParams,
  visibilityOf,
} from './derive'
import type { EffectiveLookup, SharedList, StoredValueOutcome } from './types'
import {
  makeCommonList,
  makeForkList,
  makeSharedList,
} from '../../test/sharedListsFixtures'

/** A 4.0.0-behaviour list: none of the 4.1.0 optional fields is present. */
function legacyList(): SharedList {
  const list = makeSharedList()
  delete list.visibility
  delete list.forked_from
  delete list.editable
  return list
}

describe('absent 4.1.0 fields have defined meanings', () => {
  it('visibility absent = private', () => {
    expect(visibilityOf(legacyList())).toBe('private')
    expect(visibilityOf(makeSharedList({ visibility: 'org' }))).toBe('org')
    expect(visibilityOf(makeCommonList())).toBe('platform')
  })

  it('forked_from absent = null (not a fork)', () => {
    expect(forkProvenanceOf(legacyList())).toBeNull()
    expect(isFork(legacyList())).toBe(false)
    expect(isFork(makeSharedList({ forked_from: null }))).toBe(false)
    expect(isFork(makeForkList())).toBe(true)
  })

  it('editable is three-valued: absent is unknown, never read-only', () => {
    expect(editableStateOf(legacyList())).toBe('unknown')
    expect(editableStateOf(makeSharedList({ editable: true }))).toBe('editable')
    expect(editableStateOf(makeSharedList({ editable: false }))).toBe(
      'read-only'
    )
  })

  it('a common list is exactly visibility = platform', () => {
    expect(isCommonList(makeCommonList())).toBe(true)
    expect(isCommonList(makeSharedList({ visibility: 'org' }))).toBe(false)
    expect(isCommonList(legacyList())).toBe(false)
  })
})

describe('createdByKind (offline, by prefix — never a lookup)', () => {
  it('classifies a user, a system principal and the deleted-user sentinel', () => {
    expect(createdByKind('usr_01jf00000000000000000000d1')).toBe('user')
    expect(createdByKind('system:selection-list-service')).toBe('system')
    expect(createdByKind('[deleted-user]')).toBe('deleted-user')
  })

  it('reports anything else as unknown', () => {
    expect(createdByKind('someone@example.com')).toBe('unknown')
    expect(createdByKind('')).toBe('unknown')
  })
})

describe('toListParams (frame 01 request rules)', () => {
  it('flag OFF sends neither include_shared nor visibility, whatever the controls hold', () => {
    expect(
      toListParams(
        { status: 'active', includeShared: true, visibility: 'platform' },
        false
      )
    ).toEqual({ status: 'active' })
  })

  it('switch OFF sends neither, and drops a visibility filter left in the controls', () => {
    expect(
      toListParams(
        { status: 'active', includeShared: false, visibility: 'org' },
        true
      )
    ).toEqual({ status: 'active' })
    expect(toListParams({ visibility: 'org' }, true)).toEqual({})
  })

  it('switch ON with filter "any" sends include_shared only', () => {
    expect(
      toListParams({ includeShared: true, visibility: 'any' }, true)
    ).toEqual({
      include_shared: true,
    })
    expect(toListParams({ includeShared: true }, true)).toEqual({
      include_shared: true,
    })
  })

  it.each(['private', 'org', 'platform'] as const)(
    'a %s filter always travels with include_shared=true',
    visibility => {
      expect(toListParams({ includeShared: true, visibility }, true)).toEqual({
        include_shared: true,
        visibility,
      })
    }
  )

  it('passes status, cursor, key, locale and limit through; omits empty ones', () => {
    expect(
      toListParams(
        {
          status: 'all',
          cursor: 'c1',
          key: 'priority',
          locale: 'fr',
          limit: 1,
        },
        true
      )
    ).toEqual({
      status: 'all',
      cursor: 'c1',
      key: 'priority',
      locale: 'fr',
      limit: 1,
    })
    expect(
      toListParams({ cursor: null, key: '', locale: undefined }, true)
    ).toEqual({})
  })
})

describe('grouping', () => {
  it('applies only with the flag ON, the switch ON and no visibility filter', () => {
    expect(groupingApplies({ includeShared: true }, true)).toBe(true)
    expect(
      groupingApplies({ includeShared: true, visibility: 'any' }, true)
    ).toBe(true)
    expect(
      groupingApplies({ includeShared: true, visibility: 'platform' }, true)
    ).toBe(false)
    expect(groupingApplies({ includeShared: false }, true)).toBe(false)
    expect(groupingApplies({ includeShared: true }, false)).toBe(false)
  })

  it('splits rows into your organization / common lists, keeping the service order', () => {
    const a = makeSharedList({ id: 'a', visibility: 'org' })
    const b = makeCommonList({ id: 'b' })
    const c = makeSharedList({ id: 'c', visibility: 'private' })
    const d = makeCommonList({ id: 'd' })
    const groups = groupBySource([a, b, c, d])
    expect(groups.own.map(l => l.id)).toEqual(['a', 'c'])
    expect(groups.common.map(l => l.id)).toEqual(['b', 'd'])
  })

  it('forkedKeysOf lists each forked key once (source-neutral shadow note)', () => {
    const rows = [
      makeForkList({ id: 'f1', key: 'priority' }),
      makeSharedList({ id: 'x', key: 'warehouse-zones' }),
      makeForkList({ id: 'f2', key: 'priority' }),
      makeForkList({ id: 'f3', key: 'status' }),
    ]
    expect(forkedKeysOf(rows)).toEqual(['priority', 'status'])
    expect(forkedKeysOf([])).toEqual([])
  })

  it('appendUnique drops rows already loaded (a concurrent upsert can repeat one)', () => {
    const a = makeSharedList({ id: 'a' })
    const b = makeSharedList({ id: 'b' })
    const c = makeSharedList({ id: 'c' })
    expect(appendUnique([a, b], [b, c, c]).map(l => l.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(appendUnique([], [a]).map(l => l.id)).toEqual(['a'])
  })
})

describe('forkCtaFor (frames 02, 03, 06)', () => {
  const common = makeCommonList()
  const own = makeForkList()
  const lookup = (over: EffectiveLookup): EffectiveLookup => over
  const base = { list: common, sharedLists: true }

  it('is hidden with the flag OFF', () => {
    expect(
      forkCtaFor({
        ...base,
        sharedLists: false,
        effective: lookup({ status: 'ready', list: common, source: null }),
      })
    ).toEqual({ kind: 'hidden', reason: 'flag-off' })
  })

  it('is hidden on a list that is not common', () => {
    expect(
      forkCtaFor({
        ...base,
        list: makeSharedList({ visibility: 'org', editable: false }),
        effective: lookup({ status: 'idle' }),
      })
    ).toEqual({ kind: 'hidden', reason: 'not-common' })
  })

  it('is hidden unless the service said editable = false (absent is unknown, true is editable)', () => {
    const unknown = makeCommonList()
    delete unknown.editable
    expect(
      forkCtaFor({
        ...base,
        list: unknown,
        effective: lookup({ status: 'idle' }),
      })
    ).toEqual({
      kind: 'hidden',
      reason: 'not-read-only',
    })
    expect(
      forkCtaFor({
        ...base,
        list: makeCommonList({ editable: true }),
        effective: lookup({ status: 'idle' }),
      })
    ).toEqual({ kind: 'hidden', reason: 'not-read-only' })
  })

  it('waits for the effective-list answer rather than guess', () => {
    expect(
      forkCtaFor({ ...base, effective: lookup({ status: 'idle' }) })
    ).toEqual({ kind: 'pending' })
    expect(
      forkCtaFor({ ...base, effective: lookup({ status: 'loading' }) })
    ).toEqual({ kind: 'pending' })
  })

  it('offers no CTA when the lookup failed', () => {
    expect(
      forkCtaFor({
        ...base,
        effective: lookup({
          status: 'error',
          error: { kind: 'unknown', status: 500, network: false },
        }),
      })
    ).toEqual({ kind: 'lookup-failed' })
  })

  it('offers the CTA when this common list IS the effective list for its key', () => {
    expect(
      forkCtaFor({
        ...base,
        effective: lookup({
          status: 'ready',
          list: common,
          source: { kind: 'common' },
        }),
      })
    ).toEqual({ kind: 'offer' })
  })

  it("points to the org's own version when the effective list is a different one", () => {
    expect(
      forkCtaFor({
        ...base,
        effective: lookup({ status: 'ready', list: own, source: null }),
      })
    ).toEqual({ kind: 'shadowed', ownVersion: own })
  })

  it('offers nothing when no list is effective for the key (e.g. this common list is archived)', () => {
    expect(
      forkCtaFor({ ...base, effective: lookup({ status: 'none' }) })
    ).toEqual({
      kind: 'hidden',
      reason: 'not-effective',
    })
  })

  it('replaces the CTA with the explanation after a 403 for the rest of the session', () => {
    expect(
      forkCtaFor({
        ...base,
        forkForbidden: true,
        effective: lookup({
          status: 'ready',
          list: common,
          source: { kind: 'common' },
        }),
      })
    ).toEqual({ kind: 'forbidden' })
  })
})

describe('effectiveSourceOf (picker caption source, from the one list returned)', () => {
  it('a platform list is common', () => {
    expect(effectiveSourceOf(makeCommonList())).toEqual({ kind: 'common' })
  })

  it('an org-visible fork is a fork; a private fork is a draft', () => {
    const fork = makeForkList({ visibility: 'org' })
    expect(effectiveSourceOf(fork)).toEqual({
      kind: 'fork',
      forkedFrom: fork.forked_from,
    })
    const draft = makeForkList({ visibility: 'private' })
    expect(effectiveSourceOf(draft)).toEqual({
      kind: 'draft-fork',
      forkedFrom: draft.forked_from,
    })
  })

  it('an ordinary org list (or a 4.0.0 list) is own', () => {
    expect(effectiveSourceOf(makeSharedList())).toEqual({ kind: 'own' })
    expect(effectiveSourceOf(legacyList())).toEqual({ kind: 'own' })
  })
})

describe('redirectsOf (frame 10)', () => {
  const resolved = (
    id: string,
    effectiveItemId: string | null
  ): StoredValueOutcome => ({
    kind: 'resolved',
    id,
    label: 'x',
    locale: 'en',
    isMachine: false,
    status: 'active',
    effectiveItemId,
  })

  it('lists only items redirected to a DIFFERENT id', () => {
    expect(
      redirectsOf({
        a: resolved('a', 'a-fork'),
        b: resolved('b', null),
        c: resolved('c', 'c'),
        d: { kind: 'missing', id: 'd' },
      })
    ).toEqual([{ stored: 'a', effective: 'a-fork' }])
  })

  it('is empty for nothing resolved', () => {
    expect(redirectsOf({})).toEqual([])
  })
})

describe('canOfferPlatformPublish (frame 08)', () => {
  const org = makeSharedList({ visibility: 'org' })
  it('only for a platform operator org, on a list that is not already common, flag ON', () => {
    expect(
      canOfferPlatformPublish({
        sharedLists: true,
        isPlatformOrg: true,
        list: org,
      })
    ).toBe(true)
    expect(
      canOfferPlatformPublish({
        sharedLists: false,
        isPlatformOrg: true,
        list: org,
      })
    ).toBe(false)
    expect(
      canOfferPlatformPublish({
        sharedLists: true,
        isPlatformOrg: false,
        list: org,
      })
    ).toBe(false)
    expect(
      canOfferPlatformPublish({
        sharedLists: true,
        isPlatformOrg: true,
        list: makeCommonList(),
      })
    ).toBe(false)
  })
})

describe('isSameOriginPath', () => {
  it('accepts a path rooted at the same origin', () => {
    expect(isSameOriginPath('/v1/selection-lists/front_sl_x/fork')).toBe(true)
  })

  it.each([
    'https://evil.example/v1/fork',
    'http://x',
    '//evil.example/v1/fork',
    '/\\evil.example',
    'v1/selection-lists',
    '',
    undefined,
    null,
    42,
  ])('rejects %s', value => {
    expect(isSameOriginPath(value)).toBe(false)
  })
})
