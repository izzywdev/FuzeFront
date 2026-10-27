/**
 * ReadOnlyTranslations — the Translations tab of a list the caller can only
 * read (frame 03): the locale index and the read-only locale view.
 *
 * The approved 4.0.0 workbench minus every mutation, ABSENT rather than
 * disabled: no Edit / Auto-fill / Add language on the index; no inputs, Save,
 * Save all, Mark reviewed or Auto-fill in the locale view. Each translated
 * locale's name links to the locale view at the existing route; the source
 * locale has no link (its text is the Values tab). Machine text keeps its M
 * badge; a right-to-left locale's target cell carries `dir="rtl"`.
 */

import { useMemo, type ReactNode } from 'react'
import { Badge, Button } from '@fuzefront/design-system'
import { getLocaleEditor, getLocaleIndex } from '../../api'
import type { LocaleIndexEntry, TranslationEntry } from '../../types'
import { classifyApiError, type SharedList } from '../core'
import { useResource } from '../core/useResource'
import { TRANSLATIONS_COPY as COPY } from './copy'
import { PanelSkeleton, PanelStateBlock } from './PanelState'
import { ReadOnlyListShell } from './ReadOnlyListShell'
import * as css from './styles'
import { useListValues } from './useListValues'

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv'])

export function isRtlLocale(locale: string): boolean {
  return RTL_LANGUAGES.has(locale.toLowerCase().split('-')[0])
}

/** The language's own name ("Français"), falling back to the code. */
export function languageName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale)
    if (name && name !== locale) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    // an unknown or malformed tag: show the code
  }
  return locale
}

export interface ReadOnlyTranslationsProps {
  list: SharedList
  /** The locale view to show; omitted = the locale index. */
  locale: string | undefined
  hrefForLocale: (locale: string) => string
  onOpenLocale: (locale: string) => void
  onBackToLocales: () => void
  onOpenValues: () => void
  onBackToIndex: () => void
  indexHref: string
}

function Frame({
  state,
  readOnlyPanel,
  locale,
  children,
}: {
  state?: string
  readOnlyPanel: 'locale-index' | 'locale-editor'
  locale?: string
  children: ReactNode
}) {
  return (
    <section
      data-panel={readOnlyPanel}
      data-readonly="true"
      data-state={state}
      data-locale-view={locale}
      style={css.panel}
    >
      {children}
    </section>
  )
}

function LocaleIndex({
  listId,
  hrefForLocale,
  onOpenLocale,
}: {
  listId: string
  hrefForLocale: (locale: string) => string
  onOpenLocale: (locale: string) => void
}) {
  const { settled, reload } = useResource(`locales|${listId}`, () =>
    getLocaleIndex(listId)
  )

  if (settled.status !== 'done' && settled.status !== 'failed') {
    return (
      <Frame readOnlyPanel="locale-index" state="loading">
        <PanelSkeleton label="Loading translations" />
      </Frame>
    )
  }
  if (settled.status === 'failed') {
    return (
      <Frame readOnlyPanel="locale-index" state="error">
        <PanelStateBlock
          icon="⚠"
          title={COPY.errorTitle}
          body={COPY.errorBody}
          role="alert"
          action={
            <Button variant="secondary" size="sm" data-action="retry" onClick={reload}>
              {COPY.retry}
            </Button>
          }
        />
      </Frame>
    )
  }
  const locales: LocaleIndexEntry[] = settled.value.locales ?? []
  if (locales.length === 0) {
    return (
      <Frame readOnlyPanel="locale-index" state="empty">
        <PanelStateBlock icon="☰" title={COPY.emptyTitle} body={COPY.emptyBody} />
      </Frame>
    )
  }
  return (
    <Frame readOnlyPanel="locale-index" state="ready">
      <div className="fz-sl-scroll">
        <table className="fz-sl-table" style={css.table}>
          <thead>
            <tr>
              <th scope="col" style={css.th}>{COPY.language}</th>
              <th scope="col" style={{ ...css.th, textAlign: 'end' }}>{COPY.translated}</th>
              <th scope="col" style={css.th}>{COPY.notes}</th>
            </tr>
          </thead>
          <tbody>
            {locales.map(entry => (
              <tr key={entry.locale} data-locale={entry.locale}>
                <td style={css.tdName} lang={entry.locale}>
                  {entry.is_source ? (
                    <>
                      {languageName(entry.locale)}{' '}
                      <span style={css.mutedText}>{COPY.source}</span>
                    </>
                  ) : (
                    <a
                      className="fz-sl-link"
                      href={hrefForLocale(entry.locale)}
                      data-action="open-locale-readonly"
                      data-locale-link={entry.locale}
                      onClick={event => {
                        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                          event.preventDefault()
                          onOpenLocale(entry.locale)
                        }
                      }}
                    >
                      {languageName(entry.locale)}
                    </a>
                  )}
                </td>
                <td style={{ ...css.td, ...css.numeric }}>
                  {entry.translated} / {entry.total}
                </td>
                <td style={css.td}>
                  {!entry.is_source && entry.machine_count > 0 && (
                    <>
                      <span data-machine="true">
                        <Badge tone="info" size="sm">{COPY.machine}</Badge>
                      </span>{' '}
                      {COPY.machineCount(entry.machine_count)}
                    </>
                  )}
                  {!entry.is_source && entry.stale_count > 0 && (
                    <span style={css.mutedText}> {COPY.staleCount(entry.stale_count)}</span>
                  )}
                  {(entry.is_source ||
                    (entry.machine_count === 0 && entry.stale_count === 0)) && (
                    <span style={css.mutedText}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

function LocaleView({
  list,
  locale,
  onBackToLocales,
}: {
  list: SharedList
  locale: string
  onBackToLocales: () => void
}) {
  const { settled, reload } = useResource(`locale|${list.id}|${locale}`, () =>
    getLocaleEditor(list.id, locale)
  )
  const values = useListValues(list.id)
  const codeOf = useMemo(
    () => new Map(values.rows.map(item => [item.id, item.code])),
    [values.rows]
  )
  const rtl = isRtlLocale(locale)

  if (settled.status !== 'done' && settled.status !== 'failed') {
    return (
      <Frame readOnlyPanel="locale-editor" state="loading" locale={locale}>
        <PanelSkeleton label="Loading translations" />
      </Frame>
    )
  }
  if (settled.status === 'failed') {
    const failure = classifyApiError(settled.error, { sharedLists: true })
    return (
      <Frame readOnlyPanel="locale-editor" state="error" locale={locale}>
        <PanelStateBlock
          icon="⚠"
          title={failure.kind === 'not_found' ? COPY.localeEmptyTitle : COPY.errorTitle}
          body={failure.kind === 'not_found' ? COPY.localeEmptyBody : COPY.errorBody}
          role="alert"
          action={
            <Button variant="secondary" size="sm" data-action="retry" onClick={reload}>
              {COPY.retry}
            </Button>
          }
        />
      </Frame>
    )
  }
  const rows: TranslationEntry[] = settled.value.translations ?? []
  return (
    <>
      <div style={{ marginBlockEnd: 'var(--space-3)' }}>
        <Button variant="ghost" size="sm" data-action="back-to-locales" onClick={onBackToLocales}>
          {COPY.back}
        </Button>
      </div>
      <Frame readOnlyPanel="locale-editor" state={rows.length === 0 ? 'empty' : 'ready'} locale={locale}>
        {rows.length === 0 ? (
          <PanelStateBlock icon="☰" title={COPY.localeEmptyTitle} body={COPY.localeEmptyBody} />
        ) : (
          <div className="fz-sl-scroll">
            <table className="fz-sl-table" style={css.table}>
              <thead>
                <tr>
                  <th scope="col" style={css.th}>{COPY.code}</th>
                  <th scope="col" style={css.th}>{languageName(locale)}</th>
                  <th scope="col" style={css.th}>{COPY.notes}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const stale = row.source_hash !== row.source_hash_current
                  const missing = !row.label
                  return (
                    <tr key={row.item_id} data-translation={row.item_id}>
                      <td style={css.td}>
                        <span style={css.keyChip}>{codeOf.get(row.item_id) ?? row.item_id}</span>
                      </td>
                      <td
                        style={{ ...css.tdName, textAlign: 'start' }}
                        dir={rtl ? 'rtl' : 'ltr'}
                        lang={locale}
                      >
                        {row.label}
                      </td>
                      <td style={css.td}>
                        {row.is_machine && (
                          <span data-machine="true">
                            <Badge tone="info" size="sm">{COPY.machine}</Badge>
                          </span>
                        )}
                        {stale && <span style={css.mutedText}> {COPY.sourceChanged}</span>}
                        {missing && <span style={css.mutedText}> {COPY.fallback}</span>}
                        {!row.is_machine && !stale && !missing && (
                          <span style={css.mutedText}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Frame>
    </>
  )
}

export function ReadOnlyTranslations({
  list,
  locale,
  hrefForLocale,
  onOpenLocale,
  onBackToLocales,
  onOpenValues,
  onBackToIndex,
  indexHref,
}: ReadOnlyTranslationsProps) {
  return (
    <ReadOnlyListShell
      list={list}
      activeTab="translations"
      onSelectTab={tab => {
        if (tab === 'values') onOpenValues()
      }}
      onBackToIndex={onBackToIndex}
      indexHref={indexHref}
    >
      {locale ? (
        <LocaleView list={list} locale={locale} onBackToLocales={onBackToLocales} />
      ) : (
        <LocaleIndex
          listId={list.id}
          hrefForLocale={hrefForLocale}
          onOpenLocale={onOpenLocale}
        />
      )}
    </ReadOnlyListShell>
  )
}
