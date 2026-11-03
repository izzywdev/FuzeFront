import { describe, expect, it } from 'vitest'
import type { StoredValueOutcome } from '../core/types'
import { storedStatesFor } from './storedStates'

const resolved = (
  id: string,
  over: Partial<Extract<StoredValueOutcome, { kind: 'resolved' }>> = {}
): StoredValueOutcome => ({
  kind: 'resolved',
  id,
  label: `label-${id}`,
  locale: 'en',
  isMachine: false,
  status: 'active',
  effectiveItemId: null,
  ...over,
})

const none = new Set<string>()

describe('storedStatesFor (frame 10 — every resolve outcome)', () => {
  it('missing: kept as "Unknown value"', () => {
    expect(
      storedStatesFor(['a'], { a: { kind: 'missing', id: 'a' } }, none)
    ).toEqual([{ kind: 'missing', id: 'a' }])
  })

  it('missing from the resolve but offered by the effective list: a current value, not "Unknown"', () => {
    expect(
      storedStatesFor(['a'], { a: { kind: 'missing', id: 'a' } }, new Set(['a']))
    ).toEqual([])
  })

  it('redirected: the fork label, the effective id, no archived state', () => {
    expect(
      storedStatesFor(
        ['a'],
        { a: resolved('a', { label: 'Medium', effectiveItemId: 'f' }) },
        none
      )
    ).toEqual([
      {
        kind: 'redirected',
        id: 'a',
        label: 'Medium',
        locale: 'en',
        status: 'active',
        effectiveId: 'f',
      },
    ])
  })

  it('common-archived-redirect: the FORK item\'s status (active) wins — still redirected', () => {
    const [state] = storedStatesFor(
      ['a'],
      { a: resolved('a', { effectiveItemId: 'f', status: 'active' }) },
      none
    )
    expect(state.kind).toBe('redirected')
  })

  it('a redirect to an archived fork item is archived AND remembers the redirect', () => {
    const [state] = storedStatesFor(
      ['a'],
      { a: resolved('a', { effectiveItemId: 'f', status: 'archived' }) },
      none
    )
    expect(state).toMatchObject({ kind: 'archived', effectiveId: 'f' })
  })

  it('archived without a redirect: greyed, read but not newly selectable', () => {
    const [state] = storedStatesFor(
      ['a'],
      { a: resolved('a', { status: 'archived' }) },
      none
    )
    expect(state).toMatchObject({ kind: 'archived', id: 'a' })
    expect(state).not.toHaveProperty('effectiveId')
  })

  it('an active id the effective list does not offer is "foreign": its own label as-is', () => {
    expect(
      storedStatesFor(['a'], { a: resolved('a', { label: 'Normal' }) }, none)
    ).toEqual([
      { kind: 'foreign', id: 'a', label: 'Normal', locale: 'en', status: 'active' },
    ])
  })

  it('an active id the effective list offers itself needs no stored state', () => {
    expect(
      storedStatesFor(['a'], { a: resolved('a') }, new Set(['a']))
    ).toEqual([])
  })

  it('an effective id equal to the stored id is not a redirect', () => {
    expect(
      storedStatesFor(
        ['a'],
        { a: resolved('a', { effectiveItemId: 'a' }) },
        new Set(['a'])
      )
    ).toEqual([])
  })

  it('ids with no outcome yet (still resolving) are skipped; order follows the selection', () => {
    const states = storedStatesFor(
      ['x', 'b', 'a'],
      {
        a: { kind: 'missing', id: 'a' },
        b: { kind: 'missing', id: 'b' },
      },
      none
    )
    expect(states.map(s => s.id)).toEqual(['b', 'a'])
  })
})
