import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BASE,
  PLATFORM_ORG_ID,
  bodyOf,
  callsTo,
  err,
  forkList,
  platformOwned,
  renderControl,
  routedFetch,
  stubMatchMedia,
  world,
} from '../../test/visibilityHarness'
import { jsonResponse, makeSharedList } from '../../test/sharedListsFixtures'
import { SharedListsFeatureProvider, type SharedList } from '../core'
import { VisibilityControl } from './VisibilityControl'

const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const opt = (v: string) => q(`[data-control='visibility'] [data-visibility-option='${v}']`)!
const panel = () => q("[data-panel='visibility-control']")
const confirmEl = (name: string) => q(`[data-confirm='${name}']`)

let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  user = userEvent.setup()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Wait for the ready radio group. */
async function ready() {
  await waitFor(() => expect(panel()?.getAttribute('data-state')).toBe('ready'))
}

describe('flag', () => {
  it('OFF: renders nothing and sends no request', () => {
    const w = world(forkList())
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list, { flag: false })
    expect(panel()).toBeNull()
    expect(document.body.textContent).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('loading and error (frame 08)', () => {
  it('shows an aria-busy skeleton and no options while the list loads', async () => {
    let release: ((r: Response) => void) | null = null
    const list = forkList()
    routedFetch({
      [`GET ${BASE}/${list.id}`]: () => new Promise<Response>(r => (release = r)),
    })
    renderControl(list)
    expect(panel()).toHaveAttribute('data-state', 'loading')
    expect(panel()).toHaveAttribute('aria-busy', 'true')
    expect(q('[data-control=visibility]')).toBeNull()
    await waitFor(() => expect(release).not.toBeNull())
    await act(async () => release!(jsonResponse(list)))
    await ready()
  })

  it('shows the skeleton while the roster call is pending — editability is never guessed', async () => {
    const w = world(forkList())
    routedFetch(w.routes)
    renderControl(w.state.list, { access: 'loading' })
    await waitFor(() => expect(calls(w)).toBeGreaterThan(0))
    await act(async () => undefined)
    expect(panel()).toHaveAttribute('data-state', 'loading')
    expect(q('[data-control=visibility]')).toBeNull()
  })

  it('a failed list read is an error panel; Retry re-reads the list', async () => {
    const list = forkList()
    let fail = true
    const fetchMock = routedFetch({
      [`GET ${BASE}/${list.id}`]: () => (fail ? err(500, 'INTERNAL') : jsonResponse(list)),
    })
    renderControl(list)
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'))
    expect(panel()).toHaveTextContent(/couldn.t load access settings/i)
    fail = false
    await user.click(within(panel()!).getByRole('button', { name: /retry/i }))
    await ready()
    expect(callsTo(fetchMock, 'GET', `${BASE}/${list.id}`)).toHaveLength(2)
  })

  it('a list that is not found is the same error panel', async () => {
    const list = forkList()
    routedFetch({ [`GET ${BASE}/${list.id}`]: () => err(404, 'NOT_FOUND') })
    renderControl(list)
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'))
  })

  it('a failed roster call is an error panel; Retry re-runs the roster call', async () => {
    const w = world(forkList())
    routedFetch(w.routes)
    const onRetryAccess = vi.fn()
    renderControl(w.state.list, { access: 'error', onRetryAccess })
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'))
    await user.click(within(panel()!).getByRole('button', { name: /retry/i }))
    expect(onRetryAccess).toHaveBeenCalledTimes(1)
  })
})

function calls(w: ReturnType<typeof world>) {
  return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    c => c[0] === w.path
  ).length
}

describe('ready (frame 08)', () => {
  it('private + org only for a customer org; org checked and holds the single tab stop; group is named', async () => {
    const w = world(forkList())
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    const group = screen.getByRole('radiogroup', { name: /who can see this list/i })
    expect(group).toHaveAttribute('data-control', 'visibility')
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
    expect(opt('org')).toHaveAttribute('tabindex', '0')
    expect(opt('private')).toHaveAttribute('aria-checked', 'false')
    expect(opt('private')).toHaveAttribute('tabindex', '-1')
    expect(q("[data-visibility-option='platform']")).toBeNull()
    expect(panel()).not.toHaveAttribute('data-scope')
    expect(opt('org')).toHaveTextContent('Everyone in Acme Logistics')
    expect(opt('org')).toHaveTextContent('Current')
  })

  it('falls back to "your organization" when the host passes no name', async () => {
    const w = world(forkList())
    routedFetch(w.routes)
    renderControl(w.state.list, { organizationName: '  ' })
    await ready()
    expect(opt('org')).toHaveTextContent('Everyone in your organization')
  })

  it('a list with no visibility field is private (absent = private)', async () => {
    const w = world(makeSharedList({ visibility: undefined }))
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    expect(opt('private')).toHaveAttribute('aria-checked', 'true')
    expect(opt('private')).toHaveTextContent('Current')
  })

  it('fork-specific option copy renders only for a fork', async () => {
    const f = world(forkList())
    routedFetch(f.routes)
    const { unmount } = renderControl(f.state.list)
    await ready()
    expect(opt('private')).toHaveTextContent(/for a fork/i)
    expect(opt('org')).toHaveTextContent(/replaces the common list/i)
    unmount()
    const n = world(makeSharedList({ forked_from: null }))
    routedFetch(n.routes)
    renderControl(n.state.list)
    await ready()
    expect(opt('private')).not.toHaveTextContent(/for a fork/i)
    expect(opt('org')).not.toHaveTextContent(/replaces the common list/i)
  })
})

describe('Private -> Organization saves directly (frame 08)', () => {
  it('sends PATCH {visibility:"org"} with no confirm, shows saving, then the "can now see" status', async () => {
    const w = world(forkList({ visibility: 'private' }))
    let release: () => void = () => undefined
    const base = w.routes[`PATCH ${w.path}`]
    w.routes[`PATCH ${w.path}`] = (init, url) =>
      new Promise<Response>(resolve => {
        release = () => resolve(base(init, url) as Response)
      })
    const fetchMock = routedFetch(w.routes)
    const onChanged = vi.fn()
    renderControl(w.state.list, { onChanged })
    await ready()
    await user.click(opt('org'))
    expect(q('[data-confirm]')).toBeNull()
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'saving'))
    expect(panel()).toHaveAttribute('aria-busy', 'true')
    expect(q('[data-visibility-option]')).toBeNull()
    await act(async () => release())
    await ready()
    const patches = callsTo(fetchMock, 'PATCH', w.path)
    expect(patches).toHaveLength(1)
    expect(bodyOf(patches[0])).toEqual({ visibility: 'org' })
    const toast = q("[data-result='visibility-saved']")!
    expect(toast).toHaveAttribute('role', 'status')
    expect(toast).toHaveTextContent('Everyone in Acme Logistics can now see Priority.')
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
    expect(opt('org')).toHaveFocus()
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'org' }))
    // The returned entity patched the cache: no re-read of the list.
    expect(callsTo(fetchMock, 'GET', w.path)).toHaveLength(1)
  })

  it('the saved status can be dismissed', async () => {
    const w = world(forkList({ visibility: 'private' }))
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('org'))
    await waitFor(() => expect(q("[data-result='visibility-saved']")).not.toBeNull())
    await user.click(within(q("[data-result='visibility-saved']")!).getByRole('button'))
    expect(q("[data-result='visibility-saved']")).toBeNull()
  })

  it('keeps the entity visibility when the service omits the field from its answer', async () => {
    const w = world(forkList({ visibility: 'private' }))
    w.routes[`PATCH ${w.path}`] = () => jsonResponse({ ...w.state.list, visibility: undefined })
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('org'))
    await waitFor(() => expect(opt('org')).toHaveAttribute('aria-checked', 'true'))
  })
})

describe('Organization -> Private (frame 08)', () => {
  it('opens an in-place alertdialog with the FORK consequences; Cancel and Esc change nothing and return focus', async () => {
    const w = world(forkList())
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('private'))
    const c = confirmEl('visibility-to-private')!
    expect(c).toHaveAttribute('role', 'alertdialog')
    expect(c).toHaveAttribute('data-presentation', 'inline')
    expect(c).toHaveAccessibleName('Make Priority private?')
    expect(c.querySelector("[data-consequence='forms']")).toHaveTextContent(
      /common.*list.*if one is active.*list unavailable/is
    )
    expect(c.querySelector("[data-consequence='stored-common']")).toHaveTextContent(/common labels/i)
    expect(c.querySelector("[data-consequence='stored-fork']")).toHaveTextContent(/fork.s labels/i)
    expect(c.querySelector("[data-consequence='stored-fork']")).toHaveTextContent('Acme Logistics')
    expect(c).toHaveTextContent(/nothing is deleted/i)
    // Cancel holds initial focus.
    expect(within(c).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(within(c).getByRole('button', { name: 'Cancel' }))
    expect(confirmEl('visibility-to-private')).toBeNull()
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
    expect(opt('org')).toHaveFocus()

    await user.click(opt('private'))
    await user.keyboard('{Escape}')
    expect(confirmEl('visibility-to-private')).toBeNull()
    expect(opt('org')).toHaveFocus()
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(0)
  })

  it('the fork-specific lines render ONLY when forked_from is set', async () => {
    const w = world(makeSharedList({ forked_from: null }))
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('private'))
    const c = confirmEl('visibility-to-private')!
    for (const k of ['forms', 'stored-common', 'stored-fork'])
      expect(c.querySelector(`[data-consequence='${k}']`)).toBeNull()
    expect(c).toHaveTextContent(/members without a role can no longer see it/i)
  })

  it('Space on the focused option opens the confirm (keyboard path)', async () => {
    const w = world(forkList())
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    opt('private').focus()
    await user.keyboard(' ')
    expect(confirmEl('visibility-to-private')).not.toBeNull()
  })

  it('confirming sends PATCH {visibility:"private"}, locks the panel while saving, then the status', async () => {
    const w = world(forkList())
    let release: () => void = () => undefined
    const base = w.routes[`PATCH ${w.path}`]
    w.routes[`PATCH ${w.path}`] = (init, url) =>
      new Promise<Response>(resolve => {
        release = () => resolve(base(init, url) as Response)
      })
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('private'))
    await user.click(within(confirmEl('visibility-to-private')!).getByRole('button', { name: 'Make private' }))
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'saving'))
    expect(q("[data-action='confirm-visibility']")).toBeNull()
    expect(q('[data-visibility-option]')).toBeNull()
    await act(async () => release())
    await ready()
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(1)
    expect(bodyOf(callsTo(fetchMock, 'PATCH', w.path)[0])).toEqual({ visibility: 'private' })
    expect(q("[data-result='visibility-saved']")).toHaveTextContent(/priority is now private\. only people with a role see it/i)
    expect(opt('private')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('refusals (frame 08)', () => {
  async function refuse(response: Response, pick: 'private' | 'org' = 'private') {
    const w = world(forkList({ visibility: pick === 'private' ? 'org' : 'private' }))
    w.routes[`PATCH ${w.path}`] = () => response
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt(pick))
    if (pick === 'private')
      await user.click(within(confirmEl('visibility-to-private')!).getByRole('button', { name: 'Make private' }))
    return { w, fetchMock }
  }

  it('403 on save: previous setting restored + "only the owner" alert', async () => {
    await refuse(err(403, 'FORBIDDEN'))
    const e = await waitFor(() => {
      const el = q("[data-error='FORBIDDEN'][data-case='visibility-not-owner']")
      expect(el).not.toBeNull()
      return el!
    })
    expect(e).toHaveAttribute('role', 'alert')
    expect(e).toHaveTextContent(/only the list.s owner can change who sees it/i)
    await ready()
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
  })

  it('401: session-expired alert, nothing changed', async () => {
    await refuse(err(401, 'UNAUTHENTICATED'))
    await waitFor(() => expect(q("[data-error='UNAUTHENTICATED']")).toHaveTextContent(/session has expired/i))
  })

  it('404: the list is gone', async () => {
    await refuse(err(404, 'NOT_FOUND'))
    await waitFor(() => expect(q("[data-error='NOT_FOUND']")).toHaveTextContent(/no longer available/i))
  })

  it('400: the service did not accept the change', async () => {
    await refuse(err(400, 'VALIDATION_ERROR'), 'org')
    await waitFor(() => expect(q("[data-error='VALIDATION_ERROR']")).toHaveTextContent(/didn.t accept/i))
  })

  it('409 fork_required: fork-first explanation', async () => {
    await refuse(err(409, 'CONFLICT', { reason: 'fork_required', source_list_id: 'front_sl_x' }))
    await waitFor(() => expect(q("[data-reason='fork_required']")).toHaveTextContent(/fork this common list/i))
  })

  it('409 without visibility_locked: the list changed; it is reloaded', async () => {
    const { w, fetchMock } = await refuse(err(409, 'CONFLICT', { reason: 'something_else' }))
    await waitFor(() => expect(q("[data-error='CONFLICT']")).toHaveTextContent(/changed while you were editing/i))
    await waitFor(() => expect(callsTo(fetchMock, 'GET', w.path).length).toBeGreaterThan(1))
  })

  it('500: outcome unknown — says so and reloads the list so the real setting shows', async () => {
    const { w, fetchMock } = await refuse(err(500, 'INTERNAL'))
    await waitFor(() => expect(q("[data-error='UNKNOWN']")).toHaveTextContent(/couldn.t confirm/i))
    await waitFor(() => expect(callsTo(fetchMock, 'GET', w.path).length).toBeGreaterThan(1))
  })

  it('a cancelled request is treated as an unknown outcome, never a crash', async () => {
    const w = world(forkList())
    w.routes[`PATCH ${w.path}`] = () => {
      throw new DOMException('aborted', 'AbortError')
    }
    routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('private'))
    await user.click(within(confirmEl('visibility-to-private')!).getByRole('button', { name: 'Make private' }))
    await waitFor(() => expect(q("[data-error='UNKNOWN']")).not.toBeNull())
  })

  it('409 visibility_locked on a stale demotion: explanation + reload lands on the locked statement', async () => {
    const list = platformOwned()
    const w = world(list)
    w.routes[`PATCH ${w.path}`] = () => {
      w.state.list = { ...w.state.list, visibility: 'platform' }
      return err(409, 'CONFLICT', { reason: 'visibility_locked' })
    }
    const fetchMock = routedFetch(w.routes)
    renderControl(list, { platformOrg: true, activeOrganizationId: PLATFORM_ORG_ID })
    await ready()
    await user.click(opt('private'))
    await user.click(within(confirmEl('visibility-to-private')!).getByRole('button', { name: 'Make private' }))
    const e = await waitFor(() => {
      const el = q("[data-error='CONFLICT'][data-reason='visibility_locked']")
      expect(el).not.toBeNull()
      return el!
    })
    expect(e).toHaveTextContent(/can.t be made private/i)
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'locked'))
    expect(callsTo(fetchMock, 'GET', w.path).length).toBeGreaterThan(1)
    // The refusal outlives the reload.
    expect(q("[data-reason='visibility_locked']")).not.toBeNull()
  })

  it('ignores a second choice while a save is in flight (single-flight)', async () => {
    const w = world(forkList({ visibility: 'private' }))
    const base = w.routes[`PATCH ${w.path}`]
    let release: () => void = () => undefined
    w.routes[`PATCH ${w.path}`] = (init, url) =>
      new Promise<Response>(resolve => {
        release = () => resolve(base(init, url) as Response)
      })
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('org'))
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'saving'))
    await act(async () => release())
    await ready()
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(1)
  })
})

describe('read-only and locked (frame 08)', () => {
  it('not an owner (roster 403): a read-only STATEMENT, not a disabled form — org', async () => {
    const w = world(forkList())
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list, { access: 'forbidden' })
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'read-only'))
    expect(panel()).toHaveTextContent(/everyone in acme logistics/i)
    expect(panel()).toHaveTextContent(/only the list.s owner can change this/i)
    expect(q('[data-control=visibility]')).toBeNull()
    expect(q('[data-visibility-option]')).toBeNull()
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(0)
  })

  it('read-only for a private list says who can see it', async () => {
    const w = world(forkList({ visibility: 'private' }))
    routedFetch(w.routes)
    renderControl(w.state.list, { access: 'forbidden' })
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'read-only'))
    expect(panel()).toHaveTextContent(/only people with a role/i)
  })

  it('a common (platform) list is LOCKED: a statement, no radio group, archive is the only retirement', async () => {
    const w = world(platformOwned({ visibility: 'platform' }))
    routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: true, access: 'granted' })
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'locked'))
    expect(panel()).toHaveAttribute('data-visibility', 'platform')
    expect(panel()).toHaveTextContent(/locked/i)
    expect(panel()).toHaveTextContent(/archive/i)
    expect(q('[data-control=visibility]')).toBeNull()
    expect(q('[data-visibility-option]')).toBeNull()
  })

  it('locked shows even to a caller who cannot manage access', async () => {
    const w = world(platformOwned({ visibility: 'platform' }))
    routedFetch(w.routes)
    renderControl(w.state.list, { access: 'forbidden' })
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'locked'))
  })
})

describe('platform operators: publish a common list (frame 08)', () => {
  const key = () => q("[data-confirm='publish-platform'] [data-confirm-input='key']") as HTMLInputElement
  const publishBtn = () => q("[data-confirm='publish-platform'] [data-action='confirm-publish']") as HTMLButtonElement
  const cancelBtn = () => q("[data-confirm='publish-platform'] [data-action='cancel']") as HTMLButtonElement

  async function openPublish(over: Partial<SharedList> = {}) {
    const w = world(platformOwned(over))
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: true, activeOrganizationId: PLATFORM_ORG_ID })
    await ready()
    await user.click(opt('platform'))
    return { w, fetchMock }
  }

  it('the third option renders for the platform org\'s own list; scope marked; Organization stays checked', async () => {
    const w = world(platformOwned())
    routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: true, activeOrganizationId: PLATFORM_ORG_ID })
    await ready()
    expect(q("[data-scope='platform-org'] [data-visibility-option='org'][aria-checked='true']")).not.toBeNull()
    expect(opt('platform')).toHaveTextContent(/every organization/i)
    expect(opt('platform')).toHaveAttribute('aria-checked', 'false')
  })

  it.each([
    ['list stores the TypeID, claim is the UUID', 'org_01jpmf4z1yfcd9tbhz99dprzce', '0195a8f2-7c3e-7b1a-9d2e-3f4a5b6c7d8e'],
    ['list stores the UUID, claim is the TypeID', '0195a8f2-7c3e-7b1a-9d2e-3f4a5b6c7d8e', 'org_01jpmf4z1yfcd9tbhz99dprzce'],
  ])('the third option still renders when the %s (one organization, two renderings)', async (_, stored, claim) => {
    const w = world(platformOwned({ organization_id: stored }))
    routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: true, activeOrganizationId: claim })
    await ready()
    expect(opt('platform')).not.toBeNull()
  })

  it('never for a customer org, even with the right list', async () => {
    const w = world(platformOwned())
    routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: false })
    await ready()
    expect(q("[data-visibility-option='platform']")).toBeNull()
  })

  it('not for another org\'s list when the active org id is known (absent, not disabled)', async () => {
    const w = world(platformOwned({ organization_id: 'org_01jf000000000000000000acme' }))
    routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: true, activeOrganizationId: PLATFORM_ORG_ID })
    await ready()
    expect(q("[data-visibility-option='platform']")).toBeNull()
  })

  it('without an active org id the platform-org flag alone decides (the service still enforces ownership)', async () => {
    const w = world(platformOwned())
    routedFetch(w.routes)
    renderControl(w.state.list, { platformOrg: true })
    await ready()
    expect(q("[data-visibility-option='platform']")).not.toBeNull()
  })

  it('choosing it marks the option PENDING (not checked) and opens the typed-key alertdialog stating irreversibility', async () => {
    await openPublish()
    expect(q("[data-visibility-option='platform'][data-pending='true'][aria-checked='false']")).not.toBeNull()
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
    expect(opt('org')).toHaveAttribute('tabindex', '0')
    const c = confirmEl('publish-platform')!
    expect(c).toHaveAttribute('role', 'alertdialog')
    expect(c).toHaveAttribute('data-scope', 'platform-org')
    expect(c).toHaveTextContent(/ticket channel/i)
    expect(c).toHaveTextContent(/never become private or organization-only again/i)
    expect(within(c).getByText('ticket-channel', { selector: 'bdi' })).toBeInTheDocument()
    expect(cancelBtn()).toHaveFocus()
  })

  it('the key input opens EMPTY, autocomplete/spellcheck off, monospaced LTR; Publish is natively disabled until an EXACT match', async () => {
    await openPublish()
    expect(confirmEl('publish-platform')).toHaveAttribute('data-confirm-state', 'empty')
    expect(key()).toHaveValue('')
    expect(key()).toHaveAttribute('autocomplete', 'off')
    expect(key()).toHaveAttribute('autocapitalize', 'off')
    expect(key()).toHaveAttribute('autocorrect', 'off')
    expect(key()).toHaveAttribute('spellcheck', 'false')
    expect(key()).toHaveAttribute('dir', 'ltr')
    expect(key().style.fontFamily).toBe('var(--font-mono)')
    expect(publishBtn()).toBeDisabled()
    for (const wrong of ['ticket', 'Ticket-Channel', 'ticket-channel ', ' ticket-channel', 'ticket-channe1']) {
      await user.clear(key())
      await user.type(key(), wrong)
      expect(publishBtn(), `"${wrong}"`).toBeDisabled()
    }
    await user.clear(key())
    await user.type(key(), 'ticket-channel')
    expect(publishBtn()).toBeEnabled()
    expect(confirmEl('publish-platform')).toHaveAttribute('data-confirm-state', 'matched')
    await user.type(key(), '{Backspace}')
    expect(publishBtn()).toBeDisabled()
  })

  it('publishing sends {visibility:"platform"} only; everything is natively disabled and Esc does not close; success -> locked', async () => {
    const { w, fetchMock } = await openPublish()
    const base = w.routes[`PATCH ${w.path}`]
    let release: () => void = () => undefined
    w.routes[`PATCH ${w.path}`] = (init, url) =>
      new Promise<Response>(resolve => {
        release = () => resolve(base(init, url) as Response)
      })
    await user.type(key(), 'ticket-channel')
    await user.click(publishBtn())
    await waitFor(() =>
      expect(confirmEl('publish-platform')).toHaveAttribute('data-confirm-state', 'publishing')
    )
    expect(confirmEl('publish-platform')).toHaveAttribute('aria-busy', 'true')
    expect(key()).toBeDisabled()
    expect(cancelBtn()).toBeDisabled()
    expect(publishBtn()).toBeDisabled()
    expect(publishBtn()).toHaveTextContent(/publishing/i)
    await user.keyboard('{Escape}')
    expect(confirmEl('publish-platform')).not.toBeNull()
    await act(async () => release())
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'locked'))
    expect(q('[data-control=visibility]')).toBeNull()
    const patches = callsTo(fetchMock, 'PATCH', w.path)
    expect(patches).toHaveLength(1)
    expect(bodyOf(patches[0])).toEqual({ visibility: 'platform' })
    expect(q("[data-result='visibility-saved']")).toHaveTextContent(/common list/i)
  })

  it('Enter in the key field publishes only on an exact match', async () => {
    const { w, fetchMock } = await openPublish()
    await user.type(key(), 'ticket-channe{Enter}')
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(0)
    await user.type(key(), 'l{Enter}')
    await waitFor(() => expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(1))
  })

  it('Cancel and Esc clear the pending mark and leave Organization selected; nothing is sent', async () => {
    const { w, fetchMock } = await openPublish()
    await user.click(cancelBtn())
    expect(confirmEl('publish-platform')).toBeNull()
    expect(q("[data-visibility-option][data-pending='true']")).toBeNull()
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
    expect(opt('org')).toHaveFocus()
    await user.click(opt('platform'))
    await user.keyboard('{Escape}')
    expect(confirmEl('publish-platform')).toBeNull()
    expect(q("[data-visibility-option][data-pending='true']")).toBeNull()
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(0)
  })

  it('403 on publish: "You can\'t publish common lists", pending cleared, visibility unchanged', async () => {
    const { w } = await openPublish()
    w.routes[`PATCH ${w.path}`] = () => err(403, 'FORBIDDEN')
    await user.type(key(), 'ticket-channel')
    await user.click(publishBtn())
    const e = await waitFor(() => {
      const el = q("[data-error='FORBIDDEN'][data-case='publish-forbidden']")
      expect(el).not.toBeNull()
      return el!
    })
    expect(e).toHaveTextContent(/can.t publish common lists/i)
    expect(e).toHaveAttribute('role', 'alert')
    await ready()
    expect(q("[data-visibility-option][data-pending='true']")).toBeNull()
    expect(opt('org')).toHaveAttribute('aria-checked', 'true')
  })

  it('switching from the make-private confirm to publish replaces it', async () => {
    await openPublish()
    await user.click(cancelBtn())
    await user.click(opt('private'))
    expect(confirmEl('visibility-to-private')).not.toBeNull()
    await user.click(opt('platform'))
    expect(confirmEl('visibility-to-private')).toBeNull()
    expect(confirmEl('publish-platform')).not.toBeNull()
  })
})

describe('phone width (frame 14): confirmations are BottomSheets', () => {
  it('Organization -> Private opens a sheet that IS the alertdialog; Cancel focused; actions stacked; Esc closes', async () => {
    stubMatchMedia(true)
    const w = world(forkList())
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('private'))
    const sheet = q("[data-confirm='visibility-to-private'][data-presentation='bottom-sheet']")!
    expect(sheet).toHaveAttribute('role', 'alertdialog')
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet).toHaveAccessibleName('Make Priority private?')
    expect(sheet.querySelector("[data-consequence='stored-fork']")).not.toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(q("[data-initial-focus='true']")).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(confirmEl('visibility-to-private')).toBeNull()
    expect(opt('org')).toHaveFocus()
    expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(0)
  })

  it('the sheet confirm sends the PATCH', async () => {
    stubMatchMedia(true)
    const w = world(forkList())
    const fetchMock = routedFetch(w.routes)
    renderControl(w.state.list)
    await ready()
    await user.click(opt('private'))
    await user.click(screen.getByRole('button', { name: 'Make private' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PATCH', w.path)).toHaveLength(1))
  })

  it('platform publish is a sheet; the key input is dir=ltr; both actions disable while publishing and Esc is ignored', async () => {
    stubMatchMedia(true)
    const list = platformOwned()
    const w = world(list)
    let release: () => void = () => undefined
    const base = w.routes[`PATCH ${w.path}`]
    w.routes[`PATCH ${w.path}`] = (init, url) =>
      new Promise<Response>(resolve => {
        release = () => resolve(base(init, url) as Response)
      })
    routedFetch(w.routes)
    renderControl(list, { platformOrg: true, activeOrganizationId: PLATFORM_ORG_ID, dir: 'rtl' })
    await ready()
    await user.click(opt('platform'))
    const sheet = q("[data-confirm='publish-platform'][data-presentation='bottom-sheet']")!
    expect(sheet).toHaveAttribute('role', 'alertdialog')
    const input = sheet.querySelector("[data-confirm-input='key']") as HTMLInputElement
    expect(input).toHaveAttribute('dir', 'ltr')
    expect(input).toHaveAttribute('autocapitalize', 'off')
    const publish = sheet.querySelector("[data-action='confirm-publish']") as HTMLButtonElement
    expect(publish).toBeDisabled()
    await user.type(input, 'ticket-channel')
    expect(sheet).toHaveAttribute('data-confirm-state', 'matched')
    expect(publish).toBeEnabled()
    await user.click(publish)
    await waitFor(() => expect(sheet).toHaveAttribute('data-confirm-state', 'publishing'))
    expect(sheet).toHaveAttribute('aria-busy', 'true')
    expect(sheet.querySelector("[data-action='cancel']")).toBeDisabled()
    expect(publish).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(confirmEl('publish-platform')).not.toBeNull()
    await act(async () => release())
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'locked'))
    expect(confirmEl('publish-platform')).toBeNull()
  })
})

describe('RTL', () => {
  it('names and keys are bidi-isolated and the page direction is honoured', async () => {
    const list = platformOwned({ name: 'עדיפות' })
    const w = world(list)
    routedFetch(w.routes)
    renderControl(list, { platformOrg: true, activeOrganizationId: PLATFORM_ORG_ID, dir: 'rtl' })
    await ready()
    expect(panel()!.closest('[dir]')).toHaveAttribute('dir', 'rtl')
    expect(opt('org').querySelector('bdi')).toHaveTextContent('Acme Logistics')
    await user.click(opt('platform'))
    const c = confirmEl('publish-platform')!
    expect(c.querySelectorAll('bdi').length).toBeGreaterThanOrEqual(2)
    expect(within(c).getByText('ticket-channel', { selector: 'bdi' })).toHaveAttribute('dir', 'ltr')
  })
})

describe('unmount while a save is in flight', () => {
  it('does not throw or warn when the answer arrives after unmount', async () => {
    const w = world(forkList({ visibility: 'private' }))
    let release: () => void = () => undefined
    const base = w.routes[`PATCH ${w.path}`]
    w.routes[`PATCH ${w.path}`] = (init, url) =>
      new Promise<Response>(resolve => {
        release = () => resolve(base(init, url) as Response)
      })
    routedFetch(w.routes)
    const { unmount } = renderControl(w.state.list)
    await ready()
    await user.click(opt('org'))
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'saving'))
    unmount()
    await act(async () => release())
  })
})

describe('scoped to one list', () => {
  it('a confirmation opened on list A does not re-bind to list B when the listId changes', async () => {
    const a = world(forkList())
    const bList = forkList({ id: 'front_sl_01jfq3w8z6y5x4c3b2a1n9m8k8', name: 'Severity' })
    const b = world(bList)
    const fetchMock = routedFetch({ ...a.routes, ...b.routes })
    const tree = (id: string) => (
      <SharedListsFeatureProvider sharedLists>
        <VisibilityControl listId={id} access="granted" onRetryAccess={() => undefined} />
      </SharedListsFeatureProvider>
    )
    const { rerender } = render(tree(a.state.list.id))
    await ready()
    await user.click(opt('private'))
    expect(confirmEl('visibility-to-private')).not.toBeNull()
    rerender(tree(bList.id))
    await ready()
    expect(confirmEl('visibility-to-private')).toBeNull()
    expect(callsTo(fetchMock, 'PATCH', b.path)).toHaveLength(0)
  })
})
