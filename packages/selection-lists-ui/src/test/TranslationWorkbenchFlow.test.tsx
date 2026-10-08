/**
 * TranslationWorkbenchFlow — frames 07 (locale index), 08 (locale editor) and
 * 09 (autofill modal). `../api` is mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationWorkbenchFlow } from '../TranslationWorkbenchFlow'
import * as api from '../api'
import {
  apiError,
  deferred,
  makeLocale,
  makeTranslation,
  renderFlow,
  renderFlowSettled,
  NEVER,
} from './helpers'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    getLocaleIndex: vi.fn(),
    getLocaleEditor: vi.fn(),
    saveTranslation: vi.fn(),
    autofillTranslations: vi.fn(),
  }
})

const m = vi.mocked(api)

const INDEX = '/settings/selection-lists/:listId/translations'
const EDITOR = '/settings/selection-lists/:listId/translations/:locale'
const ROUTES = [INDEX, EDITOR]

const renderIndex = () => renderFlow(<TranslationWorkbenchFlow />, '/settings/selection-lists/sl_01/translations', ROUTES)
const renderEditor = (locale = 'fr') =>
  renderFlow(<TranslationWorkbenchFlow />, `/settings/selection-lists/sl_01/translations/${locale}`, ROUTES)

const q = (sel: string, root: ParentNode = document) => root.querySelector(sel)
const qa = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel))

/** A contract-shaped SelectionListAutofillResult. */
const RESULT = (items_translated: number, items_skipped: number) => ({
  locale: 'fr',
  source_locale: 'en',
  list_translated: false,
  items_translated,
  items_skipped,
})

const SOURCE = makeLocale({ locale: 'en', is_source: true, translated: 4, total: 4 })

beforeEach(() => {
  vi.resetAllMocks()
  m.getLocaleIndex.mockResolvedValue({ locales: [SOURCE, makeLocale({ locale: 'fr' })] })
  m.getLocaleEditor.mockResolvedValue({ locale: 'fr', translations: [makeTranslation()] })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 07 — locale index', () => {
  it('shows a loading placeholder while locales load', async () => {
    m.getLocaleIndex.mockReturnValue(NEVER)
    await renderFlowSettled(<TranslationWorkbenchFlow />, '/settings/selection-lists/sl_01/translations', ROUTES)
    expect(q('[data-panel="translation-index"] [data-state="loading"]')).toBeInTheDocument()
  })

  it('loads the index for the :listId route param', async () => {
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })
    expect(m.getLocaleIndex).toHaveBeenCalledWith('sl_01')
  })

  it('renders nothing when the route has no :listId', () => {
    const { container } = renderFlow(<TranslationWorkbenchFlow />, '/x')
    expect(q('[data-frame]', container)).toBeNull()
    expect(m.getLocaleIndex).not.toHaveBeenCalled()
  })

  it('marks the source locale, hides its actions, and states the fallback guarantee', async () => {
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })

    const source = q('[data-locale="en"]') as HTMLElement
    expect(source).toHaveAttribute('data-source', 'true')
    expect(source).toHaveTextContent('(source)')
    expect(q('[data-action="start-translation"]', source)).toBeNull()
    expect(q('[data-action="autofill"]', source)).toBeNull()
    expect(q('[data-note="fallback"]')).toHaveTextContent(/fall back to the source locale/i)
    expect(q('[data-note="fallback"]')).toHaveTextContent(/never renders blank/i)
  })

  it('shows translated/total + percentage, M count and stale count per locale', async () => {
    m.getLocaleIndex.mockResolvedValue({
      locales: [
        SOURCE,
        makeLocale({ locale: 'de', translated: 3, total: 4, machine_count: 2, stale_count: 1 }),
        makeLocale({ locale: 'fr', translated: 0, total: 4 }),
      ],
    })
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })

    const de = q('[data-locale="de"]') as HTMLElement
    expect(de).toHaveTextContent('75% (3/4)')
    expect(de).toHaveTextContent('2M')
    expect(de).toHaveTextContent('1 stale')
    expect(de).toHaveAttribute('data-machine', 'true')
    expect(de).toHaveAttribute('data-stale', 'true')
    expect(de).not.toHaveAttribute('data-untranslated')
    expect(within(de).getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    const fr = q('[data-locale="fr"]') as HTMLElement
    expect(fr).toHaveTextContent('0% (0/4)')
    expect(fr).toHaveAttribute('data-untranslated', 'true')
    expect(fr).not.toHaveAttribute('data-machine')
    expect(fr).not.toHaveAttribute('data-stale')
    expect(within(fr).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(fr).getByRole('button', { name: 'Autofill' })).toBeInTheDocument()
  })

  it('does not divide by zero for an empty list (total 0 -> 0%)', async () => {
    m.getLocaleIndex.mockResolvedValue({ locales: [makeLocale({ locale: 'fr', total: 0, translated: 0 })] })
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })
    expect(q('[data-locale="fr"]')).toHaveTextContent('0% (0/0)')
  })

  it('shows the empty state when there are no locales', async () => {
    m.getLocaleIndex.mockResolvedValue({ locales: [] })
    renderIndex()
    await waitFor(() => expect(q('[data-state="empty"]')).not.toBeNull())
    expect(q('[data-state="empty"]')).toHaveTextContent('No locales to translate.')
  })

  it('shows the error state and Retry reloads', async () => {
    const user = userEvent.setup()
    m.getLocaleIndex.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'index down'))
    renderIndex()
    await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
    expect(q('[data-state="error"]')).toHaveTextContent('index down')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Translations' })).toBeInTheDocument()
    expect(m.getLocaleIndex).toHaveBeenCalledTimes(2)
  })

  it('fail-closed: list_locales exhausted disables Start and Autofill on UNTRANSLATED locales only, with the reason shown', async () => {
    m.getLocaleIndex.mockResolvedValue({
      quota_exceeded: true,
      locales: [
        SOURCE,
        makeLocale({ locale: 'fr', translated: 0 }),
        makeLocale({ locale: 'de', translated: 2 }),
      ],
    })
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })

    expect(q('[data-error="QUOTA_EXCEEDED"]')).toHaveTextContent(/list_locales quota is exhausted/)
    const fr = q('[data-locale="fr"]') as HTMLElement
    expect(within(fr).getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(within(fr).getByRole('button', { name: 'Autofill' })).toBeDisabled()
    const de = q('[data-locale="de"]') as HTMLElement
    expect(within(de).getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(within(de).getByRole('button', { name: 'Autofill' })).toBeEnabled()
  })

  it('Start/Edit navigates to the locale editor', async () => {
    const user = userEvent.setup()
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/settings/selection-lists/sl_01/translations/fr',
    )
    expect(await screen.findByRole('heading', { name: 'FR translations' })).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 09 — autofill modal', () => {
  async function openAutofill(locales = [SOURCE, makeLocale({ locale: 'fr', translated: 1, total: 4 })]) {
    m.getLocaleIndex.mockResolvedValue({ locales })
    const user = userEvent.setup()
    renderIndex()
    await screen.findByRole('heading', { name: 'Translations' })
    await user.click(screen.getByRole('button', { name: 'Autofill' }))
    return { user, dialog: screen.getByRole('dialog') }
  }

  it('states the exact missing count and source locale, and the never-overwrite-human guarantee', async () => {
    const { dialog } = await openAutofill()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-modal', 'autofill')
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Autofill translations for FR')
    expect(q('[data-autofill-count]', dialog)).toHaveAttribute('data-autofill-count', '3')
    expect(q('[data-source-locale]', dialog)).toHaveTextContent('en')
    expect(dialog).toHaveTextContent(/never to be overwritten/)
    expect(dialog).toHaveTextContent(/enforced service-side/)
  })

  it('overwrite_machine defaults to false and is sent as chosen', async () => {
    m.autofillTranslations.mockResolvedValue(RESULT(3, 0))
    const { user, dialog } = await openAutofill()
    const box = within(dialog).getByRole('checkbox', { name: /Overwrite existing machine translations/ })
    expect(box).not.toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))
    await waitFor(() =>
      expect(m.autofillTranslations).toHaveBeenCalledWith('sl_01', 'fr', { overwrite_machine: false }),
    )
  })

  it('sends overwrite_machine: true only when the box is ticked', async () => {
    m.autofillTranslations.mockResolvedValue(RESULT(3, 0))
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))
    await waitFor(() =>
      expect(m.autofillTranslations).toHaveBeenCalledWith('sl_01', 'fr', { overwrite_machine: true }),
    )
  })

  it('disables the run button and checkbox while running', async () => {
    const d = deferred<ReturnType<typeof RESULT>>()
    m.autofillTranslations.mockReturnValue(d.promise)
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))

    expect(await within(dialog).findByRole('button', { name: 'Running…' })).toBeDisabled()
    expect(within(dialog).getByRole('checkbox')).toBeDisabled()
    expect(q('[data-state="running"]', dialog)).toHaveTextContent('Running autofill')
    expect(m.autofillTranslations).toHaveBeenCalledTimes(1)

    d.resolve(RESULT(3, 0))
    expect(await within(dialog).findByText(/Autofill complete: 3 translated/)).toBeInTheDocument()
  })

  it('on completion refreshes the locale index behind the still-open dialog; Close dismisses it', async () => {
    m.autofillTranslations.mockResolvedValue(RESULT(3, 1))
    const { user, dialog } = await openAutofill()
    expect(m.getLocaleIndex).toHaveBeenCalledTimes(1)
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))

    await waitFor(() => expect(m.getLocaleIndex).toHaveBeenCalledTimes(2))
    // the result is on screen and the dialog survived the refresh
    expect(await within(dialog).findByText(/Autofill complete: 3 translated/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // a finished run cannot be re-run from the same dialog
    expect(within(dialog).getByRole('button', { name: 'Run autofill' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a failed background refresh after completion does not unmount the dialog', async () => {
    m.autofillTranslations.mockResolvedValue(RESULT(3, 1))
    const { user, dialog } = await openAutofill()
    m.getLocaleIndex.mockRejectedValue(new Error('index down'))
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))
    expect(await within(dialog).findByText(/Autofill complete: 3 translated/)).toBeInTheDocument()
    await waitFor(() => expect(m.getLocaleIndex).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('index down')).toBeNull()
  })

  // Frame 09: "On completion the result reports items_translated, items_skipped…".
  it('shows the autofill result (translated / skipped) after completion', async () => {
    m.autofillTranslations.mockResolvedValue(RESULT(3, 1))
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))
    expect(await screen.findByText(/Autofill complete: 3 translated/)).toBeInTheDocument()
    expect(q('[data-items-skipped="1"]')).toHaveTextContent('1')
  })

  it('shows "all strings already translated" when nothing was filled', async () => {
    m.autofillTranslations.mockResolvedValue(RESULT(0, 0))
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))
    expect(await screen.findByText('All strings are already translated.')).toBeInTheDocument()
  })

  it('shows the service error and keeps the dialog open + retryable on failure', async () => {
    m.autofillTranslations.mockRejectedValue(apiError(502, 'BAD_GATEWAY', 'MT provider down'))
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))

    expect(await within(dialog).findByText('MT provider down')).toBeInTheDocument()
    expect(q('[data-error="autofill-failed"]', dialog)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Run autofill' })).toBeEnabled()
    expect(m.getLocaleIndex).toHaveBeenCalledTimes(1) // no refresh on failure
  })

  it('fail-closed: 403 FORBIDDEN shows the reason and disables the CTA', async () => {
    m.autofillTranslations.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no translate'))
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('button', { name: 'Run autofill' }))

    expect(await within(dialog).findByText('You do not have the translate action.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Run autofill' })).toBeDisabled()
  })

  it('Close dismisses the dialog without calling the API', async () => {
    const { user, dialog } = await openAutofill()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.autofillTranslations).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('frame 08 — locale editor', () => {
  const T1 = makeTranslation({ item_id: 'sli_1', label: 'Allemagne' })
  const T2 = makeTranslation({ item_id: 'sli_2', label: 'Autriche', is_machine: true })
  const rows = () => qa('[data-translation-input="item"]') as HTMLElement[]

  async function renderLoadedEditor(translations = [T1, T2], locale = 'fr') {
    m.getLocaleEditor.mockResolvedValue({ locale, translations })
    const utils = renderEditor(locale)
    await screen.findByRole('heading', { name: `${locale.toUpperCase()} translations` })
    return { user: userEvent.setup(), ...utils }
  }

  it('shows a loading placeholder', async () => {
    m.getLocaleEditor.mockReturnValue(NEVER)
    await renderFlowSettled(
      <TranslationWorkbenchFlow />,
      '/settings/selection-lists/sl_01/translations/fr',
      ROUTES,
    )
    expect(q('[data-panel="locale-editor"] [data-state="loading"]')).toBeInTheDocument()
  })

  it('requests the editor for the :listId and :locale route params', async () => {
    await renderLoadedEditor()
    expect(m.getLocaleEditor).toHaveBeenCalledWith('sl_01', 'fr')
  })

  it('shows the empty state', async () => {
    m.getLocaleEditor.mockResolvedValue({ locale: 'fr', translations: [] })
    renderEditor()
    await waitFor(() => expect(q('[data-state="empty"]')).not.toBeNull())
    expect(q('[data-state="empty"]')).toHaveTextContent('No translations yet for FR.')
  })

  it('shows the error state and Retry reloads', async () => {
    const user = userEvent.setup()
    m.getLocaleEditor.mockRejectedValueOnce(apiError(500, 'INTERNAL', 'editor down'))
    renderEditor()
    await waitFor(() => expect(q('[data-state="error"]')).not.toBeNull())
    expect(q('[data-state="error"]')).toHaveTextContent('editor down')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'FR translations' })).toBeInTheDocument()
  })

  it('reports progress as human-translated / total (machine rows do not count)', async () => {
    await renderLoadedEditor()
    expect(q('[data-progress="fr"]')).toHaveTextContent('50% complete (1/2)')
  })

  it('flags machine rows with data-machine', async () => {
    await renderLoadedEditor()
    expect(rows()[0]).toHaveAttribute('data-machine', 'false')
    expect(rows()[1]).toHaveAttribute('data-machine', 'true')
  })

  it('warns "Source changed" on a stale row (source_hash mismatch) and only there', async () => {
    await renderLoadedEditor([T1, makeTranslation({ item_id: 'sli_2', source_hash: 'old', source_hash_current: 'new' })])
    expect(rows()[0]).not.toHaveAttribute('data-stale')
    expect(rows()[1]).toHaveAttribute('data-stale', 'true')
    expect(q('[data-warning="source-changed"]', rows()[1])).toBeInTheDocument()
    expect(q('[data-warning="source-changed"]', rows()[0])).toBeNull()
  })

  it('explains the fallback for an empty translation instead of implying data loss', async () => {
    await renderLoadedEditor([makeTranslation({ item_id: 'sli_1', label: '' })])
    expect(rows()[0]).toHaveAttribute('data-missing', 'true')
    expect(rows()[0]).toHaveTextContent('Falls back to source locale')
  })

  it('Back returns to the locale index', async () => {
    const { user } = await renderLoadedEditor()
    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/selection-lists/sl_01/translations')
    expect(screen.getByTestId('location').textContent).not.toMatch(/\/fr$/)
    expect(await screen.findByRole('heading', { name: 'Translations' })).toBeInTheDocument()
  })

  describe('RTL / LTR', () => {
    it.each(['ar', 'he'])('%s: target cell is dir=rtl and right-aligned, source cell stays ltr', async locale => {
      await renderLoadedEditor([makeTranslation({ locale })], locale)
      const row = rows()[0]
      const [source, target] = Array.from(row.children) as HTMLElement[]
      expect(source).toHaveAttribute('dir', 'ltr')
      expect(target).toHaveAttribute('dir', 'rtl')
      expect(target).toHaveAttribute('data-rtl', 'true')
      expect(target).toHaveAttribute('data-locale', locale)
      const field = q('input', target) as HTMLInputElement
      expect(field.style.direction).toBe('rtl')
      expect(field.style.textAlign).toBe('right')
    })

    it.each(['fr', 'en', 'ja'])('%s: both cells are ltr, no rtl marker', async locale => {
      await renderLoadedEditor([makeTranslation({ locale })], locale)
      const [source, target] = Array.from(rows()[0].children) as HTMLElement[]
      expect(source).toHaveAttribute('dir', 'ltr')
      expect(target).toHaveAttribute('dir', 'ltr')
      expect(target).not.toHaveAttribute('data-rtl')
      expect((q('input', target) as HTMLInputElement).style.textAlign).toBe('left')
    })

    it('does not mirror the whole page (page root has no dir override)', async () => {
      await renderLoadedEditor([makeTranslation({ locale: 'ar' })], 'ar')
      expect(q('[data-panel="locale-editor"]')).not.toHaveAttribute('dir')
    })
  })

  describe('saving', () => {
    it('saves one row, sends only the label, and the row becomes human (is_machine false)', async () => {
      m.saveTranslation.mockResolvedValue(undefined)
      const { user } = await renderLoadedEditor()
      const field = rows()[1].querySelector('input') as HTMLInputElement
      await user.clear(field)
      await user.type(field, 'Österreich')
      await user.click(within(rows()[1]).getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(m.saveTranslation).toHaveBeenCalledWith('sl_01', 'sli_2', 'fr', { label: 'Österreich' }),
      )
      await waitFor(() => expect(rows()[1]).toHaveAttribute('data-machine', 'false'))
      expect((rows()[1].querySelector('input') as HTMLInputElement).value).toBe('Österreich')
      expect(q('[data-progress="fr"]')).toHaveTextContent('100% complete (2/2)')
    })

    it('shows "Saving…" and disables only the row being saved', async () => {
      const d = deferred<void>()
      m.saveTranslation.mockReturnValue(d.promise)
      const { user } = await renderLoadedEditor()
      await user.click(within(rows()[0]).getByRole('button', { name: 'Save' }))
      expect(await within(rows()[0]).findByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(within(rows()[1]).getByRole('button', { name: 'Save' })).toBeEnabled()
      d.resolve()
      await waitFor(() => expect(within(rows()[0]).getByRole('button', { name: 'Save' })).toBeEnabled())
    })

    it('a failed save keeps the typed edit and marks that row failed', async () => {
      m.saveTranslation.mockRejectedValue(apiError(500, 'INTERNAL', 'write failed'))
      const { user } = await renderLoadedEditor()
      const field = rows()[0].querySelector('input') as HTMLInputElement
      await user.clear(field)
      await user.type(field, 'Typed edit')
      await user.click(within(rows()[0]).getByRole('button', { name: 'Save' }))

      expect(await within(rows()[0]).findByText('write failed')).toBeInTheDocument()
      expect(q('[data-error="save-failed"]', rows()[0])).toBeInTheDocument()
      expect((rows()[0].querySelector('input') as HTMLInputElement).value).toBe('Typed edit')
      expect(q('[data-error="save-failed"]', rows()[1])).toBeNull()
      expect(within(rows()[0]).getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('fail-closed: 403 FORBIDDEN disables every input and save button and explains why', async () => {
      m.saveTranslation.mockRejectedValue(apiError(403, 'FORBIDDEN', 'no'))
      const { user } = await renderLoadedEditor()
      await user.click(within(rows()[0]).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('You do not have the translate action.')).toBeInTheDocument()
      for (const row of rows()) {
        expect(row.querySelector('input')).toBeDisabled()
        expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled()
      }
    })

    it('Save all persists only edited rows', async () => {
      m.saveTranslation.mockResolvedValue(undefined)
      const { user } = await renderLoadedEditor([T1, T2, makeTranslation({ item_id: 'sli_3', label: 'Belgique' })])
      await user.type(rows()[0].querySelector('input') as HTMLInputElement, '!')
      await user.type(rows()[2].querySelector('input') as HTMLInputElement, '?')
      await user.click(screen.getByRole('button', { name: 'Save all' }))

      await waitFor(() => expect(m.saveTranslation).toHaveBeenCalledTimes(2))
      expect(m.saveTranslation).toHaveBeenCalledWith('sl_01', 'sli_1', 'fr', { label: 'Allemagne!' })
      expect(m.saveTranslation).toHaveBeenCalledWith('sl_01', 'sli_3', 'fr', { label: 'Belgique?' })
    })

    it('Save all with no edits is a no-op', async () => {
      const { user } = await renderLoadedEditor()
      await user.click(screen.getByRole('button', { name: 'Save all' }))
      expect(m.saveTranslation).not.toHaveBeenCalled()
    })
  })

  it('a11y: every row exposes a text input and a named Save button', async () => {
    await renderLoadedEditor()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'FR translations' })).toBeInTheDocument()
  })
})
