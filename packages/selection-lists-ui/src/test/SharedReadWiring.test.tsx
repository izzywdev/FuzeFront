/**
 * Flow wiring for the shared-read flow: the 4.0.0 orchestrators mount the
 * browse components ONLY while the release flag is ON, and are untouched while
 * it is OFF. `fetch` is the boundary (the real `api.ts` runs).
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionListManagementFlow } from '../SelectionListManagementFlow'
import { TranslationWorkbenchFlow } from '../TranslationWorkbenchFlow'
import { onGet, page, renderShared, stubApi } from './browseHarness'
import {
  COMMON_ID,
  makeCommonList,
  makeSharedList,
} from './sharedListsFixtures'

afterEach(() => vi.unstubAllGlobals())

const LISTS = '/v1/selection-lists'
const INDEX = '/settings/selection-lists'
const DETAIL = `${INDEX}/:listId`
const quotaWire = {
  organization_id: 'org_1',
  quotas: [
    { scope: 'org_lists', applies_to: 'organization', limit: 100, current: 37 },
    { scope: 'list_items', applies_to: 'list', limit: 1000, current: null },
  ],
}

describe('index', () => {
  const rows = [
    makeSharedList({ id: 'l1', key: 'zones', name: 'Zones', visibility: 'private', editable: true }),
    makeCommonList({ id: 'c1', key: 'yes-no', name: 'Yes / No' }),
  ]

  it('flag ON: the shared panel, include_shared=true, and the real quota envelope does not crash', async () => {
    const api = stubApi(onGet(LISTS, page(rows)), onGet(`${LISTS}/quota`, quotaWire))
    const { container } = renderShared(<SelectionListManagementFlow />, INDEX, { routePaths: [INDEX, DETAIL] })
    await waitFor(() => expect(container.querySelector('[data-group="common"]')).not.toBeNull())
    expect(api.callsTo('GET', LISTS)[0].query.get('include_shared')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Include common lists' })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-quota-scope="org_lists"]')).toHaveTextContent('37 / 100'))
    expect(container.querySelector('[data-quota-scope="list_items"]')).toHaveTextContent('— / 1000')
    // exactly ONE list request per query: the 4.0.0 loader is not also running
    expect(api.callsTo('GET', LISTS)).toHaveLength(1)
  })

  it('flag ON: a failed quota read never disables New list; at the limit it does', async () => {
    stubApi(onGet(LISTS, page(rows)))
    const first = renderShared(<SelectionListManagementFlow />, INDEX, { routePaths: [INDEX, DETAIL] })
    await waitFor(() => expect(first.container.querySelector('[data-quota-scope], [data-panel="quota"] [data-state="error"]')).not.toBeNull())
    expect(screen.getAllByRole('button', { name: 'New list' })[0]).toBeEnabled()
    first.unmount()
    vi.unstubAllGlobals()
    stubApi(
      onGet(LISTS, page(rows)),
      onGet(`${LISTS}/quota`, { quotas: [{ scope: 'org_lists', limit: 10, current: 10 }] })
    )
    renderShared(<SelectionListManagementFlow />, INDEX, { routePaths: [INDEX, DETAIL] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'New list' })).toBeDisabled())
  })

  it('flag ON: opening a row and New list navigate / switch panels', async () => {
    stubApi(onGet(LISTS, page(rows)), onGet(`${LISTS}/quota`, quotaWire))
    renderShared(<SelectionListManagementFlow />, INDEX, { routePaths: [INDEX, DETAIL] })
    await userEvent.click(await screen.findByRole('link', { name: 'Zones' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`${INDEX}/l1`)
  })

  it('flag ON: New list opens the 4.0.0 create form', async () => {
    stubApi(onGet(LISTS, page(rows)), onGet(`${LISTS}/quota`, quotaWire))
    renderShared(<SelectionListManagementFlow />, INDEX, { routePaths: [INDEX, DETAIL] })
    await userEvent.click(await screen.findByRole('button', { name: 'New list' }))
    expect(await screen.findByText('New selection list')).toBeInTheDocument()
  })

  it('flag OFF: the 4.0.0 index — no switch, no groups, neither param sent', async () => {
    const api = stubApi(onGet(LISTS, page(rows)), onGet(`${LISTS}/quota`, quotaWire))
    const { container } = renderShared(<SelectionListManagementFlow />, INDEX, {
      routePaths: [INDEX, DETAIL],
      sharedLists: false,
    })
    await waitFor(() => expect(container.querySelector('[data-list="zones"]')).not.toBeNull())
    expect(container.querySelector('[data-control="include-shared"], [data-group], [data-badge], [data-filter="visibility"]')).toBeNull()
    for (const call of api.callsTo('GET', LISTS)) {
      expect(call.query.has('include_shared')).toBe(false)
      expect(call.query.has('visibility')).toBe(false)
    }
  })
})

describe('detail', () => {
  it('flag ON, read-only common list: the read-only detail', async () => {
    const common = makeCommonList()
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, common),
      onGet(`${LISTS}/${COMMON_ID}/items`, page([])),
      onGet(LISTS, page([common]))
    )
    const { container } = renderShared(<SelectionListManagementFlow />, `${INDEX}/${COMMON_ID}`, { routePaths: [INDEX, DETAIL] })
    await waitFor(() => expect(container.querySelector('[data-readonly-notice="platform"]')).not.toBeNull())
    expect(container.querySelector('[data-panel="value-editor"]')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Translations' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`${INDEX}/${COMMON_ID}/translations`)
  })

  it('flag ON, shadowed: "Open your version" navigates to the own list', async () => {
    const common = makeCommonList()
    const mine = makeSharedList({ id: 'mine', key: 'priority', name: 'Priority', editable: true })
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, common),
      onGet(`${LISTS}/${COMMON_ID}/items`, page([])),
      onGet(LISTS, page([mine]))
    )
    renderShared(<SelectionListManagementFlow />, `${INDEX}/${COMMON_ID}`, { routePaths: [INDEX, DETAIL] })
    await userEvent.click(await screen.findByRole('link', { name: 'Open your version' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`${INDEX}/mine`)
  })

  it('flag ON, breadcrumb and 404 link go back to the index', async () => {
    stubApi()
    renderShared(<SelectionListManagementFlow />, `${INDEX}/${COMMON_ID}`, { routePaths: [INDEX, DETAIL] })
    await userEvent.click(await screen.findByRole('link', { name: 'Back to all lists' }))
    expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`${INDEX}$`))
  })

  it('flag ON, editable list: the 4.0.0 editor with the shared markers in its header', async () => {
    const mine = makeSharedList({ id: 'mine', key: 'priority', name: 'Priority', editable: true, visibility: 'org' })
    stubApi(
      onGet(`${LISTS}/mine`, mine),
      onGet(`${LISTS}/mine/items`, page([])),
    )
    const { container } = renderShared(<SelectionListManagementFlow />, `${INDEX}/mine`, { routePaths: [INDEX, DETAIL] })
    await waitFor(() => expect(container.querySelector('[data-panel="value-editor"]')).not.toBeNull())
    expect(container.querySelector('[data-visibility="org"]')).not.toBeNull()
    expect(container.querySelector('[data-editable="true"]')).not.toBeNull()
    expect(container.querySelector('[data-action="add-value"]')).not.toBeNull()
  })

  it('flag OFF: the 4.0.0 detail, and no effective-list lookup', async () => {
    const mine = makeSharedList({ id: 'mine', key: 'priority', editable: false })
    const api = stubApi(onGet(`${LISTS}/mine`, mine), onGet(`${LISTS}/mine/items`, page([])))
    const { container } = renderShared(<SelectionListManagementFlow />, `${INDEX}/mine`, {
      routePaths: [INDEX, DETAIL],
      sharedLists: false,
    })
    await waitFor(() => expect(container.querySelector('[data-panel="value-editor"]')).not.toBeNull())
    expect(container.querySelector('[data-readonly-notice], [data-badge], [data-visibility]')).toBeNull()
    expect(container.querySelector('[data-action="add-value"]')).not.toBeNull()
    expect(api.callsTo('GET', LISTS)).toHaveLength(0)
  })
})

describe('translation workbench', () => {
  const T_INDEX = `${INDEX}/:listId/translations`
  const T_LOCALE = `${INDEX}/:listId/translations/:locale`
  // The service answers an array of TranslationLocaleStatus (no source locale).
  const locales = [{ locale: 'fr', completeness_pct: 100, machine_translated: false, source_changed: false }]
  const legacyLocales = {
    locales: [
      { locale: 'en', is_source: true, translated: 1, total: 1, machine_count: 0, stale_count: 0 },
      { locale: 'fr', is_source: false, translated: 1, total: 1, machine_count: 0, stale_count: 0 },
    ],
  }

  it('flag ON, read-only list: the read-only locale index; a locale link opens the view; breadcrumb returns', async () => {
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/translations`, locales),
      onGet(`${LISTS}/${COMMON_ID}/items`, page([]))
    )
    const { container } = renderShared(<TranslationWorkbenchFlow />, `${INDEX}/${COMMON_ID}/translations`, {
      routePaths: [T_INDEX, T_LOCALE],
    })
    await waitFor(() => expect(container.querySelector('[data-panel="locale-index"][data-readonly="true"][data-state="ready"]')).not.toBeNull())
    await userEvent.click(container.querySelector('[data-locale-link="fr"]')!)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${INDEX}/${COMMON_ID}/translations/fr`))
    await waitFor(() => expect(container.querySelector('[data-panel="locale-editor"][data-readonly="true"]')).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: '← All languages' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`${COMMON_ID}/translations$`)))
    await userEvent.click(await screen.findByRole('tab', { name: 'Values' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`${INDEX}/${COMMON_ID}$`)))
  })

  it('flag ON, back to the list index from the breadcrumb', async () => {
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()), onGet(`${LISTS}/${COMMON_ID}/translations`, locales))
    renderShared(<TranslationWorkbenchFlow />, `${INDEX}/${COMMON_ID}/translations`, { routePaths: [T_INDEX, T_LOCALE] })
    await userEvent.click(await screen.findByRole('link', { name: 'Selection Lists' }))
    expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`${INDEX}$`))
  })

  it.each([
    ['editable list', makeSharedList({ id: COMMON_ID, editable: true })],
    ['list with editable absent', makeSharedList({ id: COMMON_ID, editable: undefined })],
  ])('flag ON, %s: the 4.0.0 workbench (index and locale editor)', async (_name, list) => {
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, list),
      onGet(`${LISTS}/${COMMON_ID}/translations`, legacyLocales),
      onGet(`${LISTS}/${COMMON_ID}/translations/fr`, { locale: 'fr', translations: [{ item_id: 'sli1', locale: 'fr', label: 'Basse', is_machine: false, source_hash: 'h', source_hash_current: 'h' }] })
    )
    const first = renderShared(<TranslationWorkbenchFlow />, `${INDEX}/${COMMON_ID}/translations`, { routePaths: [T_INDEX, T_LOCALE] })
    await waitFor(() => expect(first.container.querySelector('[data-panel="translation-index"]')).not.toBeNull())
    first.unmount()
    const second = renderShared(<TranslationWorkbenchFlow />, `${INDEX}/${COMMON_ID}/translations/fr`, { routePaths: [T_INDEX, T_LOCALE] })
    await waitFor(() => expect(second.container.querySelector('[data-action="save-row"]')).not.toBeNull())
  })

  it('flag OFF: the 4.0.0 workbench with no list read at all', async () => {
    const api = stubApi(onGet(`${LISTS}/${COMMON_ID}/translations`, legacyLocales))
    const { container } = renderShared(<TranslationWorkbenchFlow />, `${INDEX}/${COMMON_ID}/translations`, {
      routePaths: [T_INDEX, T_LOCALE],
      sharedLists: false,
    })
    await waitFor(() => expect(container.querySelector('[data-panel="translation-index"]')).not.toBeNull())
    expect(api.callsTo('GET', `${LISTS}/${COMMON_ID}`)).toHaveLength(0)
  })
})
