import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  jsonResponse,
  makeCommonList,
  makeForkList,
} from '../../test/sharedListsFixtures'
import { deferred } from '../../test/helpers'
import { ForkListDialog } from './ForkListDialog'

const FORK_PATH = `/api/v1/selection-lists/${COMMON_ID}/fork`
const QUOTA_PATH = '/api/v1/selection-lists/quota'
const source = makeCommonList({ name: 'Priority', key: 'priority', item_count: 4 })

const quotaOk = () =>
  jsonResponse({
    organization_id: 'org_1',
    quotas: [{ scope: 'org_lists', applies_to: 'organization', limit: 100, current: 37 }],
  })

function setup(
  over: Partial<React.ComponentProps<typeof ForkListDialog>> = {},
  opts: Parameters<typeof renderFork>[1] = {}
) {
  const onForked = vi.fn()
  const onClose = vi.fn()
  const utils = renderFork(
    <>
      <button data-testid="opener">open</button>
      <ForkListDialog
        source={source}
        counts={{ active: 4, archived: 1 }}
        localeCount={9}
        onForked={onForked}
        onClose={onClose}
        {...over}
      />
    </>,
    opts
  )
  return { ...utils, onForked, onClose }
}

const dialog = () => document.querySelector<HTMLElement>('[data-dialog="fork"]')!
const confirmBtn = () => document.querySelector<HTMLButtonElement>('[data-action="confirm-fork"]')!
const cancelBtn = () => document.querySelector<HTMLButtonElement>('[data-action="cancel"]')!

beforeEach(() => {
  stubViewport(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('ForkListDialog — idle (frame 05)', () => {
  it('is a modal dialog named for the list and the organization, described by its subtitle', () => {
    routeFetch({})
    setup()
    const d = screen.getByRole('dialog', { name: /fork.*priority.*globex freight/i })
    expect(d).toBe(dialog())
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAttribute('data-state', 'idle')
    expect(d).toHaveAttribute('data-presentation', 'modal')
    expect(d).not.toHaveAttribute('aria-busy')
    const described = d.getAttribute('aria-describedby')!
    expect(document.getElementById(described)).toHaveTextContent(
      'Your organization gets its own copy that you can change.'
    )
  })

  it('states what is copied, the kept key, who becomes owner and what it replaces', () => {
    routeFetch({})
    setup()
    const summary = dialog().querySelector('[data-fork-summary]')!
    const key = summary.querySelector('[data-fork-key="priority"]')!
    expect(key).toHaveTextContent('priority')
    expect(key).toHaveAttribute('dir', 'ltr')
    expect(dialog().querySelector('[data-fork-copied]')).toHaveTextContent(
      /5 values \(4 active, 1 archived\).*every translation \(9 languages besides English\)/
    )
    expect(dialog().querySelector('[data-fork-shadows]')).toHaveTextContent(
      /forms in globex freight that use priority show your version/i
    )
    expect(summary).toHaveTextContent('Owner of the fork')
    expect(summary).toHaveTextContent('Common list')
    expect(dialog().querySelector('[data-note="no-sync"]')).toHaveTextContent(
      /won.t follow the common list/
    )
  })

  it('falls back to the active item_count and generic wording when little is known', () => {
    routeFetch({})
    setup({
      source: { id: COMMON_ID },
      counts: undefined,
      localeCount: undefined,
    })
    expect(screen.getByRole('dialog', { name: /fork this list for globex freight/i })).toBeVisible()
    expect(dialog().querySelector('[data-fork-copied]')).toHaveTextContent(
      'Every value with their codes and order, and every translation'
    )
    expect(dialog().querySelector('[data-fork-key]')).toBeNull()
    expect(dialog().querySelector('[data-fork-shadows]')).toHaveTextContent(
      'Forms in Globex Freight show your version'
    )
  })

  it('uses singular language wording and the active count for a one-language source', () => {
    routeFetch({})
    setup({ counts: undefined, localeCount: 1 })
    expect(dialog().querySelector('[data-fork-copied]')).toHaveTextContent(
      '4 active values with their codes and order, and every translation (1 language besides English)'
    )
  })

  it('visibility is a radio group of EXACTLY org (default) and private, focus on the selected one', () => {
    routeFetch({})
    setup()
    const group = dialog().querySelector('[data-control="fork-visibility"]')!
    expect(group).toHaveAttribute('role', 'radiogroup')
    expect(within(group as HTMLElement).getAllByRole('radio')).toHaveLength(2)
    expect(group.querySelector('[data-visibility-option="platform"]')).toBeNull()
    const org = group.querySelector('[data-visibility-option="org"]')!
    const priv = group.querySelector('[data-visibility-option="private"]')!
    expect(org).toHaveAttribute('aria-checked', 'true')
    expect(priv).toHaveAttribute('aria-checked', 'false')
    expect(org).toHaveFocus()
    expect(org).toHaveAttribute('tabindex', '0')
    expect(priv).toHaveAttribute('tabindex', '-1')
  })

  it('ArrowDown moves the choice to private and Confirm sends {visibility:"private"} ONLY', async () => {
    const mock = routeFetch({
      [`POST ${FORK_PATH}`]: () => jsonResponse(makeForkList({ visibility: 'private' }), 201),
    })
    const { onForked } = setup()
    await userEvent.keyboard('{ArrowDown}')
    const priv = dialog().querySelector('[data-visibility-option="private"]')!
    expect(priv).toHaveAttribute('aria-checked', 'true')
    expect(priv).toHaveFocus()
    await userEvent.click(confirmBtn())
    await waitFor(() => expect(onForked).toHaveBeenCalled())
    const bodies = bodiesOf(mock, 'POST', FORK_PATH)
    expect(bodies).toEqual([{ visibility: 'private' }])
    expect(Object.keys(bodies[0] as object)).toEqual(['visibility'])
  })

  it('Confirm stays enabled for a huge source: there is no client-side size pre-check', () => {
    routeFetch({})
    setup({ source: makeCommonList({ item_count: 6000 }), counts: undefined })
    expect(confirmBtn()).toBeEnabled()
    expect(dialog().querySelector('[data-case="fork-size-cap"]')).toBeNull()
  })

  it('has touch-target-tall actions', () => {
    routeFetch({})
    setup()
    expect(confirmBtn()).toHaveStyle({ minBlockSize: 'var(--touch-target)' })
    expect(cancelBtn()).toHaveStyle({ minBlockSize: 'var(--touch-target)' })
  })
})

describe('ForkListDialog — quota preview', () => {
  it('shows "37 -> 38 of 100" as a meter when GET /quota succeeds', async () => {
    routeFetch({ [`GET ${QUOTA_PATH}`]: quotaOk })
    setup()
    const preview = await waitFor(() => {
      const el = dialog().querySelector('[data-quota-preview="org_lists"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(preview).toHaveTextContent(/37 → 38 of 100/)
    const meter = within(preview).getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '38')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
  })

  it('a quota already at the limit previews over the limit', async () => {
    routeFetch({
      [`GET ${QUOTA_PATH}`]: () =>
        jsonResponse({
          organization_id: 'o',
          quotas: [{ scope: 'org_lists', applies_to: 'organization', limit: 100, current: 100 }],
        }),
    })
    setup()
    await waitFor(() => expect(dialog().querySelector('[data-quota-preview]')).not.toBeNull())
    expect(dialog().querySelector('[data-quota-preview]')).toHaveTextContent('100 → 101 of 100')
  })

  it('a 403 (no read_quota) makes the preview ABSENT, not an error', async () => {
    const mock = routeFetch({ [`GET ${QUOTA_PATH}`]: () => errorResponse(403, 'FORBIDDEN') })
    setup()
    await waitFor(() => expect(callCount(mock, 'GET', QUOTA_PATH)).toBe(1))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(dialog().querySelector('[data-quota-preview]')).toBeNull()
    expect(within(dialog()).queryByRole('alert')).toBeNull()
    expect(dialog().querySelector('[data-note="no-sync"]')).toBeVisible()
  })
})

describe('ForkListDialog — dismissal and focus', () => {
  it('Cancel and Escape close while idle; focus returns to the opener', async () => {
    routeFetch({})
    const { onClose, unmount } = setup()
    // The opener is whatever held focus before the dialog mounted.
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(undefined)
    await userEvent.click(cancelBtn())
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('returns focus to the element that opened it', async () => {
    routeFetch({})
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = setup()
    expect(opener).not.toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('a disconnected opener is left alone', () => {
    routeFetch({})
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = setup()
    opener.remove()
    expect(() => unmount()).not.toThrow()
  })

  it('traps Tab inside the dialog', async () => {
    routeFetch({})
    setup()
    for (let i = 0; i < 6; i++) {
      await userEvent.tab()
      expect(dialog().contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 4; i++) {
      await userEvent.tab({ shift: true })
      expect(dialog().contains(document.activeElement)).toBe(true)
    }
  })
})

describe('ForkListDialog — submitting (frame 05)', () => {
  it('locks options, disables BOTH buttons natively, is not dismissible, and sends one request', async () => {
    const gate = deferred<Response>()
    const mock = routeFetch({ [`POST ${FORK_PATH}`]: () => gate.promise })
    const { onClose, onForked } = setup()
    await userEvent.click(confirmBtn())

    const d = dialog()
    expect(d).toHaveAttribute('data-state', 'submitting')
    expect(d).toHaveAttribute('aria-busy', 'true')
    expect(confirmBtn()).toBeDisabled()
    expect(cancelBtn()).toBeDisabled()
    expect(confirmBtn()).toHaveAttribute('aria-busy', 'true')
    expect(confirmBtn()).toHaveTextContent('Forking…')
    expect(d.querySelector('[data-visibility-option]')).toBeNull()
    expect(d).toHaveTextContent(/Copying 4 values/)
    expect(d).toHaveTextContent(/can.t be dismissed/)

    await userEvent.keyboard('{Escape}')
    // jsdom does not run the native click of a disabled button; force the handler path too.
    confirmBtn().click()
    confirmBtn().click()
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog()).toBeVisible()
    expect(callCount(mock, 'POST', FORK_PATH)).toBe(1)

    await act(async () => gate.resolve(jsonResponse(makeForkList(), 201)))
    await waitFor(() => expect(onForked).toHaveBeenCalledTimes(1))
    expect(onForked.mock.calls[0][0].kind).toBe('created')
  })

  it('submitting without a known item_count words the copy generically', async () => {
    const gate = deferred<Response>()
    routeFetch({ [`POST ${FORK_PATH}`]: () => gate.promise })
    setup({ source: { id: COMMON_ID } })
    await userEvent.click(confirmBtn())
    expect(dialog()).toHaveTextContent('Copying the values and their translations')
    await act(async () => gate.resolve(jsonResponse(makeForkList(), 200)))
  })

  it('keeps focus inside the dialog when the focused option unmounts', async () => {
    const gate = deferred<Response>()
    routeFetch({ [`POST ${FORK_PATH}`]: () => gate.promise })
    setup()
    await userEvent.click(confirmBtn())
    expect(dialog().contains(document.activeElement)).toBe(true)
    await act(async () => gate.resolve(jsonResponse(makeForkList(), 200)))
  })

  it('a 200 (existing fork) hands over an "existing" outcome', async () => {
    routeFetch({ [`POST ${FORK_PATH}`]: () => jsonResponse(makeForkList(), 200) })
    const { onForked } = setup()
    await userEvent.click(confirmBtn())
    await waitFor(() => expect(onForked).toHaveBeenCalled())
    expect(onForked.mock.calls[0][0]).toMatchObject({ kind: 'existing' })
  })
})

describe('ForkListDialog — refusals stay inside the open dialog (frame 06)', () => {
  interface Case {
    name: string
    reply: () => Response
    result: string
    sel: string
    text: RegExp
    notText?: RegExp
    closeLabel?: string
  }
  const CASES: Case[] = [
    {
      name: 'fork_exists',
      reply: () => errorResponse(409, 'CONFLICT', { reason: 'fork_exists' }),
      result: 'fork_exists',
      sel: '[data-error="CONFLICT"][data-reason="fork_exists"]',
      text: /private draft.*owner/s,
      notText: /\badmin(istrator)?\b/i,
    },
    {
      name: 'fork_not_applicable',
      reply: () => errorResponse(409, 'CONFLICT', { reason: 'fork_not_applicable' }),
      result: 'fork_not_applicable',
      sel: '[data-reason="fork_not_applicable"]',
      text: /already belongs to your organization/,
    },
    {
      name: 'key taken (no reason)',
      reply: () => errorResponse(409, 'CONFLICT'),
      result: 'key-conflict',
      sel: '[data-error="CONFLICT"][data-reason="none"]',
      text: /already has a list with the key\s+priority/,
      closeLabel: 'Back to lists',
    },
    {
      name: 'key taken (unknown reason)',
      reply: () => errorResponse(409, 'CONFLICT', { reason: 'some_future_reason' }),
      result: 'key-conflict',
      sel: '[data-reason="none"]',
      text: /already has a list with the key/,
      closeLabel: 'Back to lists',
    },
    {
      name: 'quota org_lists',
      reply: () => errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'org_lists', limit: 100, current: 100 }),
      result: 'quota',
      sel: '[data-error="QUOTA_EXCEEDED"][data-quota-scope="org_lists"]',
      text: /100 of 100 organization lists/,
    },
    {
      name: 'quota user_lists',
      reply: () => errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'user_lists', limit: 25, current: 25 }),
      result: 'quota',
      sel: '[data-quota-scope="user_lists"]',
      text: /25 of 25/,
    },
    {
      name: 'quota list_items',
      reply: () => errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'list_items', limit: 250, current: 312 }),
      result: 'quota',
      sel: '[data-quota-scope="list_items"]',
      text: /312.*250/,
    },
    {
      name: 'quota unknown scope',
      reply: () => errorResponse(403, 'QUOTA_EXCEEDED', { scope: 'something_new', limit: 1, current: 1 }),
      result: 'quota',
      sel: '[data-error="QUOTA_EXCEEDED"]',
      text: /a limit was reached/i,
    },
    {
      name: 'too large',
      reply: () => errorResponse(400, 'VALIDATION_ERROR'),
      result: 'too-large',
      sel: '[data-error="VALIDATION_ERROR"][data-case="fork-size-cap"]',
      text: /too large to fork.*5,000/s,
    },
    {
      name: 'forbidden',
      reply: () => errorResponse(403, 'FORBIDDEN'),
      result: 'forbidden',
      sel: '[data-error="FORBIDDEN"][data-case="fork-no-create"]',
      text: /can.t fork lists in Globex Freight/,
    },
    {
      name: 'not found',
      reply: () => errorResponse(404, 'NOT_FOUND'),
      result: 'not-found',
      sel: '[data-error="NOT_FOUND"]',
      text: /no longer available/,
      closeLabel: 'Back to lists',
    },
    {
      name: 'unauthenticated',
      reply: () => errorResponse(401, 'UNAUTHENTICATED'),
      result: 'unauthenticated',
      sel: '[data-error="UNAUTHENTICATED"]',
      text: /session has ended/,
    },
  ]

  for (const c of CASES) {
    it(`${c.name}: alert in place of the options, nothing navigates, not retryable`, async () => {
      routeFetch({ [`POST ${FORK_PATH}`]: c.reply })
      const { onForked, onClose } = setup()
      await userEvent.click(confirmBtn())
      await waitFor(() => expect(dialog()).toHaveAttribute('data-result', c.result))
      const d = dialog()
      expect(d).toHaveAttribute('data-state', 'refused')
      const banner = d.querySelector(c.sel)!
      expect(banner).toBeVisible()
      expect(banner).toHaveAttribute('role', 'alert')
      expect(d).toHaveTextContent(c.text)
      if (c.notText) expect(banner).not.toHaveTextContent(c.notText)
      expect(d.querySelector('[data-visibility-option]')).toBeNull()
      expect(d.querySelector('[data-action="retry"]')).toBeNull()
      expect(d.querySelectorAll('a')).toHaveLength(0)
      expect(onForked).not.toHaveBeenCalled()
      const close = d.querySelector('[data-action="close"]')!
      expect(close).toHaveTextContent(c.closeLabel ?? 'Close')
      await userEvent.click(close)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onClose.mock.calls[0][0]).toMatchObject({ kind: expect.any(String) })
    })
  }

  it('the refused dialog is labelled for assistive tech and closes on Escape', async () => {
    routeFetch({ [`POST ${FORK_PATH}`]: () => errorResponse(409, 'CONFLICT') })
    const { onClose } = setup()
    await userEvent.click(confirmBtn())
    await screen.findByRole('dialog', { name: 'Fork refused' })
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('refusals without a name or key use generic wording', async () => {
    routeFetch({ [`POST ${FORK_PATH}`]: () => errorResponse(409, 'CONFLICT') })
    setup({ source: { id: COMMON_ID } })
    await userEvent.click(confirmBtn())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'key-conflict'))
    expect(dialog()).toHaveTextContent('already has a list with the key')
  })

  it('forbidden / fork_exists without a name say "this list"', async () => {
    routeFetch({ [`POST ${FORK_PATH}`]: () => errorResponse(403, 'FORBIDDEN') })
    setup({ source: { id: COMMON_ID } })
    await userEvent.click(confirmBtn())
    await waitFor(() => expect(dialog()).toHaveTextContent('to fork this list'))
  })
})

describe('ForkListDialog — outcome unknown (network / 5xx)', () => {
  it('says "couldn\'t confirm" and Try again re-sends the SAME body; an idempotent 200 lands on the fork', async () => {
    let n = 0
    const mock = routeFetch({
      [`POST ${FORK_PATH}`]: () => {
        n += 1
        return n === 1 ? errorResponse(502, 'UNAVAILABLE') : jsonResponse(makeForkList(), 200)
      },
    })
    const { onForked } = setup()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(confirmBtn())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'network'))
    expect(dialog().querySelector('[data-error="network"]')).toHaveTextContent(/couldn.t confirm/)
    expect(screen.getByRole('dialog', { name: 'Fork failed' })).toBeVisible()
    expect(dialog().querySelector('[data-action="close"]')).toBeVisible()
    await userEvent.click(dialog().querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(onForked).toHaveBeenCalledTimes(1))
    expect(bodiesOf(mock, 'POST', FORK_PATH)).toEqual([
      { visibility: 'private' },
      { visibility: 'private' },
    ])
  })
})

describe('ForkListDialog — bottom sheet below 40em (frame 12)', () => {
  beforeEach(() => {
    stubViewport(false)
  })

  it('renders the DS BottomSheet with the same hooks and condensed content', () => {
    routeFetch({})
    setup()
    const d = dialog()
    expect(d).toHaveAttribute('data-presentation', 'bottom-sheet')
    expect(d).toHaveAttribute('role', 'dialog')
    expect(d.querySelector('[data-control="fork-visibility"]')).toBeVisible()
    expect(d.querySelector('[data-visibility-option="org"][aria-checked="true"]')).toBeVisible()
    expect(d.querySelector('[data-fork-key="priority"]')).toBeVisible()
    expect(d.querySelector('[data-fork-copied]')).toHaveTextContent('5 values and every translation')
    expect(d.querySelector('[data-note="owner"]')).toBeVisible()
    expect(d.querySelector('[data-note="no-sync"]')).toBeVisible()
    expect(d.querySelector('[data-fork-shadows]')).toBeNull()
    expect(d).toHaveTextContent('The common list doesn’t change.')
  })

  it('stacks full-width actions with Cancel first and the primary last', () => {
    routeFetch({})
    setup()
    const buttons = Array.from(dialog().querySelectorAll('button')).filter(b =>
      b.hasAttribute('data-action')
    )
    expect(buttons.map(b => b.getAttribute('data-action'))).toEqual(['cancel', 'confirm-fork'])
    expect(confirmBtn().parentElement).toHaveStyle({ flexDirection: 'column' })
    expect(confirmBtn()).toHaveStyle({ width: '100%' })
  })

  it('submits and dismisses exactly like the modal (scrim only while idle)', async () => {
    const gate = deferred<Response>()
    routeFetch({ [`POST ${FORK_PATH}`]: () => gate.promise })
    const { onClose } = setup()
    await userEvent.click(confirmBtn())
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => gate.resolve(jsonResponse(makeForkList(), 200)))
  })

  it('refusals render in the sheet with a stacked Close', async () => {
    routeFetch({ [`POST ${FORK_PATH}`]: () => errorResponse(502, 'X') })
    setup()
    await userEvent.click(confirmBtn())
    await waitFor(() => expect(dialog()).toHaveAttribute('data-result', 'network'))
    expect(dialog()).toHaveAttribute('data-presentation', 'bottom-sheet')
    expect(dialog().querySelector('[data-action="retry"]')).toBeVisible()
  })
})

describe('ForkListDialog — flag OFF', () => {
  it('is never mounted', () => {
    const mock = routeFetch({})
    setup({}, { flag: false })
    expect(dialog()).toBeNull()
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('ForkListDialog — organization wording', () => {
  it('prefers the prop, then the provider, then "your organization"', () => {
    routeFetch({})
    const a = setup({ organizationName: 'Acme' })
    expect(dialog()).toHaveTextContent('for Acme')
    a.unmount()
    const b = setup({}, { organizationName: null })
    expect(dialog()).toHaveTextContent('for your organization')
    b.unmount()
  })
})
