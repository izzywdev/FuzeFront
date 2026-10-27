import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  errorResponse,
  renderFork,
  routeFetch,
} from '../../test/forkHarness'
import { deferred } from '../../test/helpers'
import {
  FORK_ID,
  jsonResponse,
  makeForkList,
} from '../../test/sharedListsFixtures'
import { withSharedLists } from '../../test/sharedListsWrapper'
import { ForkResultNotice } from './ForkResultNotice'
import { forkNoticeState } from './notice'

afterEach(() => vi.unstubAllGlobals())

const PATCH = `PATCH /api/v1/selection-lists/${FORK_ID}`
const archived = (over = {}) =>
  makeForkList({ status: 'archived', name: 'Priority', ...over })

function setup(
  list = makeForkList({ name: 'Priority' }),
  kind: 'created' | 'existing' | null = 'created',
  props: Partial<React.ComponentProps<typeof ForkResultNotice>> = {}
) {
  const onRestored = vi.fn()
  const onDismiss = vi.fn()
  const utils = renderFork(
    <ForkResultNotice
      list={list}
      notice={kind ? { kind } : null}
      onRestored={onRestored}
      onDismiss={onDismiss}
      {...props}
    />
  )
  return { ...utils, onRestored, onDismiss }
}

describe('201 created (frame 06)', () => {
  it('shows the success toast as a status naming the org and the list', () => {
    setup()
    const toast = document.querySelector('[data-toast="forked"][data-result="created"]')!
    expect(toast).toHaveAttribute('role', 'status')
    expect(toast).toHaveTextContent('Forked.')
    expect(toast).toHaveTextContent(
      'Globex Freight now uses its own Priority in every form. You’re its owner.'
    )
    expect(toast).not.toHaveTextContent(/up to date/i)
  })

  it('a private fork gets the draft variant', () => {
    setup(makeForkList({ visibility: 'private', name: 'Priority' }))
    const toast = document.querySelector('[data-result="created-private"]')!
    expect(toast).toHaveTextContent('Draft fork created.')
    expect(toast).toHaveTextContent(/set it to Organization/)
  })

  it('dismissing hides it and clears the carried state', async () => {
    const { onDismiss } = setup()
    await userEvent.click(screen.getByRole('button'))
    expect(document.querySelector('[data-toast]')).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('200 existing (frame 06)', () => {
  it('is an INFO status, not an error, with the date the fork was made', () => {
    setup(makeForkList({ name: 'Priority' }), 'existing')
    const note = document.querySelector('[data-result="existing"]')!
    expect(note).toHaveAttribute('role', 'status')
    expect(note).toHaveTextContent('You’re on your organization’s existing version')
    expect(note).toHaveTextContent('already had a fork of Priority (made Sep 2)')
    expect(document.querySelector('[data-error]')).toBeNull()
  })

  it('omits the date when the fork has no usable timestamp', () => {
    setup(
      makeForkList({ name: 'Priority', forked_from: null, created_at: 'garbage' }),
      'existing'
    )
    expect(document.querySelector('[data-result="existing"]')).not.toHaveTextContent('made')
  })
})

describe('200 existing, archived -> Restore', () => {
  it('warns and offers "Restore your version" only when the fork is editable', () => {
    setup(archived(), 'existing')
    const note = document.querySelector('[data-result="existing-archived"]')!
    expect(note).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Restore your version' })).toBeEnabled()
  })

  it.each([{ editable: false }, { editable: undefined }])(
    'no Restore when editable is %j',
    over => {
      setup(archived(over), 'existing')
      expect(document.querySelector('[data-result="existing-archived"]')).toBeVisible()
      expect(document.querySelector('[data-action="restore-fork"]')).toBeNull()
    }
  )

  it('while restoring the button carries native disabled; success removes the notice and reports the list', async () => {
    const gate = deferred<Response>()
    const mock = routeFetch({ [PATCH]: () => gate.promise })
    const { onRestored, onDismiss } = setup(archived(), 'existing')
    await userEvent.click(document.querySelector('[data-action="restore-fork"]')!)
    const wrapper = document.querySelector('[data-state="restoring"]')!
    expect(wrapper).toHaveAttribute('aria-busy', 'true')
    const btn = wrapper.querySelector<HTMLButtonElement>('[data-action="restore-fork"]')!
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Restoring…')
    btn.click()
    expect(mock).toHaveBeenCalledTimes(1)
    const active = makeForkList({ status: 'active' })
    await act(async () => gate.resolve(jsonResponse(active, 200)))
    await waitFor(() => expect(document.querySelector('[data-action="restore-fork"]')).toBeNull())
    expect(JSON.parse(mock.mock.calls[0][1]!.body as string)).toEqual({ status: 'active' })
    expect(onRestored).toHaveBeenCalledWith(active)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('leaving while Restore is pending lets the write finish but never touches the router afterwards', async () => {
    const gate = deferred<Response>()
    const mock = routeFetch({ [PATCH]: () => gate.promise })
    const { onRestored, onDismiss, unmount } = setup(archived(), 'existing')
    await userEvent.click(document.querySelector('[data-action="restore-fork"]')!)
    unmount()
    await act(async () => gate.resolve(jsonResponse(makeForkList({ status: 'active' }), 200)))
    expect(mock).toHaveBeenCalledTimes(1)
    expect(onRestored).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  const REFUSALS = [
    ['org_lists', errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'org_lists', limit: 100, current: 100 }), '[data-case="restore-quota"][data-error="QUOTA_EXCEEDED"][data-quota-scope="org_lists"]', /100 of 100/],
    ['user_lists', errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'user_lists', limit: 25, current: 25 }), '[data-case="restore-quota"][data-quota-scope="user_lists"]', /25 of 25/],
    ['unknown scope', errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'x', limit: 1, current: 1 }), '[data-case="restore-quota"]', /a limit was reached/i],
    ['FORBIDDEN', errorResponse(403, 'FORBIDDEN'), '[data-case="restore-forbidden"][data-error="FORBIDDEN"]', /permission/],
    ['not found', errorResponse(404, 'NOT_FOUND'), '[data-case="restore-failed"]', /couldn.t restore/],
  ] as const
  for (const [name, reply, sel, text] of REFUSALS) {
    it(`refused (${name}): branched on code, the fork stays archived and Restore stays offered`, async () => {
      routeFetch({ [PATCH]: () => reply })
      const { onRestored } = setup(archived(), 'existing')
      await userEvent.click(document.querySelector('[data-action="restore-fork"]')!)
      const alert = await waitFor(() => {
        const el = document.querySelector(sel)
        expect(el).not.toBeNull()
        return el as HTMLElement
      })
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveTextContent(text)
      if (name === 'user_lists')
        expect(alert).not.toHaveTextContent(/\byou('ve|r)?\b/i)
      expect(document.querySelector('[data-action="restore-fork"]')).toBeEnabled()
      expect(onRestored).not.toHaveBeenCalled()
    })
  }
})

describe('router state and flag', () => {
  it('reads the notice from location state when none is passed, and clears it on dismiss', async () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/x', state: forkNoticeState({ kind: 'created' }) }]}
      >
        {(() => {
          const W = withSharedLists(true)
          return (
            <W>
              <Routes>
                <Route path="*" element={<ForkResultNotice list={makeForkList({ name: 'Priority' })} />} />
              </Routes>
            </W>
          )
        })()}
      </MemoryRouter>
    )
    expect(document.querySelector('[data-toast="forked"]')).toBeVisible()
    await userEvent.click(screen.getByRole('button'))
    expect(document.querySelector('[data-toast]')).toBeNull()
  })

  it('with an explicit notice it needs NO Router (and the flag guard comes first)', () => {
    const W = withSharedLists(true)
    render(
      <W>
        <ForkResultNotice
          list={makeForkList({ name: 'Priority' })}
          notice={{ kind: 'created' }}
          onDismiss={() => undefined}
        />
      </W>
    )
    expect(document.querySelector('[data-toast="forked"]')).toBeVisible()
    const Off = withSharedLists(false)
    render(
      <Off>
        <ForkResultNotice list={makeForkList()} />
      </Off>
    )
    // flag OFF + no notice: returns before touching the router (would throw otherwise)
  })

  it('dismissing an explicit notice without a handler is harmless', async () => {
    const W = withSharedLists(true)
    render(
      <W>
        <ForkResultNotice list={makeForkList({ name: 'Priority' })} notice={{ kind: 'created' }} />
      </W>
    )
    await userEvent.click(screen.getByRole('button'))
    expect(document.querySelector('[data-toast]')).toBeNull()
  })

  it('renders nothing without a notice', () => {
    setup(makeForkList(), null)
    expect(document.body.querySelector('[data-result]')).toBeNull()
  })

  it('flag OFF renders nothing', () => {
    renderFork(
      <ForkResultNotice list={makeForkList()} notice={{ kind: 'created' }} />,
      { flag: false }
    )
    expect(document.querySelector('[data-toast]')).toBeNull()
  })

  it('uses generic organization wording when the host passes none', () => {
    renderFork(
      <ForkResultNotice list={makeForkList({ name: 'Priority' })} notice={{ kind: 'created' }} />,
      { organizationName: null }
    )
    expect(document.querySelector('[data-toast]')).toHaveTextContent('your organization now uses')
  })
})
