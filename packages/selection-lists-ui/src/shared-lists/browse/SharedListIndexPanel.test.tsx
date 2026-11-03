import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onGet,
  page,
  renderShared,
  stubApi,
  type ApiStub,
} from '../../test/browseHarness'
import {
  makeCommonList,
  makeForkList,
  makeSharedList,
} from '../../test/sharedListsFixtures'
import { SharedListIndexPanel } from './SharedListIndexPanel'

afterEach(() => vi.unstubAllGlobals())

const LISTS = '/v1/selection-lists'
const own = (id: string, key: string, over = {}) =>
  makeSharedList({ id, key, name: key, visibility: 'org', editable: false, ...over })

const fork = makeForkList({ id: 'fork', key: 'priority', name: 'Priority' })
const yesNo = makeCommonList({ id: 'yn', key: 'yes-no', name: 'Yes / No' })
const work = makeCommonList({ id: 'ws', key: 'work-status', name: 'Work status' })
const lead = own('ls', 'lead-sources', { name: 'Lead sources' })

function mount(path = '/settings/selection-lists', props = {}) {
  const onOpenList = vi.fn()
  const onNewList = vi.fn()
  const utils = renderShared(
    <>
      <SharedListIndexPanel
        hrefForList={l => `/settings/selection-lists/${l.id}`}
        onOpenList={onOpenList}
        onNewList={onNewList}
        {...props}
      />
    </>,
    path
  )
  return { ...utils, onOpenList, onNewList }
}
const lastList = (api: ApiStub) => api.callsTo('GET', LISTS).slice(-1)[0]
const rowKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-list]')).map(n => n.getAttribute('data-list'))

describe('SharedListIndexPanel', () => {
  it('requests include_shared=true with no visibility, and groups the rows', async () => {
    const api = stubApi(onGet(LISTS, page([fork, lead, yesNo, work])))
    const { container } = mount()
    await waitFor(() => expect(container.querySelector('[data-group="common"]')).not.toBeNull())
    expect(lastList(api).query.get('include_shared')).toBe('true')
    expect(lastList(api).query.has('visibility')).toBe(false)
    expect(lastList(api).query.get('status')).toBe('active')
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelector('[data-filter="visibility"]')).not.toBeNull()
    expect(container.querySelector('[data-shadow-note="priority"]')).toHaveTextContent(
      /is your organization.s fork; a common list with the same key is not listed here/
    )
  })

  it('shows a loading skeleton with no group headers, then the rows', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    stubApi(onGet(LISTS, () => gate.then(() => ({ body: page([yesNo]) }))))
    const { container } = mount()
    const panel = container.querySelector('[data-panel="list-index"]')!
    expect(panel).toHaveAttribute('data-state', 'loading')
    expect(panel).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('[data-group]')).toBeNull()
    await act(async () => release())
    await waitFor(() => expect(container.querySelector('[data-group="common"]')).not.toBeNull())
  })

  it('a visibility filter sends it with include_shared, drops grouping and notes, and binds to the URL', async () => {
    const api = stubApi(onGet(LISTS, page([fork, yesNo])))
    const { container } = mount()
    await waitFor(() => expect(rowKeys(container)).toHaveLength(2))
    await userEvent.click(container.querySelector('[data-visibility-filter="platform"]')!)
    await waitFor(() => expect(lastList(api).query.get('visibility')).toBe('platform'))
    expect(lastList(api).query.get('include_shared')).toBe('true')
    expect(screen.getByTestId('location')).toHaveTextContent('visibility=platform')
    await waitFor(() => expect(container.querySelector('[data-panel="list-index"]')).toHaveAttribute('data-state', 'ready'))
    expect(container.querySelector('[data-group]')).toBeNull()
    expect(container.querySelector('[data-shadow-note]')).toBeNull()
    expect(container.querySelector('[data-visibility-filter="platform"]')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(container.querySelector('[data-visibility-filter="any"]')!)
    await waitFor(() => expect(lastList(api).query.has('visibility')).toBe(false))
  })

  it('switch OFF removes the filter (absent), resets it, sends neither param; ON restores Any', async () => {
    const api = stubApi(onGet(LISTS, page([fork, yesNo])))
    const { container } = mount('/settings/selection-lists?visibility=org')
    await waitFor(() => expect(lastList(api).query.get('visibility')).toBe('org'))
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
    await waitFor(() => expect(lastList(api).query.has('include_shared')).toBe(false))
    expect(lastList(api).query.has('visibility')).toBe(false)
    expect(container.querySelector('[data-filter="visibility"]')).toBeNull()
    expect(container.querySelector('[data-toolbar="list-index"][data-include-shared="false"]')).not.toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent('include_shared=false')
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(lastList(api).query.get('include_shared')).toBe('true'))
    expect(container.querySelector('[data-visibility-filter="any"]')).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores a visibility in the URL while the switch is OFF, and an unknown status/visibility value', async () => {
    const api = stubApi(onGet(LISTS, page([lead])))
    mount('/settings/selection-lists?include_shared=false&visibility=platform&status=bogus')
    await waitFor(() => expect(api.callsTo('GET', LISTS)).toHaveLength(1))
    expect(lastList(api).query.has('include_shared')).toBe(false)
    expect(lastList(api).query.has('visibility')).toBe(false)
    expect(lastList(api).query.get('status')).toBe('active')
  })

  it('the status filter is URL state too', async () => {
    const api = stubApi(onGet(LISTS, page([lead])))
    const { container } = mount()
    await waitFor(() => expect(rowKeys(container)).toHaveLength(1))
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all')
    await waitFor(() => expect(lastList(api).query.get('status')).toBe('all'))
    expect(screen.getByTestId('location')).toHaveTextContent('status=all')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('status='))
  })

  it('Load more sends page.nextCursor and appends into the groups', async () => {
    const api = stubApi(
      onGet(LISTS, req =>
        req.query.get('cursor') === 'c1'
          ? { body: page([yesNo]) }
          : { body: page([fork, lead], 'c1') }
      )
    )
    const { container } = mount()
    await waitFor(() => expect(container.querySelector('[data-action="load-more"]')).not.toBeNull())
    expect(container.querySelector('[data-group="common"]')).toBeNull()
    await userEvent.click(container.querySelector('[data-action="load-more"]')!)
    await waitFor(() => expect(container.querySelector('[data-group="common"]')).not.toBeNull())
    expect(lastList(api).query.get('cursor')).toBe('c1')
    expect(lastList(api).query.get('include_shared')).toBe('true')
    expect(rowKeys(container)).toEqual(['priority', 'lead-sources', 'yes-no'])
    expect(container.querySelector('[data-action="load-more"]')).toBeNull()
  })

  it('a failed Load more keeps the rows and retries the same cursor', async () => {
    let fail = true
    const api = stubApi(
      onGet(LISTS, req => {
        if (req.query.get('cursor') !== 'c1') return { body: page([lead], 'c1') }
        if (fail) return { status: 500, body: { code: 'INTERNAL' } }
        return { body: page([yesNo]) }
      })
    )
    const { container } = mount()
    await waitFor(() => expect(container.querySelector('[data-action="load-more"]')).not.toBeNull())
    await userEvent.click(container.querySelector('[data-action="load-more"]')!)
    await screen.findByText("Couldn't load more lists.")
    expect(rowKeys(container)).toEqual(['lead-sources'])
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(rowKeys(container)).toEqual(['lead-sources', 'yes-no']))
    expect(api.callsTo('GET', LISTS).filter(c => c.query.get('cursor') === 'c1')).toHaveLength(2)
  })

  it('an EMPTY page with hasMore follows the cursor instead of concluding "empty"', async () => {
    const api = stubApi(
      onGet(LISTS, req =>
        req.query.get('cursor') === 'c1'
          ? { body: page([], 'c2') }
          : req.query.get('cursor') === 'c2'
            ? { body: page([yesNo]) }
            : { body: page([], 'c1') }
      )
    )
    const { container } = mount()
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
    await waitFor(() => expect(rowKeys(container)).toEqual(['yes-no']))
    expect(api.callsTo('GET', LISTS).map(c => c.query.get('cursor'))).toEqual([null, 'c1', 'c2'])
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
  })

  it('a failed cursor walk over empty pages is an error with Retry, not "empty"', async () => {
    let fail = true
    stubApi(
      onGet(LISTS, req =>
        req.query.get('cursor') === 'c1'
          ? fail
            ? { status: 500, body: {} }
            : { body: page([yesNo]) }
          : { body: page([], 'c1') }
      )
    )
    const { container } = mount()
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).not.toBeNull())
    fail = false
    await userEvent.click(container.querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(rowKeys(container)).toEqual(['yes-no']))
  })

  it('error: Retry re-sends the same filters, which keep their values', async () => {
    let fail = true
    const api = stubApi(onGet(LISTS, () => (fail ? { status: 500, body: {} } : { body: page([lead]) })))
    const { container } = mount('/settings/selection-lists?visibility=org')
    await waitFor(() => expect(container.querySelector('[data-panel="list-index"][data-state="error"]')).not.toBeNull())
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelector('[data-visibility-filter="org"]')).toHaveAttribute('aria-pressed', 'true')
    fail = false
    const before = lastList(api).query.toString()
    await userEvent.click(container.querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(rowKeys(container)).toEqual(['lead-sources']))
    expect(lastList(api).query.toString()).toBe(before)
  })

  it('empty (switch ON): "No lists yet" with the create CTA, disabled at the quota', async () => {
    stubApi(onGet(LISTS, page([])))
    const { container, onNewList, unmount } = mount()
    const empty = await waitFor(() => {
      const el = container.querySelector('[data-panel="list-index"][data-state="empty"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(empty).toHaveTextContent(/no lists yet/i)
    expect(empty).toHaveTextContent(/no common lists are published/i)
    await userEvent.click(empty.querySelector('[data-action="new-list"]')!)
    expect(onNewList).toHaveBeenCalled()
    unmount()
    vi.unstubAllGlobals()
    stubApi(onGet(LISTS, page([])))
    const second = mount('/settings/selection-lists', { newListDisabled: true })
    await waitFor(() => expect(second.container.querySelector('[data-action="new-list"]')).toBeDisabled())
  })

  it('empty under a visibility filter says so and offers to clear it', async () => {
    const api = stubApi(onGet(LISTS, page([])))
    const { container } = mount('/settings/selection-lists?visibility=private')
    await waitFor(() => expect(container.querySelector('[data-state="empty-filtered"]')).not.toBeNull())
    await userEvent.click(container.querySelector('[data-action="clear-visibility-filter"]')!)
    await waitFor(() => expect(lastList(api).query.has('visibility')).toBe(false))
  })

  it('empty (switch OFF): offers "Include common lists", which re-requests with include_shared=true', async () => {
    const api = stubApi(
      onGet(LISTS, req => ({ body: page(req.query.get('include_shared') ? [yesNo] : []) }))
    )
    const { container } = mount('/settings/selection-lists?include_shared=false')
    const empty = await waitFor(() => {
      const el = container.querySelector('[data-state="empty-shared-off"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(empty).toHaveTextContent(/no lists you have a role on/i)
    await userEvent.click(container.querySelector('[data-action="enable-include-shared"]')!)
    await waitFor(() => expect(lastList(api).query.get('include_shared')).toBe('true'))
    await waitFor(() => expect(rowKeys(container)).toEqual(['yes-no']))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('"Show common lists only" in a shadow note sets the Common filter', async () => {
    const api = stubApi(onGet(LISTS, page([fork])))
    const { container } = mount()
    await waitFor(() => expect(container.querySelector('[data-shadow-note]')).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Show common lists only' }))
    await waitFor(() => expect(lastList(api).query.get('visibility')).toBe('platform'))
  })

  it('opens a row through onOpenList', async () => {
    stubApi(onGet(LISTS, page([lead])))
    const { onOpenList } = mount()
    await userEvent.click(await screen.findByRole('link', { name: 'Lead sources' }))
    expect(onOpenList).toHaveBeenCalledWith(expect.objectContaining({ id: 'ls' }))
  })
})
