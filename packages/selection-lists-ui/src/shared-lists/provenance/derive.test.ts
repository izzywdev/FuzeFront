import { describe, expect, it } from 'vitest'
import {
  behindStateOf,
  originItemIdOf,
  originLabelOf,
  revertGateOf,
  sourceKeyChangedOf,
  sourceRevisionOf,
  type BehindState,
} from './derive'
import { makeCommonList } from '../../test/sharedListsFixtures'

const recorded = {
  list_id: 'front_sl_x',
  organization_id: 'org_platform',
  revision: 7,
  forked_at: '2026-09-02T09:14:00Z',
}
const withRevision = (revision: unknown, over = {}) =>
  ({ ...makeCommonList(over), revision }) as ReturnType<typeof makeCommonList>

describe('sourceRevisionOf (SelectionList.revision, contract 4.2.0)', () => {
  it('is null when the service does not send it (4.1.x) - never inferred from updated_at', () => {
    expect(sourceRevisionOf(makeCommonList({ updated_at: '2026-10-01T00:00:00Z' }))).toBeNull()
  })
  it('reads an integer >= 1', () => {
    expect(sourceRevisionOf(withRevision(9))).toBe(9)
    expect(sourceRevisionOf(withRevision(1))).toBe(1)
  })
  it.each([0, -3, 2.5, '9', null, NaN])('rejects %j as comparison unavailable', bad => {
    expect(sourceRevisionOf(withRevision(bad))).toBeNull()
  })
})

describe('behindStateOf (frame 07, every state)', () => {
  it('loading is checking', () => {
    expect(behindStateOf(recorded, { phase: 'loading' })).toBe('checking')
  })
  it('404 is source-gone', () => {
    expect(behindStateOf(recorded, { phase: 'not_found' })).toBe('source-gone')
  })
  it('a failed read is error', () => {
    expect(behindStateOf(recorded, { phase: 'error' })).toBe('error')
  })
  it('an archived source is source-archived, whatever its revision says', () => {
    expect(
      behindStateOf(recorded, { phase: 'ready', list: withRevision(9, { status: 'archived' }) })
    ).toBe('source-archived')
  })
  it('a source with no revision is unknown (comparison unavailable)', () => {
    expect(behindStateOf(recorded, { phase: 'ready', list: makeCommonList() })).toBe('unknown')
  })
  it('greater is behind; equal is up-to-date', () => {
    expect(behindStateOf(recorded, { phase: 'ready', list: withRevision(9) })).toBe('behind')
    expect(behindStateOf(recorded, { phase: 'ready', list: withRevision(7) })).toBe('up-to-date')
  })
  it('a source BEHIND the copy cannot be compared - no direction is claimed', () => {
    expect(behindStateOf(recorded, { phase: 'ready', list: withRevision(5) })).toBe('unknown')
  })
})

describe('revertGateOf (frame 07, "Header action by provenance state")', () => {
  const cases: Array<[BehindState, string]> = [
    ['behind', 'source-active'],
    ['up-to-date', 'source-active'],
    ['unknown', 'source-active'],
    ['source-archived', 'source-unavailable'],
    ['source-gone', 'source-unavailable'],
    ['checking', 'source-unknown'],
    ['error', 'source-unknown'],
  ]
  it.each(cases)('%s -> %s', (state, gate) => {
    expect(revertGateOf(state)).toBe(gate)
  })
})

describe('source key changed (forms resolve by KEY, not by forked_from.list_id)', () => {
  it('an active source whose key differs no longer promises a revert', () => {
    expect(revertGateOf('unknown', true)).toBe('source-unavailable')
    expect(revertGateOf('behind', true)).toBe('source-unavailable')
    expect(revertGateOf('up-to-date', true)).toBe('source-unavailable')
  })
  it('the key flag changes nothing else', () => {
    expect(revertGateOf('unknown', false)).toBe('source-active')
    expect(revertGateOf('checking', true)).toBe('source-unknown')
    expect(revertGateOf('source-gone', true)).toBe('source-unavailable')
  })
  it('sourceKeyChangedOf is true only when the source answered with another key', () => {
    const list = makeCommonList({ key: 'priority' })
    expect(sourceKeyChangedOf('priority', { phase: 'ready', list })).toBe(false)
    expect(sourceKeyChangedOf('urgency', { phase: 'ready', list })).toBe(true)
    expect(sourceKeyChangedOf('urgency', { phase: 'not_found' })).toBe(false)
    expect(sourceKeyChangedOf('urgency', { phase: 'loading' })).toBe(false)
  })
})

describe('"Copied from"', () => {
  it('originItemIdOf: a string id, or null for null / absent / empty / non-string', () => {
    expect(originItemIdOf({ origin_item_id: 'front_sli_a' })).toBe('front_sli_a')
    expect(originItemIdOf({ origin_item_id: null })).toBeNull()
    expect(originItemIdOf({})).toBeNull()
    expect(originItemIdOf({ origin_item_id: '' })).toBeNull()
    expect(originItemIdOf({ origin_item_id: 4 })).toBeNull()
    expect(originItemIdOf(null)).toBeNull()
  })
  it('null origin = added in the fork', () => {
    expect(originLabelOf(null, new Map())).toEqual({ kind: 'added' })
  })
  it('names the COMMON item label (the fork may have relabelled it)', () => {
    expect(originLabelOf('a', new Map([['a', 'Normal']]))).toEqual({ kind: 'common', label: 'Normal' })
  })
  it('says copied, with no label, when the source items are unavailable or lack the origin', () => {
    expect(originLabelOf('a', null)).toEqual({ kind: 'copied' })
    expect(originLabelOf('a', new Map([['b', 'x']]))).toEqual({ kind: 'copied' })
  })
})
