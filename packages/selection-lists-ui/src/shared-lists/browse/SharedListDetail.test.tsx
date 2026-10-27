import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onGet,
  onItems,
  page,
  renderShared,
  stubApi,
  type ApiStub,
} from '../../test/browseHarness'
import {
  makeCommonList,
  makeForkList,
  makeSharedList,
  COMMON_ID,
  FORK_ID,
} from '../../test/sharedListsFixtures'
import { SharedListDetail } from './SharedListDetail'

afterEach(() => vi.unstubAllGlobals())

const LISTS = '/v1/selection-lists'
const item = (id: string, code: string, label: string, over = {}) => ({
  id,
  list_id: COMMON_ID,
  code,
  label,
  is_machine: false,
  status: 'active',
  sort_order: Number(id.slice(-1)),
  source_hash: 'h',
  ...over,
})
const items = [
  item('sli1', 'LOW', 'Low'),
  item('sli2', 'HIGH', 'High', { is_machine: true }),
  item('sli3', 'CRITICAL', 'Critical (legacy)', { status: 'archived' }),
]

/** The effective-list lookup (`?key=…&include_shared=true&limit=1`). */
const effective = (result: unknown[] | 'fail') =>
  onGet(LISTS, req =>
    req.query.get('key') === undefined || req.query.get('key') === null
      ? undefined
      : result === 'fail'
        ? { status: 500, body: {} }
        : { body: page(result) }
  )

function mount(
  listId: string,
  options: { forkAction?: boolean; editor?: boolean } = {}
) {
  const renderEditor = vi.fn(({ header }) => (
    <div data-testid="editor">{header ? <span data-testid="header">{header}</span> : 'no header'}</div>
  ))
  const onOpenTranslations = vi.fn()
  const utils = renderShared(
    <SharedListDetail
      listId={listId}
      renderEditor={renderEditor}
      forkAction={options.forkAction ? list => <button data-action="fork-to-edit">Fork {list.key}</button> : undefined}
      hrefForList={l => `/settings/selection-lists/${l.id}`}
      onOpenList={l => (window.history.replaceState({}, '', `/x/${l.id}`), undefined)}
      onOpenTranslations={onOpenTranslations}
      onBackToIndex={() => undefined}
      indexHref="/settings/selection-lists"
    />,
    `/settings/selection-lists/${listId}`,
    { routePaths: ['/settings/selection-lists/:listId'] }
  )
  return { ...utils, renderEditor, onOpenTranslations }
}

const itemsOf = (api: ApiStub, id: string) => api.callsTo('GET', `${LISTS}/${id}/items`)

describe('common list, read-only (frame 02)', () => {
  const common = makeCommonList()
  const setup = () =>
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, common),
      onItems(`${LISTS}/${COMMON_ID}/items`, items),
      effective([common])
    )

  it('badge, notice, facts, read-only value table with the archived value badged, and the fork slot', async () => {
    const api = setup()
    const { container } = mount(COMMON_ID, { forkAction: true })
    await screen.findByRole('heading', { name: 'Priority', level: 1 })
    await waitFor(() => expect(container.querySelector('[data-panel="value-table"][data-readonly="true"][data-state="ready"]')).not.toBeNull())
    expect(container.querySelector('[data-badge="common"]')).toHaveTextContent('Common list')
    expect(container.querySelector('[data-editable="false"]')).toHaveTextContent('Read-only for you')
    const notice = container.querySelector('[data-readonly-notice="platform"]')!
    expect(notice).toHaveAttribute('role', 'note')
    expect(notice).toHaveTextContent(/fork/i)
    expect(container.querySelector('[data-owner-org="platform"]')).toBeInTheDocument()
    expect(container.querySelector('[data-item="sli1"]')).toBeInTheDocument()
    const archived = container.querySelector('[data-item="sli3"][data-archived="true"]')!
    expect(archived).toHaveTextContent(/archived/i)
    expect(container.querySelector('[data-item="sli2"] [data-machine="true"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fork priority' })).toHaveAttribute('data-action', 'fork-to-edit')
    // the service accepts active|archived only (status=all is a 400): both are read
    expect(itemsOf(api, COMMON_ID).map(c => c.query.get('status')).sort()).toEqual(['active', 'archived'])
    expect(itemsOf(api, COMMON_ID).every(c => c.query.get('status') !== 'all')).toBe(true)
    const lookup = api.callsTo('GET', LISTS).find(c => c.query.get('key') === 'priority')!
    expect(lookup.query.get('include_shared')).toBe('true')
    expect(lookup.query.get('limit')).toBe('1')
  })

  it('read-only means ABSENT: no add / drag / edit / archive / purge / Access tab, and /access is never read', async () => {
    const api = setup()
    const { container } = mount(COMMON_ID, { forkAction: true })
    await waitFor(() => expect(container.querySelector('[data-state="ready"]')).not.toBeNull())
    for (const hook of ['[data-action="add-value"]', '[data-drag-handle]', '[data-action="archive-value"]', '[data-action="purge-value"]', '[data-tab="access"]']) {
      expect(container.querySelector(hook), hook).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
    expect(api.callsTo('GET', `${LISTS}/${COMMON_ID}/access`)).toHaveLength(0)
    expect(screen.getByRole('tab', { name: 'Values' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Translations' })).toHaveAttribute('aria-selected', 'false')
  })

  it('without a fork slot there is no CTA at all (the fork flow supplies it)', async () => {
    setup()
    const { container } = mount(COMMON_ID)
    await waitFor(() => expect(container.querySelector('[data-state="ready"]')).not.toBeNull())
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
  })

  it('waits for the effective-list answer: no badge, notice or CTA until it lands', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, common),
      onItems(`${LISTS}/${COMMON_ID}/items`, items),
      onGet(LISTS, req => (req.query.get('key') ? gate.then(() => ({ body: page([common]) })) : undefined))
    )
    const { container } = mount(COMMON_ID, { forkAction: true })
    await waitFor(() => expect(container.querySelector('[data-panel="value-table"]')).toHaveAttribute('data-state', 'loading'))
    await act(async () => {
      await new Promise(r => setTimeout(r, 30))
    })
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
    expect(container.querySelector('[data-readonly-notice]')).toBeNull()
    expect(container.querySelector('[data-badge]')).toBeNull()
    await act(async () => release())
    await screen.findByRole('button', { name: 'Fork priority' })
  })

  it('a failed lookup keeps the plain notice, offers no CTA, and Retry restores it', async () => {
    let fail = true
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, common),
      onItems(`${LISTS}/${COMMON_ID}/items`, items),
      onGet(LISTS, req => (req.query.get('key') ? (fail ? { status: 500, body: {} } : { body: page([common]) }) : undefined))
    )
    const { container } = mount(COMMON_ID, { forkAction: true })
    await waitFor(() => expect(container.querySelector('[data-readonly-notice="platform"]')).not.toBeNull())
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
    fail = false
    await userEvent.click(container.querySelector('[data-readonly-notice] [data-action="retry"]')!)
    await screen.findByRole('button', { name: 'Fork priority' })
  })

  it('the lookup answering "no list" gives the plain notice and no CTA', async () => {
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, common), onItems(`${LISTS}/${COMMON_ID}/items`, items), effective([]))
    const { container } = mount(COMMON_ID, { forkAction: true })
    await waitFor(() => expect(container.querySelector('[data-readonly-notice="platform"]')).not.toBeNull())
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
  })

  it('already replaced: the shadowed notice with "Open your version"; no Fork CTA', async () => {
    const mine = makeForkList({ id: FORK_ID })
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, common), onItems(`${LISTS}/${COMMON_ID}/items`, items), effective([mine]))
    const { container } = mount(COMMON_ID, { forkAction: true })
    const notice = await waitFor(() => {
      const el = container.querySelector('[data-readonly-notice="shadowed"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(notice).toHaveTextContent(/uses its own version of this list/i)
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
    expect(container.querySelector('[data-action="open-own-version"]')).toHaveAttribute('href', `/settings/selection-lists/${FORK_ID}`)
  })
})

describe('org list, read-only (frame 03)', () => {
  it('shows the org notice and owner hint with no effective-list lookup and no Fork', async () => {
    const lead = makeSharedList({ id: 'lead', key: 'lead-sources', name: 'Lead sources', visibility: 'org', editable: false })
    const api = stubApi(onGet(`${LISTS}/lead`, lead), onGet(`${LISTS}/lead/items`, page([])))
    const { container } = mount('lead', { forkAction: true })
    await waitFor(() => expect(container.querySelector('[data-readonly-notice="org"]')).not.toBeNull())
    expect(container.querySelector('[data-visibility="org"]')).toBeInTheDocument()
    expect(container.querySelector('[data-owner-hint][data-created-by-kind="user"]')).toBeInTheDocument()
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
    expect(container.querySelector('[data-panel="list-facts"]')).toBeNull()
    expect(api.callsTo('GET', LISTS).filter(c => c.query.get('key'))).toHaveLength(0)
  })
})

describe('value table states (frame 03)', () => {
  const lead = makeSharedList({ id: 'lead', key: 'lead-sources', name: 'Lead sources', visibility: 'org', editable: false })

  it('empty: "No values to pick from" and no add CTA', async () => {
    stubApi(onGet(`${LISTS}/lead`, lead), onGet(`${LISTS}/lead/items`, page([])))
    const { container } = mount('lead')
    const empty = await waitFor(() => {
      const el = container.querySelector('[data-panel="value-table"][data-state="empty"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(empty).toHaveTextContent(/no values to pick from/i)
    expect(container.querySelector('[data-action="add-value"]')).toBeNull()
  })

  it('error: Retry in place, the badge and notice are kept', async () => {
    let fail = true
    stubApi(onGet(`${LISTS}/lead`, lead), onGet(`${LISTS}/lead/items`, req => (fail ? { status: 500, body: {} } : { body: page(items.filter(i => i.status === (req.query.get('status') ?? 'active'))) })))
    const { container } = mount('lead')
    await waitFor(() => expect(container.querySelector('[data-panel="value-table"][data-state="error"]')).not.toBeNull())
    expect(container.querySelector('[data-readonly-notice="org"]')).not.toBeNull()
    expect(container.querySelector('[data-visibility="org"]')).not.toBeNull()
    fail = false
    await userEvent.click(container.querySelector('[data-panel="value-table"] [data-action="retry"]')!)
    await waitFor(() => expect(container.querySelector('[data-item="sli1"]')).not.toBeNull())
  })

  it('follows the cursor envelope with "Load more values", keeping rows on a failed page', async () => {
    let fail = true
    const api = stubApi(
      onGet(`${LISTS}/lead`, lead),
      onGet(`${LISTS}/lead/items`, req => {
        if (req.query.get('status') === 'archived') return { body: page([items[2]]) }
        if (req.query.get('cursor') !== 'n1') return { body: page([items[0]], 'n1') }
        return fail ? { status: 500, body: {} } : { body: page([items[1]]) }
      })
    )
    const { container } = mount('lead')
    await waitFor(() => expect(container.querySelector('[data-action="load-more-values"]')).not.toBeNull())
    await userEvent.click(container.querySelector('[data-action="load-more-values"]')!)
    await screen.findByText("Couldn't load values")
    expect(container.querySelector('[data-item="sli1"]')).not.toBeNull()
    fail = false
    await userEvent.click(container.querySelector('[data-action="load-more-values"]')!)
    await waitFor(() => expect(container.querySelector('[data-item="sli2"]')).not.toBeNull())
    expect(container.querySelector('[data-action="load-more-values"]')).toBeNull()
    // active values first, archived after
    expect(Array.from(container.querySelectorAll('[data-item]')).map(n => n.getAttribute('data-item'))).toEqual(['sli1', 'sli2', 'sli3'])
    expect(itemsOf(api, 'lead').filter(c => c.query.get('status') === 'active').map(c => c.query.get('cursor'))).toEqual([null, 'n1', 'n1'])
  })
})

describe('list-level states', () => {
  it('loading shows the skeleton and no badge / notice / CTA / editable marker', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, () => gate.then(() => ({ body: makeCommonList() }))))
    const { container } = mount(COMMON_ID)
    const panel = container.querySelector('[data-panel="value-table"]')!
    expect(panel).toHaveAttribute('data-state', 'loading')
    expect(panel.querySelector('[aria-busy="true"]')).not.toBeNull()
    for (const hook of ['[data-badge]', '[data-readonly-notice]', '[data-action="fork-to-edit"]', '[data-editable]']) {
      expect(container.querySelector(hook), hook).toBeNull()
    }
    await act(async () => release())
  })

  it('404 is "List not found" — never a permission message', async () => {
    stubApi()
    const { container } = mount(COMMON_ID)
    const nf = await waitFor(() => {
      const el = container.querySelector('[data-panel="value-table"][data-state="not-found"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(container.querySelector('[data-error="NOT_FOUND"]')).toHaveTextContent(/list not found|no list with that id/i)
    expect(nf).toHaveTextContent('List not found')
    expect(document.body.textContent).not.toMatch(/forbidden|403|permission/i)
    expect(within(nf as HTMLElement).getByRole('link', { name: 'Back to all lists' })).toHaveAttribute('href', '/settings/selection-lists')
  })

  it('a 500 is an error with Retry', async () => {
    let fail = true
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, () => (fail ? { status: 500, body: {} } : { body: makeCommonList({ editable: true }) })))
    const { container } = mount(COMMON_ID)
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).not.toBeNull())
    fail = false
    await userEvent.click(container.querySelector('[data-action="retry"]')!)
    await screen.findByTestId('editor')
  })

  it('editable true: the 4.0.0 editor with the visibility / fork / access markers', async () => {
    stubApi(onGet(`${LISTS}/${FORK_ID}`, makeForkList({ editable: true })))
    const { container, renderEditor } = mount(FORK_ID)
    const header = await screen.findByTestId('header')
    expect(header.querySelector('[data-visibility="org"]')).not.toBeNull()
    expect(header.querySelector('[data-badge="fork"]')).not.toBeNull()
    expect(header.querySelector('[data-editable="true"]')).not.toBeNull()
    expect(renderEditor).toHaveBeenCalled()
    expect(container.querySelector('[data-readonly-notice]')).toBeNull()
  })

  it('editable absent: the 4.0.0 editor untouched — no marker, no notice, no CTA', async () => {
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, makeCommonList({ editable: undefined, visibility: undefined })))
    const { container } = mount(COMMON_ID, { forkAction: true })
    await screen.findByTestId('editor')
    expect(screen.getByTestId('editor')).toHaveTextContent('no header')
    expect(container.querySelector('[data-panel="value-table"]')).toHaveAttribute('data-state', 'editable-unknown')
    expect(container.querySelector('[data-editable]')).toBeNull()
    expect(container.querySelector('[data-readonly-notice]')).toBeNull()
    expect(container.querySelector('[data-action="fork-to-edit"]')).toBeNull()
  })
})

describe('navigation', () => {
  it('the Translations tab and the breadcrumb call back', async () => {
    const common = makeCommonList()
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, common), onItems(`${LISTS}/${COMMON_ID}/items`, items), effective([common]))
    const { onOpenTranslations } = mount(COMMON_ID)
    await userEvent.click(await screen.findByRole('tab', { name: 'Translations' }))
    expect(onOpenTranslations).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('tab', { name: 'Values' }))
    expect(onOpenTranslations).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('link', { name: 'Selection Lists' }))
  })
})

