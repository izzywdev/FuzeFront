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

import type { ReactNode } from 'react'
import { Badge, Button } from '@fuzefront/design-system'
import type { SharedList } from '../core'
import { useResource } from '../core/useResource'
import { TRANSLATIONS_COPY as COPY } from './copy'
import { PanelSkeleton, PanelStateBlock } from './PanelState'
import { ReadOnlyListShell } from './ReadOnlyListShell'
import * as css from './styles'
import { fetchAllItems, fetchLocaleStatuses, type LocaleStatus } from './readApi'

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
  list,
  hrefForLocale,
  onOpenLocale,
}: {
  list: SharedList
  hrefForLocale: (locale: string) => string
  onOpenLocale: (locale: string) => void
}) {
  const { settled, reload } = useResource(`locales|${list.id}`, signal =>
    fetchLocaleStatuses(list.id, signal)
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
  // The service never lists the source locale; it is shown first, by definition complete.
  const translated: LocaleStatus[] = settled.value
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
            <tr data-locale={list.source_locale}>
              <td style={css.tdName} lang={list.source_locale}>
                {languageName(list.source_locale)}{' '}
                <span style={css.mutedText}>{COPY.source}</span>
              </td>
              <td style={{ ...css.td, ...css.numeric }}>100%</td>
              <td style={css.td}>
                <span style={css.mutedText}>—</span>
              </td>
            </tr>
            {translated.map(entry => (
              <tr key={entry.locale} data-locale={entry.locale}>
                <td style={css.tdName} lang={entry.locale}>
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
                </td>
                <td style={{ ...css.td, ...css.numeric }}>{entry.completeness_pct}%</td>
                <td style={css.td}>
                  {entry.machine_translated && (
                    <>
                      <span data-machine="true">
                        <Badge tone="info" size="sm">{COPY.machine}</Badge>
                      </span>{' '}
                      {COPY.machineNote}
                    </>
                  )}
                  {entry.source_changed && (
                    <span style={css.mutedText}> {COPY.sourceChanged}</span>
                  )}
                  {!entry.machine_translated && !entry.source_changed && (
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
  // A locale's text is read through the items endpoint (`?locale=`): once in the
  // requested locale, once in the source locale for the reference column. Both
  // follow the cursor envelope to its end.
  const { settled, reload } = useResource(`locale|${list.id}|${locale}`, async signal => {
    const [target, source] = await Promise.all([
      fetchAllItems(list.id, { status: 'active', locale, signal }),
      fetchAllItems(list.id, { status: 'active', locale: list.source_locale, signal }),
    ])
    return { target, source }
  })
  const rtl = isRtlLocale(locale)
  const sourceRtl = isRtlLocale(list.source_locale)

  if (settled.status !== 'done' && settled.status !== 'failed') {
    return (
      <Frame readOnlyPanel="locale-editor" state="loading" locale={locale}>
        <PanelSkeleton label="Loading translations" />
      </Frame>
    )
  }
  if (settled.status === 'failed') {
    return (
      <Frame readOnlyPanel="locale-editor" state="error" locale={locale}>
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
  const { target, source } = settled.value
  const sourceLabel = new Map(source.map(item => [item.id, item.label]))
  return (
    <>
      <div style={{ marginBlockEnd: 'var(--space-3)' }}>
        <Button variant="ghost" size="sm" data-action="back-to-locales" onClick={onBackToLocales}>
          {COPY.back}
        </Button>
      </div>
      <Frame readOnlyPanel="locale-editor" state={target.length === 0 ? 'empty' : 'ready'} locale={locale}>
        {target.length === 0 ? (
          <PanelStateBlock icon="☰" title={COPY.localeEmptyTitle} body={COPY.localeEmptyBody} />
        ) : (
          <div className="fz-sl-scroll">
            <table className="fz-sl-table" style={css.table}>
              <thead>
                <tr>
                  <th scope="col" style={css.th}>{COPY.code}</th>
                  <th scope="col" style={css.th}>
                    {languageName(list.source_locale)} {COPY.source}
                  </th>
                  <th scope="col" style={css.th}>{languageName(locale)}</th>
                  <th scope="col" style={css.th}>{COPY.notes}</th>
                </tr>
              </thead>
              <tbody>
                {target.map(item => {
                  // The service falls back along its chain when this locale has no text.
                  const fallback =
                    item.resolved_locale !== undefined && item.resolved_locale !== locale
                  return (
                    <tr key={item.id} data-translation={item.id}>
                      <td style={css.td}>
                        <span style={css.keyChip}>{item.code}</span>
                      </td>
                      <td
                        style={{ ...css.td, textAlign: 'start' }}
                        dir={sourceRtl ? 'rtl' : 'ltr'}
                        lang={list.source_locale}
                      >
                        {sourceLabel.get(item.id) ?? ''}
                      </td>
                      <td
                        style={{ ...css.tdName, textAlign: 'start' }}
                        dir={rtl ? 'rtl' : 'ltr'}
                        lang={locale}
                      >
                        {item.label}
                      </td>
                      <td style={css.td}>
                        {item.is_machine && !fallback && (
                          <span data-machine="true">
                            <Badge tone="info" size="sm">{COPY.machine}</Badge>
                          </span>
                        )}
                        {fallback && <span style={css.mutedText}>{COPY.fallback}</span>}
                        {!item.is_machine && !fallback && (
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
          list={list}
          hrefForLocale={hrefForLocale}
          onOpenLocale={onOpenLocale}
        />
      )}
    </ReadOnlyListShell>
  )
}
