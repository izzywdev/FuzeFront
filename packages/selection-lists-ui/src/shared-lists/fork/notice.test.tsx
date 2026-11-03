import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  FORK_NOTICE_STATE_KEY,
  forkNoticeState,
  listRoute,
  readForkNotice,
  useForkNotice,
  withoutForkNotice,
} from './notice'
import { hasForkForbidden, markForkForbidden, resetForkSession } from './session'

describe('notice state', () => {
  it('round-trips a notice through location state', () => {
    expect(readForkNotice(forkNoticeState({ kind: 'created' }))).toEqual({
      kind: 'created',
    })
    expect(readForkNotice(forkNoticeState({ kind: 'existing' }))).toEqual({
      kind: 'existing',
    })
  })

  it('ignores anything that is not a known notice (fail-closed)', () => {
    for (const state of [
      null,
      undefined,
      'created',
      {},
      { [FORK_NOTICE_STATE_KEY]: null },
      { [FORK_NOTICE_STATE_KEY]: 'created' },
      { [FORK_NOTICE_STATE_KEY]: { kind: 'bogus' } },
    ])
      expect(readForkNotice(state)).toBeNull()
  })

  it('withoutForkNotice keeps unrelated keys and returns null when nothing is left', () => {
    expect(withoutForkNotice(forkNoticeState({ kind: 'created' }))).toBeNull()
    expect(
      withoutForkNotice({ ...forkNoticeState({ kind: 'created' }), from: '/x' })
    ).toEqual({ from: '/x' })
    expect(withoutForkNotice(null)).toBeNull()
    expect(withoutForkNotice('str')).toBeNull()
  })

  it('listRoute encodes the id under the host route', () => {
    expect(listRoute('front_sl_1')).toBe('/settings/selection-lists/front_sl_1')
    expect(listRoute('a/b')).toBe('/settings/selection-lists/a%2Fb')
  })
})

describe('useForkNotice', () => {
  function Probe() {
    const { notice, clear } = useForkNotice()
    const loc = useLocation()
    return (
      <>
        <output data-testid="kind">{notice?.kind ?? 'none'}</output>
        <output data-testid="url">{loc.pathname + loc.search + loc.hash}</output>
        <button onClick={clear}>clear</button>
      </>
    )
  }
  const renderAt = (state: unknown) =>
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/l/1', search: '?a=1', hash: '#h', state }]}
      >
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    )

  it('reads the carried notice and clears it in place (replace, same URL)', async () => {
    renderAt(forkNoticeState({ kind: 'existing' }))
    expect(screen.getByTestId('kind')).toHaveTextContent('existing')
    await act(async () => screen.getByText('clear').click())
    expect(screen.getByTestId('kind')).toHaveTextContent('none')
    expect(screen.getByTestId('url')).toHaveTextContent('/l/1?a=1#h')
  })

  it('no notice -> none', () => {
    renderAt(undefined)
    expect(screen.getByTestId('kind')).toHaveTextContent('none')
  })
})

describe('fork-forbidden session memory (keyed by organization)', () => {
  it('remembers a refusal for the rest of the session, per organization', () => {
    resetForkSession()
    expect(hasForkForbidden('org_a')).toBe(false)
    markForkForbidden('org_a')
    expect(hasForkForbidden('org_a')).toBe(true)
    expect(hasForkForbidden('org_b')).toBe(false)
    expect(hasForkForbidden(undefined)).toBe(false)
    markForkForbidden(undefined)
    expect(hasForkForbidden(undefined)).toBe(true)
    resetForkSession()
    expect(hasForkForbidden('org_a')).toBe(false)
  })
})
