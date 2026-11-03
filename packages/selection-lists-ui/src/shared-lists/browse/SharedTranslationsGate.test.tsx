import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onGet, onItems, renderShared, stubApi } from '../../test/browseHarness'
import { COMMON_ID, makeCommonList, makeSharedList } from '../../test/sharedListsFixtures'
import { isRtlLocale, languageName } from './ReadOnlyTranslations'
import { SharedTranslationsGate } from './SharedTranslationsGate'

afterEach(() => vi.unstubAllGlobals())

const LISTS = '/v1/selection-lists'
// GET …/translations answers a top-level ARRAY (TranslationLocaleStatus); the source locale is never in it.
const index = [
  { locale: 'fr', completeness_pct: 100, machine_translated: true, source_changed: true },
  { locale: 'he', completeness_pct: 60, machine_translated: false, source_changed: false },
]
const TEXT: Record<string, Record<string, string>> = {
  en: { sli1: 'Low', sli2: 'Normal', sli3: 'High' },
  fr: { sli1: 'Basse', sli2: 'Normale' },
  he: { sli1: 'נמוכה', sli2: 'רגילה', sli3: 'גבוהה' },
}
const items = [1, 2, 3].map(n => ({ id: `sli${n}`, list_id: COMMON_ID, code: ['LOW', 'NORMAL', 'HIGH'][n - 1], label: '', is_machine: false, status: 'active', sort_order: n, source_hash: 'h' }))
/** `?locale=` resolution as the service does it: the locale's text, else the source's with resolved_locale 'en'. */
const resolveItem = (row: (typeof items)[number], locale: string | null) => {
  const own = locale ? TEXT[locale]?.[row.id] : undefined
  return {
    ...row,
    label: own ?? TEXT.en[row.id],
    resolved_locale: own ? locale : 'en',
    is_machine: locale === 'fr' && row.id === 'sli2',
  }
}

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
  onItems(`${LISTS}/${COMMON_ID}/items`, items, resolveItem as never),
  onGet(`${LISTS}/${COMMON_ID}/translations`, index),
]

describe('read-only locale index', () => {
  it('source first without a link; translated locales link; M badge and notes; no mutation controls', async () => {
    const api = stubApi(...base())
    const { container, onOpenLocale, onOpenValues } = mount()
    const panel = await waitFor(() => {
      const el = container.querySelector('[data-panel="locale-index"][data-readonly="true"][data-state="ready"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(panel.querySelector('[data-locale="en"]')).toHaveTextContent(/English.*\(source\)/)
    expect(panel.querySelector('[data-locale-link="en"]')).toBeNull()
    expect(panel.querySelector('[data-action="open-locale-readonly"][data-locale-link="fr"]')).toHaveAttribute('href', '/t/fr')
    expect(panel.querySelector('[data-locale="fr"]')).toHaveTextContent('100%')
    expect(panel.querySelector('[data-locale="fr"]')).toHaveTextContent('machine-translated')
    expect(panel.querySelector('[data-locale="fr"]')).toHaveTextContent('Source changed')
    expect(panel.querySelector('[data-locale="he"]')).toHaveTextContent('60%')
    expect(panel.querySelector('[data-locale="he"] [data-machine]')).toBeNull()
    expect(panel.querySelector('[data-machine="true"]')).toBeInTheDocument()
    for (const hook of ['start-translation', 'autofill', 'add-language']) {
      expect(container.querySelector(`[data-action="${hook}"]`)).toBeNull()
    }
    expect(api.callsTo('GET', `${LISTS}/${COMMON_ID}/translations`)).toHaveLength(1)
    await userEvent.click(panel.querySelector('[data-locale-link="he"]')!)
    expect(onOpenLocale).toHaveBeenCalledWith('he')
    expect(screen.getByRole('tab', { name: 'Translations' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Values' }))
    expect(onOpenValues).toHaveBeenCalled()
  })

  it('a list with no translated locale still shows its source row; a failed read has Retry', async () => {
    let mode: 'empty' | 'fail' | 'ok' = 'empty'
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/translations`, () =>
        mode === 'fail' ? { status: 500, body: {} } : { body: mode === 'empty' ? [] : index }
      )
    )
    const { container, unmount } = mount()
    await waitFor(() => expect(container.querySelector('[data-panel="locale-index"][data-state="ready"] [data-locale="en"]')).not.toBeNull())
    expect(container.querySelectorAll('[data-locale]')).toHaveLength(1)
    unmount()
    mode = 'fail'
    const second = mount()
    await waitFor(() => expect(second.container.querySelector('[data-panel="locale-index"][data-state="error"]')).not.toBeNull())
    mode = 'ok'
    await userEvent.click(second.container.querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(second.container.querySelector('[data-state="ready"]')).not.toBeNull())
  })

  it('a malformed answer (not an array) is an error, never a silently empty index', async () => {
    stubApi(onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()), onGet(`${LISTS}/${COMMON_ID}/translations`, { locales: [] }))
    const { container } = mount()
    await waitFor(() => expect(container.querySelector('[data-panel="locale-index"][data-state="error"]')).not.toBeNull())
  })
})

describe('read-only locale view', () => {
  it('reads the locale through the items endpoint: code, source text, translation, M badge and fallback note — no inputs', async () => {
    const api = stubApi(...base())
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
    const row = (id: string) => view.querySelector(`[data-translation="${id}"]`)!
    expect(row('sli1')).toHaveTextContent('LOW')
    expect(row('sli1')).toHaveTextContent('Low')
    expect(row('sli1')).toHaveTextContent('Basse')
    expect(row('sli2').querySelector('[data-machine="true"]')).toBeInTheDocument()
    expect(row('sli3')).toHaveTextContent('Falls back to the source language')
    expect(row('sli3').querySelector('[data-machine]')).toBeNull()
    expect(view.querySelector('td[dir="rtl"]')).toBeNull()
    // never GET …/translations/:locale (the service does not implement it) and never status=all
    expect(api.callsTo('GET', `${LISTS}/${COMMON_ID}/translations/fr`)).toHaveLength(0)
    const reads = api.callsTo('GET', `${LISTS}/${COMMON_ID}/items`)
    expect(reads.map(c => c.query.get('locale')).sort()).toEqual(['en', 'fr'])
    expect(reads.every(c => c.query.get('status') === 'active')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: '← All languages' }))
    expect(onBackToLocales).toHaveBeenCalled()
  })

  it('a Hebrew target cell is dir="rtl"', async () => {
    stubApi(...base())
    const { container } = mount('he')
    await waitFor(() => expect(container.querySelector('[data-locale-view="he"] td[dir="rtl"]')).toHaveTextContent('נמוכה'))
  })

  it('follows the items cursor to the end, for both columns', async () => {
    const api = stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/items`, req => {
        const locale = req.query.get('locale')
        const rows = (ids: string[]) => ids.map(id => resolveItem(items.find(i => i.id === id)!, locale))
        return req.query.get('cursor') === 'n1'
          ? { body: { items: rows(['sli2']), page: { nextCursor: null, hasMore: false } } }
          : { body: { items: rows(['sli1']), page: { nextCursor: 'n1', hasMore: true } } }
      })
    )
    const { container } = mount('fr')
    await waitFor(() => expect(container.querySelectorAll('[data-translation]')).toHaveLength(2))
    expect(api.callsTo('GET', `${LISTS}/${COMMON_ID}/items`).filter(c => c.query.get('cursor') === 'n1')).toHaveLength(2)
  })

  it('a list with no active values says so; a failed read has Retry', async () => {
    let fail = false
    stubApi(
      onGet(`${LISTS}/${COMMON_ID}`, makeCommonList()),
      onGet(`${LISTS}/${COMMON_ID}/items`, () => (fail ? { status: 500, body: {} } : { body: { items: [], page: { nextCursor: null, hasMore: false } } }))
    )
    const first = mount('fr')
    await waitFor(() => expect(first.container.querySelector('[data-locale-view="fr"][data-state="empty"]')).toBeInTheDocument())
    first.unmount()
    fail = true
    const second = mount('fr')
    await waitFor(() => expect(second.container.querySelector('[data-state="error"]')).toHaveTextContent("Couldn't load translations"))
    fail = false
    await userEvent.click(second.container.querySelector('[data-action="retry"]')!)
    await waitFor(() => expect(second.container.querySelector('[data-locale-view="fr"][data-state="empty"]')).toBeInTheDocument())
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
