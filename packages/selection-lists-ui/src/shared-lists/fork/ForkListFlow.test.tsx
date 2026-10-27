import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bodiesOf,
  callCount,
  errorResponse,
  renderFork,
  routeFetch,
  stubViewport,
} from '../../test/forkHarness'
import {
  COMMON_ID,
  FORK_ID,
  jsonResponse,
  makeCommonList,
  makeForkList,
  makeSharedList,
  page,
} from '../../test/sharedListsFixtures'
import { SharedListsFeatureProvider } from '../core'
import { CommonAccessGuard, ForkListFlow, isSharedByOthers } from './ForkListFlow'
import { resetForkSession } from './session'

const LISTS = '/api/v1/selection-lists'
const FORK_PATH = `${LISTS}/${COMMON_ID}/fork`
const common = makeCommonList({ name: 'Priority' })

const lookupCommon = () => jsonResponse(page([common]))
const forkCreated = () => jsonResponse(makeForkList(), 201)

beforeEach(() => {
  resetForkSession()
  stubViewport(true)
})
afterEach(() => vi.unstubAllGlobals())

const cta = () => document.querySelector<HTMLElement>('[data-action="fork-to-edit"]')
const dialog = () => document.querySelector<HTMLElement>('[data-dialog="fork"]')
const confirm = () => document.querySelector<HTMLButtonElement>('[data-action="confirm-fork"]')!
const path = () => screen.getByTestId('path').textContent

async function openDialog() {
  await waitFor(() => expect(cta()).not.toBeNull())
  await userEvent.click(cta()!)
  await waitFor(() => expect(dialog()).not.toBeNull())
}

describe('ForkListFlow — detail mode', () => {
  it('offers Fork only after the effective-list lookup returns THIS list, then forks and lands on the fork with the notice', async () => {
    const mock = routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: forkCreated,
    })
    renderFork(<ForkListFlow list={common} counts={{ active: 4, archived: 1 }} />)
    expect(cta()).toBeNull()
    await openDialog()
    expect(mock.mock.calls[0][0]).toContain('key=priority')
    expect(mock.mock.calls[0][0]).toContain('include_shared=true')
    await userEvent.click(confirm())
    await waitFor(() => expect(path()).toBe(`/settings/selection-lists/${FORK_ID}`))
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
      slForkNotice: { kind: 'created' },
    })
    expect(dialog()).toBeNull()
    expect(bodiesOf(mock, 'POST', FORK_PATH)).toEqual([{ visibility: 'org' }])
  })

  it('a 200 lands on the existing fork with the "existing" notice', async () => {
    routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: () => jsonResponse(makeForkList(), 200),
    })
    renderFork(<ForkListFlow list={common} />)
    await openDialog()
    await userEvent.click(confirm())
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('"kind":"existing"')
    )
  })

  it('never offers Fork when the org already uses its own version (shadowed)', async () => {
    const mock = routeFetch({
      [`GET ${LISTS}`]: () => jsonResponse(page([makeForkList()])),
    })
    renderFork(<ForkListFlow list={common} />)
    await waitFor(() => expect(mock).toHaveBeenCalled())
    await act(async () => undefined)
    expect(cta()).toBeNull()
  })

  it('a failed lookup shows no CTA (never on a guess)', async () => {
    const mock = routeFetch({ [`GET ${LISTS}`]: () => errorResponse(500, 'X') })
    renderFork(<ForkListFlow list={common} />)
    await waitFor(() => expect(mock).toHaveBeenCalled())
    await act(async () => undefined)
    expect(cta()).toBeNull()
  })

  it('uses the page\'s own lookup when given: no second request', async () => {
    const mock = routeFetch({})
    renderFork(
      <ForkListFlow list={common} effective={{ status: 'ready', list: common, source: { kind: 'common' } }} />
    )
    await waitFor(() => expect(cta()).not.toBeNull())
    expect(mock).not.toHaveBeenCalled()
  })

  it('an editable (or non-common) list asks nothing and offers nothing', async () => {
    const mock = routeFetch({})
    renderFork(<ForkListFlow list={makeSharedList()} />)
    await act(async () => undefined)
    expect(cta()).toBeNull()
    expect(mock).not.toHaveBeenCalled()
  })

  it('Escape closes the dialog without navigating or forking', async () => {
    const mock = routeFetch({ [`GET ${LISTS}`]: lookupCommon })
    renderFork(<ForkListFlow list={common} />, { at: '/settings/selection-lists/here' })
    await openDialog()
    await userEvent.keyboard('{Escape}')
    expect(dialog()).toBeNull()
    expect(path()).toBe('/settings/selection-lists/here')
    expect(callCount(mock, 'POST', FORK_PATH)).toBe(0)
    expect(cta()).toHaveFocus()
  })

  it('403 FORBIDDEN: after closing, the CTA is replaced by the explanation for the session', async () => {
    routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: () => errorResponse(403, 'FORBIDDEN'),
    })
    const first = renderFork(<ForkListFlow list={common} />)
    await openDialog()
    await userEvent.click(confirm())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'forbidden'))
    await userEvent.click(document.querySelector('[data-action="close"]')!)
    expect(dialog()).toBeNull()
    expect(cta()).toBeNull()
    expect(document.querySelector('[data-case="fork-no-create"]')).toBeVisible()
    first.unmount()
    // A remount in the same session still shows the explanation, with no new lookup need.
    renderFork(<ForkListFlow list={common} />)
    await waitFor(() =>
      expect(document.querySelector('[data-case="fork-no-create"]')).toBeVisible()
    )
    expect(cta()).toBeNull()
  })

  it('the refusal memory follows the ACTIVE organization when it changes while mounted', async () => {
    routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: () => errorResponse(403, 'FORBIDDEN'),
    })
    const tree = (orgId: string) => (
      <MemoryRouter>
        <SharedListsFeatureProvider sharedLists organizationId={orgId} organizationName={orgId}>
          <ForkListFlow list={common} />
        </SharedListsFeatureProvider>
      </MemoryRouter>
    )
    const { rerender } = render(tree('org_a'))
    await openDialog()
    await userEvent.click(confirm())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'forbidden'))
    await userEvent.click(document.querySelector('[data-action="close"]')!)
    expect(cta()).toBeNull()
    // org B never was refused: its CTA is offered again, in the SAME mounted flow.
    rerender(tree('org_b'))
    await waitFor(() => expect(cta()).not.toBeNull())
    // And back to org A: still refused.
    rerender(tree('org_a'))
    await waitFor(() => expect(cta()).toBeNull())
    expect(document.querySelector('[data-case="fork-no-create"]')).toBeVisible()
  })

  it('fork_not_applicable: closing tells the page to reload', async () => {
    routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: () => errorResponse(409, 'CONFLICT', { reason: 'fork_not_applicable' }),
    })
    const onStale = vi.fn()
    renderFork(<ForkListFlow list={common} onStale={onStale} />)
    await openDialog()
    await userEvent.click(confirm())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'fork_not_applicable'))
    expect(onStale).not.toHaveBeenCalled()
    await userEvent.click(document.querySelector('[data-action="close"]')!)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it('key taken: "Back to lists" navigates to the INDEX; Escape on the same refusal only dismisses', async () => {
    routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: () => errorResponse(409, 'CONFLICT'),
    })
    renderFork(<ForkListFlow list={common} />, { at: '/settings/selection-lists/here' })
    await openDialog()
    await userEvent.click(confirm())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'key-conflict'))
    await userEvent.keyboard('{Escape}')
    expect(dialog()).toBeNull()
    expect(path()).toBe('/settings/selection-lists/here')
    await userEvent.click(cta()!)
    await userEvent.click(confirm())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'key-conflict'))
    await userEvent.click(document.querySelector('[data-action="close"]')!)
    expect(path()).toBe('/settings/selection-lists')
    expect(dialog()).toBeNull()
  })

  it('source gone (404): "Back to lists" navigates to the index', async () => {
    routeFetch({
      [`GET ${LISTS}`]: lookupCommon,
      [`POST ${FORK_PATH}`]: () => errorResponse(404, 'NOT_FOUND'),
    })
    renderFork(<ForkListFlow list={common} />, { at: '/settings/selection-lists/here' })
    await openDialog()
    await userEvent.click(confirm())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'not-found'))
    await userEvent.click(document.querySelector('[data-action="close"]')!)
    expect(path()).toBe('/settings/selection-lists')
  })

  it('a host that keeps the component across :listId changes drops the open dialog', async () => {
    routeFetch({ [`GET ${LISTS}`]: lookupCommon })
    const tree = (list: typeof common) => (
      <MemoryRouter>
        <SharedListsFeatureProvider sharedLists organizationName="Globex">
          <ForkListFlow list={list} />
        </SharedListsFeatureProvider>
      </MemoryRouter>
    )
    const { rerender } = render(tree(common))
    await openDialog()
    await act(async () => {
      rerender(tree(makeCommonList({ id: 'front_sl_other', key: 'other', name: 'Other' })))
    })
    expect(dialog()).toBeNull()
  })

  it('flag OFF renders only the fallback and never looks anything up', async () => {
    const mock = routeFetch({})
    renderFork(<ForkListFlow list={common} fallback={<p>fallback</p>} />, { flag: false })
    expect(screen.getByText('fallback')).toBeVisible()
    expect(mock).not.toHaveBeenCalled()
  })

  it('nothing to say renders the fallback (or nothing)', () => {
    routeFetch({})
    const a = renderFork(<ForkListFlow fallback={<p>fb</p>} />)
    expect(screen.getByText('fb')).toBeVisible()
    a.unmount()
    const b = renderFork(<ForkListFlow />)
    expect(b.container.querySelector('[data-action]')).toBeNull()
  })
})

describe('ForkListFlow — refusal mode', () => {
  const forkRequired = (sourceListId = COMMON_ID) =>
    ({ kind: 'fork_required', sourceListId, forkUrl: `/v1/selection-lists/${sourceListId}/fork` }) as const

  it('fork_required: banner -> dialog forks the list the SERVICE named, even when the page URL id differs', async () => {
    const OTHER = 'front_sl_01jother0000000000000000'
    const other = makeCommonList({ id: OTHER, name: 'Other list', key: 'other' })
    const mock = routeFetch({
      [`GET ${LISTS}/${OTHER}`]: () => jsonResponse(other),
      [`POST ${LISTS}/${OTHER}/fork`]: forkCreated,
    })
    const onBack = vi.fn()
    renderFork(
      <ForkListFlow refusal={forkRequired(OTHER)} listId="front_sl_page" list={common} onBack={onBack} />
    )
    const banner = document.querySelector('[data-reason="fork_required"]')!
    expect(banner).toBeVisible()
    expect(banner).not.toHaveTextContent('“Priority”')
    await userEvent.click(cta()!)
    await waitFor(() => expect(dialog()).toHaveTextContent('Other list'))
    await userEvent.click(confirm())
    await waitFor(() => expect(path()).toBe(`/settings/selection-lists/${FORK_ID}`))
    expect(callCount(mock, 'POST', `${LISTS}/${OTHER}/fork`)).toBe(1)
    expect(callCount(mock, 'POST', FORK_PATH)).toBe(0)
  })

  it('uses the list on screen when it is the source (no read), naming it in the banner', async () => {
    const mock = routeFetch({})
    renderFork(<ForkListFlow refusal={forkRequired()} list={common} />)
    expect(document.querySelector('[data-reason="fork_required"]')).toHaveTextContent('“Priority”')
    await userEvent.click(cta()!)
    expect(dialog()).toHaveTextContent('Fork “Priority”')
    expect(callCount(mock, 'GET', `${LISTS}/${COMMON_ID}`)).toBe(0)
  })

  it('Back to the list reports to the caller', async () => {
    routeFetch({})
    const onBack = vi.fn()
    renderFork(<ForkListFlow refusal={forkRequired()} list={common} onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('a source that cannot be read still forks by id, with generic wording', async () => {
    const mock = routeFetch({
      [`GET ${LISTS}/${COMMON_ID}`]: () => errorResponse(500, 'X'),
      [`POST ${FORK_PATH}`]: forkCreated,
    })
    renderFork(<ForkListFlow refusal={forkRequired()} />)
    await userEvent.click(cta()!)
    expect(dialog()).toHaveTextContent('Fork this list for Globex Freight')
    await userEvent.click(confirm())
    await waitFor(() => expect(callCount(mock, 'POST', FORK_PATH)).toBe(1))
  })

  it('forbidden on a COMMON list: the explanation, no Fork CTA', async () => {
    routeFetch({})
    renderFork(
      <ForkListFlow refusal={{ kind: 'forbidden' }} list={common} fallback={<p>plain 403</p>} />
    )
    expect(document.querySelector('[data-case="common-no-create"]')).toBeVisible()
    expect(screen.queryByText('plain 403')).toBeNull()
    expect(cta()).toBeNull()
  })

  it('forbidden on the caller\'s OWN list keeps the caller\'s 4.0.0 message', async () => {
    routeFetch({})
    renderFork(
      <ForkListFlow
        refusal={{ kind: 'forbidden' }}
        list={makeSharedList({ organization_id: 'org_globex', visibility: 'org' })}
        fallback={<p>plain 403</p>}
      />
    )
    expect(screen.getByText('plain 403')).toBeVisible()
    expect(document.querySelector('[data-case="common-no-create"]')).toBeNull()
  })

  it('forbidden with only a list id: reads the list, shows the fallback meanwhile', async () => {
    const mock = routeFetch({ [`GET ${LISTS}/${COMMON_ID}`]: () => jsonResponse(common) })
    renderFork(
      <ForkListFlow refusal={{ kind: 'forbidden' }} listId={COMMON_ID} fallback={<p>plain 403</p>} />
    )
    expect(screen.getByText('plain 403')).toBeVisible()
    await waitFor(() =>
      expect(document.querySelector('[data-case="common-no-create"]')).toBeVisible()
    )
    expect(callCount(mock, 'GET', `${LISTS}/${COMMON_ID}`)).toBe(1)
  })

  it('forbidden with no list at all is the fallback', () => {
    routeFetch({})
    renderFork(<ForkListFlow refusal={{ kind: 'forbidden' }} fallback={<p>plain 403</p>} />)
    expect(screen.getByText('plain 403')).toBeVisible()
  })

  it('not_found: "List not found"', () => {
    routeFetch({})
    renderFork(<ForkListFlow refusal={{ kind: 'not_found' }} />)
    expect(document.querySelector('[data-error="NOT_FOUND"]')).toHaveTextContent('List not found')
  })

  it('any other failure is the caller\'s own handling (fallback)', () => {
    routeFetch({})
    renderFork(
      <ForkListFlow refusal={{ kind: 'conflict', reason: undefined }} fallback={<p>ordinary conflict</p>} />
    )
    expect(screen.getByText('ordinary conflict')).toBeVisible()
  })

  it('flag OFF: even fork_required renders only the fallback', () => {
    routeFetch({})
    renderFork(<ForkListFlow refusal={forkRequired()} list={common} fallback={<p>4.0.0</p>} />, {
      flag: false,
    })
    expect(screen.getByText('4.0.0')).toBeVisible()
    expect(cta()).toBeNull()
  })
})

describe('CommonAccessGuard (frame 04: access management of a common list)', () => {
  it('a common list: "managed by the platform"', async () => {
    routeFetch({ [`GET ${LISTS}/${COMMON_ID}`]: () => jsonResponse(common) })
    renderFork(<CommonAccessGuard listId={COMMON_ID} fallback={<p>load failed</p>} />)
    expect(screen.getByText('load failed')).toBeVisible()
    await waitFor(() =>
      expect(document.querySelector('[data-case="common-access"]')).toHaveTextContent(
        /managed by the platform/i
      )
    )
  })

  it('a list the org owns keeps the caller\'s error; a loaded list is not re-read', async () => {
    const mock = routeFetch({})
    renderFork(
      <CommonAccessGuard
        listId={FORK_ID}
        list={makeSharedList({ organization_id: 'org_globex' })}
        fallback={<p>load failed</p>}
      />
    )
    expect(screen.getByText('load failed')).toBeVisible()
    expect(mock).not.toHaveBeenCalled()
  })

  it('flag OFF: the fallback, no read', () => {
    const mock = routeFetch({})
    renderFork(<CommonAccessGuard listId={COMMON_ID} fallback={<p>load failed</p>} />, { flag: false })
    expect(screen.getByText('load failed')).toBeVisible()
    expect(mock).not.toHaveBeenCalled()
  })

  it('no fallback renders nothing', () => {
    routeFetch({})
    const { container } = renderFork(<CommonAccessGuard listId={COMMON_ID} />, { flag: false })
    expect(container.querySelector('[data-case]')).toBeNull()
  })
})

describe('isSharedByOthers', () => {
  it('a common list always; otherwise another organization\'s list when the host knows its own', () => {
    expect(isSharedByOthers(common, undefined)).toBe(true)
    const own = makeSharedList({ organization_id: 'org_a', visibility: undefined })
    expect(isSharedByOthers(own, 'org_a')).toBe(false)
    expect(isSharedByOthers(own, 'org_b')).toBe(true)
    expect(isSharedByOthers(own, undefined)).toBe(false)
  })
})
