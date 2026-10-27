import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onGet, page, renderShared, stubApi } from '../../test/browseHarness'
import { COMMON_ID, makeCommonList, makeSharedList } from '../../test/sharedListsFixtures'
import { isRtlLocale, languageName } from './ReadOnlyTranslations'
import { SharedTranslationsGate } from './SharedTranslationsGate'

afterEach(() => vi.unstubAllGlobals())

const LISTS = '/v1/selection-lists'
const index = {
  locales: [
    { locale: 'en', is_source: true, translated: 5, total: 5, machine_count: 0, stale_count: 0 },
    { locale: 'fr', is_source: false, translated: 5, total: 5, machine_count: 2, stale_count: 1 },
    { locale: 'he', is_source: false, translated: 5, total: 5, machine_count: 0, stale_count: 0 },
  ],
}
const editor = (locale: string) => ({
  locale,
  translations: [
    { item_id: 'sli1', locale, label: locale === 'he' ? 'נמוכה' : 'Basse', is_machine: false, source_hash: 'h1', source_hash_current: 'h1' },
    { item_id: 'sli2', locale, label: 'Normale', is_machine: true, source_hash: 'h2', source_hash_current: 'h2' },
    { item_id: 'sli3', locale, label: '', is_machine: false, source_hash: 'h3', source_hash_current: 'h3x' },
  ],
})
const items = [1, 2, 3].map(n => ({ id: `sli${n}`, list_id: COMMON_ID, code: ['LOW', 'NORMAL', 'HIGH'][n - 1], label: 'x', is_machine: false, status: 'active', sort_order: n, source_hash: 'h' }))

function mount(locale?: string, nav = {}) {
  const handlers = {
    onOpenLocale: vi.fn(),
    onBackToLocales: vi.fn(),
    onOpenValues: vi.fn(),
    onBackToIndex: vi.fn(),
    ...nav,
  }
  const utils = renderShared(
    <SharedTranslationsGate
      listId={COMMON_ID}
      locale={locale}
      renderWorkbench={() => <div data-testid="workbench" />}
      hrefForLocale={l => `/t/${l}`}
      indexHref="/settings/selection-lists"
      {...handlers}
    />,
    '/x'
  )
  return { ...utils, ...handlers }
}

const base = () => [
  onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
  onGet(`${LISTS}/${COMMON_ID}/items`, page(items)),
  onGet(`${LISTS}/${COMMON_ID}/translations`, index),
  onGet(`${LISTS}/${COMMON_ID}/translations/fr`, editor('fr')),
  onGet(`${LISTS}/${COMMON_ID}/translations/he`, editor('he')),
]

describe('read-only locale index', () => {
  it('has no mutation controls; translated locales link, the source does not; M badge kept', async () => {
    stubApi(...base())
    const { container, onOpenLocale, onOpenValues } = mount()
    const panel = await waitFor(() => {
      const el = container.querySelector('[data-panel="locale-index"][data-readonly="true"][data-state="ready"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(panel.querySelector('[data-locale="en"]')).toHaveTextContent('English')
    expect(panel.querySelector('[data-locale-link="en"]')).toBeNull()
    expect(panel.querySelector('[data-action="open-locale-readonly"][data-locale-link="fr"]')).toHaveAttribute('href', '/t/fr')
    expect(panel.querySelector('[data-machine="true"]')).toBeInTheDocument()
    expect(panel).toHaveTextContent('2 machine')
    expect(panel).toHaveTextContent('1 stale')
    for (const hook of ['start-translation', 'autofill', 'add-language']) {
      expect(container.querySelector(`[data-action="${hook}"]`)).toBeNull()
    }
    await userEvent.click(panel.querySelector('[data-locale-link="he"]')!)
    expect(onOpenLocale).toHaveBeenCalledWith('he')
    expect(screen.getByRole('tab', { name: 'Translations' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Values' }))
    expect(onOpenValues).toHaveBeenCalled()
  })

  it('empty, and error with Retry', async () => {
    let mode: 'empty' | 'fail' | 'ok' = 'empty'
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/translations`, () =>
        mode === 'fail' ? { status: 500, body: {} } : { body: mode === 'empty' ? { locales: [] } : index }
      )
    )
    const { container, unmount } = mount()
    await waitFor(() => expect(container.querySelector('[data-panel="locale-index"][data-state="empty"]')).not.toBeNull())
    unmount()
    mode = 'fail'
    const second = mount()
    await waitFor(() => expect(second.container.querySelector('[data-panel="locale-index"][data-state="error"]')).not.toBeNull())
    mode = 'ok'
    await userEvent.click(second.container.querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(second.container.querySelector('[data-state="ready"]')).not.toBeNull())
  })
})

describe('read-only locale view', () => {
  it('plain text, codes from the items, M badge, stale and fallback notes — no inputs or save controls', async () => {
    stubApi(...base())
    const { container, onBackToLocales } = mount('fr')
    const view = await waitFor(() => {
      const el = container.querySelector('[data-panel="locale-editor"][data-readonly="true"][data-locale-view="fr"][data-state="ready"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(view.querySelectorAll('input, textarea')).toHaveLength(0)
    for (const hook of ['save-row', 'save-all', 'mark-reviewed', 'autofill']) {
      expect(container.querySelector(`[data-action="${hook}"]`)).toBeNull()
    }
    await waitFor(() => expect(view).toHaveTextContent('LOW'))
    expect(view).toHaveTextContent('Basse')
    expect(view.querySelector('[data-machine="true"]')).toBeInTheDocument()
    expect(view).toHaveTextContent('Source changed')
    expect(view).toHaveTextContent('Falls back to the source language')
    expect(view.querySelector('td[dir="rtl"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '← All languages' }))
    expect(onBackToLocales).toHaveBeenCalled()
  })

  it('a Hebrew target cell is dir="rtl"', async () => {
    stubApi(...base())
    const { container } = mount('he')
    await waitFor(() => expect(container.querySelector('[data-locale-view="he"] td[dir="rtl"]')).toHaveTextContent('נמוכה'))
  })

  it('an empty locale, and a locale that is not translated yet (404) both say so', async () => {
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/translations/fr`, { locale: 'fr', translations: [] })
    )
    const { container, unmount } = mount('fr')
    await waitFor(() => expect(container.querySelector('[data-locale-view="fr"][data-state="empty"]')).toBeInTheDocument())
    unmount()
    const second = mount('de')
    await waitFor(() => expect(second.container.querySelector('[data-locale-view="de"][data-state="error"]')).toHaveTextContent('No translations yet'))
  })

  it('a failed read has Retry', async () => {
    let fail = true
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/translations/fr`, () => (fail ? { status: 500, body: {} } : { body: editor('fr') }))
    )
    const { container } = mount('fr')
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).toHaveTextContent("Couldn't load translations"))
    fail = false
    await userEvent.click(container.querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(container.querySelector('[data-locale-view="fr"][data-state="ready"]')).not.toBeNull())
  })
})

describe('the gate', () => {
  it('an editable list gets the 4.0.0 workbench; so does an unknown one', async () => {
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, makeSharedList({ id: COMMON_ID, editable: true })))
    const first = mount()
    await screen.findByTestId('workbench')
    first.unmount()
    vi.unstubAllGlobals()
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, makeSharedList({ id: COMMON_ID, editable: undefined })))
    mount()
    await screen.findByTestId('workbench')
  })

  it('loading, 404 (never a permission message) and error states', async () => {
    stubApi()
    const { container, unmount } = mount()
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    await waitFor(() => expect(container.querySelector('[data-state="not-found"] [data-error="NOT_FOUND"]')).not.toBeNull())
    expect(document.body.textContent).not.toMatch(/forbidden|403|permission/i)
    unmount()
    vi.unstubAllGlobals()
    let fail = true
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, () => (fail ? { status: 500, body: {} } : { body: makeSharedList({ id: COMMON_ID, editable: true }) })))
    const second = mount()
    await waitFor(() => expect(second.container.querySelector('[data-state="error"]')).not.toBeNull())
    fail = false
    await userEvent.click(second.container.querySelector('[data-action="retry"]')!)
    await screen.findByTestId('workbench')
  })
})

describe('locale helpers', () => {
  it('knows right-to-left languages, with or without a region', () => {
    expect(isRtlLocale('he')).toBe(true)
    expect(isRtlLocale('ar-EG')).toBe(true)
    expect(isRtlLocale('fr')).toBe(false)
  })

  it("names a language in its own language and falls back to the code", () => {
    expect(languageName('fr')).toMatch(/^Fran/)
    expect(languageName('xx-invalid-tag-')).toBe('xx-invalid-tag-')
    expect(languageName('zzz')).toBe('zzz')
  })
})
