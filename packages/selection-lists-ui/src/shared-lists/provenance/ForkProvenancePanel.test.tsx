import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Routes, Route, useLocation } from 'react-router-dom'
import { ForkProvenancePanel, defaultSourceHref, formatForkedAt } from './ForkProvenancePanel'
import {
  COMMON_ID,
  FORK_ID,
  archivePath,
  commonItems,
  error,
  jsonResponse,
  page,
  priorityCommon,
  priorityFork,
  renderProvenance,
  routeFetch,
  sourceItemsPath,
  sourcePath,
  stubMatchMedia,
} from '../../test/provenanceFixtures'
import { callsOf, makeForkList, makeSharedList } from '../../test/sharedListsFixtures'

let media: ReturnType<typeof stubMatchMedia> | null = null
afterEach(() => {
  vi.unstubAllGlobals()
  media?.restore()
  media = null
})

type Source = 'active' | 'archived' | 'gone' | 'broken' | { revision: number }

function mockApi(source: Source = 'active', extra: Parameters<typeof routeFetch>[0] = {}) {
  return routeFetch({
    [sourcePath]: () => {
      if (source === 'gone') return error(404, 'NOT_FOUND')
      if (source === 'broken') return error(503, 'UNAVAILABLE')
      const over = source === 'archived' ? { status: 'archived' as const } : {}
      const list = typeof source === 'object' ? { ...priorityCommon(), revision: source.revision } : priorityCommon(over)
      return jsonResponse(list)
    },
    [sourceItemsPath]: () => jsonResponse(page(commonItems())),
    [archivePath]: () => jsonResponse(makeForkList({ status: 'archived' })),
    ...extra,
  })
}

const panel = () => document.querySelector('[data-panel="fork-provenance"]') as HTMLElement
const mount = (props: Partial<React.ComponentProps<typeof ForkProvenancePanel>> = {}, opts = {}) =>
  renderProvenance(<ForkProvenancePanel list={priorityFork()} {...props} />, opts)

describe('ForkProvenancePanel - provenance facts (frame 07)', () => {
  it('flag OFF: renders nothing and reads nothing', () => {
    const fetchMock = mockApi()
    const { container } = mount({}, { flag: false })
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a list that is not a fork renders nothing', () => {
    mockApi()
    const { container } = renderProvenance(<ForkProvenancePanel list={makeSharedList()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('facts render at once, before the comparison: copied version, forked-on, checking', () => {
    routeFetch({ [sourcePath]: () => new Promise(() => {}) })
    mount()
    const card = panel()
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(card).toHaveAttribute('data-behind-state', 'checking')
    expect(card.querySelector('[data-forked-revision="7"]')).toHaveTextContent('7')
    expect(card.querySelector('[data-forked-at="2026-09-02T09:14:00Z"]')).toHaveTextContent(
      formatForkedAt('2026-09-02T09:14:00Z')
    )
    // Neither action is offered until the read answers.
    expect(document.querySelector('[data-action="revert-to-common"]')).toBeNull()
    expect(document.querySelector('[data-action="archive-fork"]')).toBeNull()
    expect(document.querySelector('[data-revert-gate="source-unknown"]')).not.toBeNull()
    // The source is not linked until the read returned a list.
    expect(within(card).queryByRole('link')).toBeNull()
  })

  it('comparison unavailable (4.1.x): the source link, no source revision, revert offered', async () => {
    mockApi('active')
    mount()
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'unknown'))
    expect(panel()).not.toHaveAttribute('aria-busy')
    expect(panel()).toHaveTextContent('Copied version 7. Changes to the common list since then are not tracked here.')
    expect(panel().querySelector('[data-source-revision]')).toBeNull()
    const links = within(panel()).getAllByRole('link')
    expect(links).toHaveLength(2)
    links.forEach(link => {
      expect(link).toHaveAttribute('href', `/settings/selection-lists/${COMMON_ID}`)
      expect(link).toHaveAttribute('data-action', 'view-source')
    })
    expect(within(panel()).getByRole('link', { name: 'Priority' })).toBeInTheDocument()
    const revert = screen.getByRole('button', { name: 'Revert to common list…' })
    expect(revert).toHaveAttribute('data-revert-gate', 'source-active')
    expect(document.querySelector('[data-action="archive-fork"]')).toBeNull()
  })

  it('behind: source revision 9 > copied 7 - informational only', async () => {
    mockApi({ revision: 9 })
    mount()
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'behind'))
    expect(panel().querySelector('[data-source-revision="9"]')).toHaveTextContent('9')
    expect(panel().querySelector('[data-forked-revision="7"]')).toHaveTextContent('7')
    expect(panel()).toHaveTextContent('The common list has changed since you forked.')
    expect(within(panel()).queryByRole('button', { name: /merge|sync|update|pull/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Revert to common list…' })).toBeInTheDocument()
  })

  it('up to date', async () => {
    mockApi({ revision: 7 })
    mount()
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'up-to-date'))
    expect(panel()).toHaveTextContent('Same version as the common list (7).')
  })

  it('source archived: retired, link kept, "Archive fork…" instead of revert', async () => {
    mockApi('archived')
    mount()
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'source-archived'))
    expect(panel()).toHaveTextContent('Your fork is unaffected.')
    expect(within(panel()).getAllByRole('link').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Archive fork…' })).toHaveAttribute(
      'data-revert-gate',
      'source-unavailable'
    )
    expect(screen.queryByRole('button', { name: /revert/i })).toBeNull()
  })

  it('source gone: "no longer available", no link, no alert, "Archive fork…"', async () => {
    mockApi('gone')
    mount()
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'source-gone'))
    expect(panel()).toHaveTextContent('Forked from a common list that is no longer available')
    expect(within(panel()).queryByRole('link')).toBeNull()
    expect(within(panel()).queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Archive fork…' })).toBeInTheDocument()
  })

  it('check failed: "Couldn\'t check", no action, Retry re-runs the source read', async () => {
    let calls = 0
    const fetchMock = mockApi('active', {
      [sourcePath]: () => (++calls === 1 ? error(503, 'UNAVAILABLE') : jsonResponse(priorityCommon())),
    })
    mount()
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'error'))
    expect(panel()).toHaveTextContent("Couldn't check the common list.")
    expect(document.querySelector('[data-action="revert-to-common"]')).toBeNull()
    expect(document.querySelector('[data-action="archive-fork"]')).toBeNull()
    await userEvent.click(within(panel()).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'unknown'))
    expect(callsOf(fetchMock).filter(c => c[0].endsWith(COMMON_ID))).toHaveLength(2)
  })

  it('"Change who can see it" is offered only when the host gives a handler', async () => {
    mockApi()
    const onChangeVisibility = vi.fn()
    const { unmount } = mount({ onChangeVisibility })
    await userEvent.click(await screen.findByRole('button', { name: 'Change who can see it' }))
    expect(onChangeVisibility).toHaveBeenCalledTimes(1)
    unmount()
    mount()
    await screen.findByRole('button', { name: 'Revert to common list…' })
    expect(screen.queryByRole('button', { name: 'Change who can see it' })).toBeNull()
  })

  it('a plain click on the source link navigates in-app; a modified click does not', async () => {
    mockApi()
    const Where = () => <div data-testid="where">{useLocation().pathname}</div>
    renderProvenance(
      <Routes>
        <Route path="*" element={<><ForkProvenancePanel list={priorityFork()} /><Where /></>} />
      </Routes>
    )
    const view = (await within(await waitForPanel()).findAllByRole('link'))[1]
    // jsdom cannot navigate: swallow the browser default a modified click keeps.
    const swallow = (e: Event) => e.preventDefault()
    document.addEventListener('click', swallow)
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(view, modifier)
      expect(screen.getByTestId('where')).toHaveTextContent(`/settings/selection-lists/${FORK_ID}`)
    }
    document.removeEventListener('click', swallow)
    await userEvent.click(view)
    expect(screen.getByTestId('where')).toHaveTextContent(`/settings/selection-lists/${COMMON_ID}`)
  })

  it('a custom sourceHref decides where the common list lives', async () => {
    mockApi()
    mount({ sourceHref: id => `/lists/${id}` })
    const links = await within(await waitForPanel()).findAllByRole('link')
    expect(links[0]).toHaveAttribute('href', `/lists/${COMMON_ID}`)
    expect(defaultSourceHref('a b')).toBe('/settings/selection-lists/a%20b')
  })

  it('an unparsable forked_at is shown as sent', () => {
    expect(formatForkedAt('not a date')).toBe('not a date')
  })

  it('an already-archived fork offers no action', async () => {
    mockApi()
    mount({ list: priorityFork({ status: 'archived' }) })
    await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'unknown'))
    expect(screen.queryByRole('button', { name: /revert|archive/i })).toBeNull()
  })
})

const waitForPanel = async () => {
  await waitFor(() => expect(panel()).not.toBeNull())
  return panel()
}

describe('ForkProvenancePanel - revert / archive (frames 07, 13)', () => {
  it('revert: confirm in place, Cancel focused, Escape closes without a request', async () => {
    const fetchMock = mockApi()
    mount({ organizationName: 'Acme Logistics' })
    await userEvent.click(await screen.findByRole('button', { name: 'Revert to common list…' }))
    const dialog = screen.getByRole('alertdialog', { name: /Revert Acme Logistics to the common Priority list/ })
    expect(dialog).toHaveAttribute('data-presentation', 'inline')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(callsOf(fetchMock).filter(c => c[0].endsWith('/archive'))).toHaveLength(0)
  })

  it('confirming archives the fork once, closes, reports the entity and shows the result', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const archived = makeForkList({ status: 'archived' })
    const fetchMock = mockApi('active', {
      [archivePath]: async () => {
        await gate
        return jsonResponse(archived)
      },
    })
    const onArchived = vi.fn()
    mount({ onArchived })
    await userEvent.click(await screen.findByRole('button', { name: 'Revert to common list…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Archive and revert' }))
    const confirm = document.querySelector('[data-action="confirm-revert"]') as HTMLButtonElement
    expect(confirm).toBeDisabled()
    await act(async () => release())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const posts = callsOf(fetchMock).filter(c => c[1]?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toBe(`/api/v1/selection-lists/${FORK_ID}/archive`)
    expect(onArchived).toHaveBeenCalledWith(archived)
    expect(document.querySelector('[data-state="archived"]')).toHaveTextContent('Your fork is archived.')
    // The fork is archived: no further action is offered.
    expect(screen.queryByRole('button', { name: /revert|archive fork/i })).toBeNull()
  })

  it('403: "Only the list\'s owner can archive it", nothing changed, the action stays', async () => {
    mockApi('active', { [archivePath]: () => error(403, 'FORBIDDEN') })
    const onArchived = vi.fn()
    mount({ onArchived })
    await userEvent.click(await screen.findByRole('button', { name: 'Revert to common list…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Archive and revert' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-error', 'FORBIDDEN')
    expect(alert).toHaveAttribute('data-case', 'revert-not-owner')
    expect(alert).toHaveTextContent("Only the list's owner can archive it")
    expect(onArchived).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Revert to common list…' })).toBeInTheDocument()
  })

  it.each([
    [401, 'UNAUTHENTICATED', undefined, 'UNAUTHENTICATED', "You're signed out"],
    [404, 'NOT_FOUND', undefined, 'NOT_FOUND', 'This list no longer exists'],
    [409, 'CONFLICT', 'list_locked', 'CONFLICT', "The list can't be archived right now"],
    [503, 'UNAVAILABLE', undefined, 'UNKNOWN_OUTCOME', "We couldn't confirm the list was archived"],
  ])('%i is shown as an explicit state, never swallowed', async (status, code, reason, dataError, title) => {
    mockApi('active', { [archivePath]: () => error(status, code, reason) })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Revert to common list…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Archive and revert' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-error', dataError)
    expect(alert).toHaveTextContent(title)
  })

  it('a second attempt after a refusal clears the previous banner', async () => {
    mockApi('active', { [archivePath]: () => error(403, 'FORBIDDEN') })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Revert to common list…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Archive and revert' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Revert to common list…' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('source archived: the confirm states outright there is no common list; confirming archives', async () => {
    const fetchMock = mockApi('archived')
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Archive fork…' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('data-confirm', 'archive-fork-no-common')
    expect(dialog).toHaveAttribute('data-source-state', 'archived')
    expect(screen.getByRole('button', { name: 'Keep using this list' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Archive anyway' }))
    await waitFor(() => expect(callsOf(fetchMock).filter(c => c[1]?.method === 'POST')).toHaveLength(1))
  })

  it('source gone: the confirm is conditional and names the fork', async () => {
    mockApi('gone')
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Archive fork…' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('data-confirm', 'archive-fork-source-unknown')
    expect(dialog.querySelector('[data-consequence="conditional-no-effective-list"]')).toHaveTextContent(
      'If no active common Priority list is available'
    )
  })
})

describe('ForkProvenancePanel - 375 px (frame 13)', () => {
  it('compact: bottom-sheet confirm, full-width touch-sized actions', async () => {
    media = stubMatchMedia(true)
    mockApi()
    mount({ onChangeVisibility: () => {} })
    const revert = await screen.findByRole('button', { name: 'Revert to common list…' })
    expect(revert).toHaveStyle({ minBlockSize: 'var(--touch-target)', width: '100%' })
    const view = within(panel()).getAllByRole('link').slice(-1)[0]
    expect(view).toHaveStyle({ minBlockSize: 'var(--touch-target)', width: '100%', gridColumn: '1 / -1' })
    await userEvent.click(revert)
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-presentation', 'bottom-sheet')
  })

  it('compact + source gone: the card has no link and the action is touch-sized', async () => {
    media = stubMatchMedia(true)
    mockApi('gone')
    mount()
    const archive = await screen.findByRole('button', { name: 'Archive fork…' })
    expect(archive).toHaveStyle({ minBlockSize: 'var(--touch-target)' })
    expect(within(panel()).queryByRole('link')).toBeNull()
  })

  it('RTL: the facts are bidi-isolated and every layout property is logical', async () => {
    document.documentElement.setAttribute('dir', 'rtl')
    document.documentElement.setAttribute('lang', 'he')
    try {
      mockApi({ revision: 9 })
      mount()
      await waitFor(() => expect(panel()).toHaveAttribute('data-behind-state', 'behind'))
      for (const sel of ['[data-forked-revision]', '[data-source-revision]', '[data-forked-at]']) {
        expect(panel().querySelector(sel)).toHaveStyle({ unicodeBidi: 'isolate' })
      }
      const inline = (el: Element) => (el as HTMLElement).getAttribute('style') ?? ''
      document.querySelectorAll('[data-fork-provenance] *').forEach(el => {
        expect(inline(el)).not.toMatch(/(margin|padding|border)-(left|right)|(^|;\s*)(left|right):|text-align:\s*(left|right)/)
      })
    } finally {
      document.documentElement.removeAttribute('dir')
      document.documentElement.removeAttribute('lang')
    }
  })
})
