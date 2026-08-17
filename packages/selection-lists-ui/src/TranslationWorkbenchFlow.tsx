/**
 * TranslationWorkbenchFlow — Orchestrator for frames 07-09.
 *
 * Routes:
 *   /settings/selection-lists/:listId/translations        → Translation index (frame 07)
 *   /settings/selection-lists/:listId/translations/:locale → Locale editor (frame 08)
 *
 * The autofill modal (frame 09) is a dialog rendered in both screens.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type {
  LocaleIndexEntry,
  TranslationEntry,
  ApiError,
} from './types'
import {
  getLocaleIndex,
  getLocaleEditor,
  saveTranslation,
  autofillTranslations,
} from './api'

const RTL_LOCALES = new Set(['ar', 'he'])

const s = {
  frame: { padding: 'var(--space-4)' } as React.CSSProperties,
  errorBox: {
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--error-soft)',
    color: 'var(--error)',
    marginBottom: 'var(--space-3)',
  } as React.CSSProperties,
  btn: {
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--weight-semibold)',
  } as React.CSSProperties,
  btnGhost: {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
  localeCard: {
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    marginBottom: 'var(--space-2)',
  } as React.CSSProperties,
}

// ── Autofill Modal (frame 09) ─────────────────────────────────────────────────
function AutofillModal({
  listId,
  locale,
  sourceLocale,
  missingCount,
  onClose,
  onComplete,
}: {
  listId: string
  locale: string
  sourceLocale: string
  missingCount: number
  onClose: () => void
  onComplete: () => void
}) {
  const [overwriteMachine, setOverwriteMachine] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ filled: number; skipped: number } | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [nothingToDo, setNothingToDo] = useState(false)

  const handleConfirm = async () => {
    setRunning(true)
    setError(null)
    setForbidden(false)
    setNothingToDo(false)
    try {
      const res = await autofillTranslations(listId, locale, { overwrite_machine: overwriteMachine })
      if (res.filled === 0 && res.skipped === 0) {
        setNothingToDo(true)
      } else {
        setResult(res)
      }
      onComplete()
    } catch (err) {
      const e = err as ApiError & { status?: number }
      if (e.code === 'FORBIDDEN') {
        setForbidden(true)
      } else {
        setError({ ...e, code: 'autofill-failed' })
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-frame="09-autofill-modal"
      data-modal="autofill"
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        width: '100%',
        maxWidth: 480,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <h3 style={{ marginBottom: 'var(--space-2)' }}>Autofill translations for {locale.toUpperCase()}</h3>

        {/* Missing count + source locale */}
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
          <span data-autofill-count={missingCount}>{missingCount}</span>{' '}
          strings will be machine-translated from{' '}
          <span data-source-locale={sourceLocale}>{sourceLocale}</span>.
        </p>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
          Human-reviewed strings are guaranteed never to be overwritten — this is enforced service-side.
        </p>

        {/* States */}
        {running && <div data-state="running" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>Running autofill…</div>}
        {nothingToDo && <div data-state="nothing-to-do" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>All strings are already translated.</div>}

        {/* Errors */}
        {error && <div data-error="autofill-failed" style={s.errorBox}>{error.message ?? 'Autofill failed'}</div>}
        {forbidden && (
          <div data-error="FORBIDDEN" style={s.errorBox}>You do not have the translate action.</div>
        )}

        {/* Result */}
        {result && (
          <div data-result="autofill" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--success-soft)', borderRadius: 'var(--radius-md)' }}>
            Autofill complete: {result.filled} translated,{' '}
            <span data-items-skipped={result.skipped}>{result.skipped}</span> skipped.
          </div>
        )}

        {/* Controls */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
            <input
              data-field="overwrite_machine"
              type="checkbox"
              checked={overwriteMachine}
              onChange={e => setOverwriteMachine(e.target.checked)}
              disabled={running}
            />
            Overwrite existing machine translations
          </label>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            data-action="confirm-autofill"
            onClick={handleConfirm}
            disabled={running || forbidden}
            style={{ ...s.btn, opacity: running || forbidden ? 0.6 : 1 }}
          >
            {running ? 'Running…' : 'Run autofill'}
          </button>
          <button style={s.btnGhost} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Locale Index / Translation Index (frame 07) ───────────────────────────────
function TranslationIndex({
  listId,
  onEditLocale,
}: {
  listId: string
  onEditLocale: (locale: string) => void
}) {
  const [locales, setLocales] = useState<LocaleIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quotaExceeded, setQuotaExceeded] = useState(false)
  const [autofillTarget, setAutofillTarget] = useState<LocaleIndexEntry | null>(null)
  const [sourceLocale, setSourceLocale] = useState('en')

  const loadLocales = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await getLocaleIndex(listId)
      setLocales(resp.locales ?? [])
      setQuotaExceeded(resp.quota_exceeded ?? false)
      // Derive source locale
      const src = resp.locales?.find(l => l.is_source)
      if (src) setSourceLocale(src.locale)
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load translations')
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => { loadLocales() }, [loadLocales])

  if (loading) {
    return (
      <div data-frame="07-locale-index" data-panel="translation-index" style={s.frame}>
        <div data-state="loading" style={{ height: 40, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div data-frame="07-locale-index" data-panel="translation-index" style={s.frame}>
        <div data-state="error" style={s.errorBox}>{error}</div>
        <button style={s.btn} onClick={loadLocales}>Retry</button>
      </div>
    )
  }

  if (locales.length === 0) {
    return (
      <div data-frame="07-locale-index" data-panel="translation-index" style={s.frame}>
        <div data-state="empty" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No locales to translate.
        </div>
      </div>
    )
  }

  return (
    <div data-frame="07-locale-index" data-panel="translation-index" style={s.frame}>
      <h2 style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--text-xl)' }}>Translations</h2>

      {/* Fallback note */}
      <p data-note="fallback" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        Untranslated strings fall back to the source locale — the picker never renders blank.
      </p>

      {quotaExceeded && (
        <div data-error="QUOTA_EXCEEDED" style={s.errorBox}>
          The list_locales quota is exhausted. You cannot add new locale translations.
        </div>
      )}

      {locales.map(entry => {
        const isUntranslated = !entry.is_source && entry.translated === 0
        const hasMachine = !entry.is_source && entry.machine_count > 0
        const hasStale = !entry.is_source && entry.stale_count > 0
        const pct = entry.total > 0 ? Math.round((entry.translated / entry.total) * 100) : 0

        return (
          <div
            key={entry.locale}
            data-locale={entry.locale}
            data-source={entry.is_source ? 'true' : undefined}
            data-untranslated={isUntranslated ? 'true' : undefined}
            data-machine={hasMachine ? 'true' : undefined}
            data-stale={hasStale ? 'true' : undefined}
            style={s.localeCard}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>
                  {entry.locale.toUpperCase()}
                  {entry.is_source && (
                    <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      (source)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {pct}% ({entry.translated}/{entry.total})
                  {hasMachine && ` · ${entry.machine_count}M`}
                  {hasStale && ` · ${entry.stale_count} stale`}
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', marginTop: 'var(--space-1)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct === 100 ? 'var(--success)' : 'var(--accent)',
                  }} />
                </div>
              </div>
              {!entry.is_source && (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    data-action="start-translation"
                    style={s.btnGhost}
                    disabled={quotaExceeded && isUntranslated}
                    onClick={() => onEditLocale(entry.locale)}
                  >
                    {entry.translated === 0 ? 'Start' : 'Edit'}
                  </button>
                  <button
                    data-action="autofill"
                    style={{ ...s.btnGhost, fontStyle: 'italic' }}
                    disabled={quotaExceeded && isUntranslated}
                    onClick={() => setAutofillTarget(entry)}
                  >
                    Autofill
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Autofill modal */}
      {autofillTarget && (
        <AutofillModal
          listId={listId}
          locale={autofillTarget.locale}
          sourceLocale={sourceLocale}
          missingCount={autofillTarget.total - autofillTarget.translated}
          onClose={() => setAutofillTarget(null)}
          onComplete={() => {
            setAutofillTarget(null)
            loadLocales()
          }}
        />
      )}
    </div>
  )
}

// ── Locale Editor (frame 08) ──────────────────────────────────────────────────
function LocaleEditor({
  listId,
  locale,
  onBack,
}: {
  listId: string
  locale: string
  onBack: () => void
}) {
  const [translations, setTranslations] = useState<TranslationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbiddenAll, setForbiddenAll] = useState(false)
  const [savingRow, setSavingRow] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({})
  const isRtl = RTL_LOCALES.has(locale)

  const loadEditor = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await getLocaleEditor(listId, locale)
      setTranslations(resp.translations ?? [])
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [listId, locale])

  useEffect(() => { loadEditor() }, [loadEditor])

  // Check forbidden by attempting save on first interaction — simpler: detect from response
  // (will surface via save-row failure with FORBIDDEN)

  const handleSaveRow = async (t: TranslationEntry) => {
    setSavingRow(t.item_id)
    setSaveErrors(prev => ({ ...prev, [t.item_id]: '' }))
    const label = localEdits[t.item_id] ?? t.label
    try {
      await saveTranslation(listId, t.item_id, locale, { label })
      setTranslations(prev =>
        prev.map(x => x.item_id === t.item_id ? { ...x, label, is_machine: false } : x)
      )
      setLocalEdits(prev => { const n = { ...prev }; delete n[t.item_id]; return n })
    } catch (err) {
      const e = err as ApiError
      if (e.code === 'FORBIDDEN') {
        setForbiddenAll(true)
      } else {
        setSaveErrors(prev => ({ ...prev, [t.item_id]: e.message ?? 'Save failed' }))
      }
    } finally {
      setSavingRow(null)
    }
  }

  const handleSaveAll = async () => {
    for (const t of translations) {
      if (localEdits[t.item_id] !== undefined) {
        await handleSaveRow(t)
      }
    }
  }

  const humanTranslated = translations.filter(t => t.label && !t.is_machine).length
  const total = translations.length
  const pct = total > 0 ? Math.round((humanTranslated / total) * 100) : 0

  if (loading) {
    return (
      <div data-frame="08-locale-editor" data-panel="locale-editor" style={s.frame}>
        <div data-state="loading" style={{ height: 40, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div data-frame="08-locale-editor" data-panel="locale-editor" style={s.frame}>
        <div data-state="error" style={s.errorBox}>{error}</div>
        <button style={s.btn} onClick={loadEditor}>Retry</button>
      </div>
    )
  }

  if (translations.length === 0) {
    return (
      <div data-frame="08-locale-editor" data-panel="locale-editor" style={s.frame}>
        <div data-state="empty" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No translations yet for {locale.toUpperCase()}.
        </div>
      </div>
    )
  }

  return (
    <div data-frame="08-locale-editor" data-panel="locale-editor" style={s.frame}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <button style={s.btnGhost} onClick={onBack}>← Back</button>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>{locale.toUpperCase()} translations</h2>
      </div>

      {/* Progress meter */}
      <div data-progress={locale} style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)', color: 'var(--text-secondary)' }}>
          {pct}% complete ({humanTranslated}/{total})
        </div>
        <div style={{ height: 6, background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--success)' : 'var(--accent)' }} />
        </div>
      </div>

      {forbiddenAll && (
        <div data-error="FORBIDDEN" style={s.errorBox}>You do not have the translate action.</div>
      )}

      {/* Save All */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
        <button data-action="save-all" style={s.btn} onClick={handleSaveAll}>
          Save all
        </button>
      </div>

      {/* Translation rows */}
      {translations.map(t => {
        const isStale = t.source_hash !== t.source_hash_current
        const isMissing = !t.label
        const currentLabel = localEdits[t.item_id] ?? t.label

        return (
          <div
            key={t.item_id}
            data-translation-input="item"
            data-machine={t.is_machine ? 'true' : 'false'}
            data-stale={isStale ? 'true' : undefined}
            data-missing={isMissing ? 'true' : undefined}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr auto',
              gap: 'var(--space-3)',
              alignItems: 'start',
              padding: 'var(--space-3)',
              borderBottom: '1px solid var(--border-color)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {/* Source cell — always LTR */}
            <div dir="ltr" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {t.item_id}
              {isStale && (
                <div data-warning="source-changed" style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
                  Source changed — may need re-translation
                </div>
              )}
              {isMissing && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Falls back to source locale
                </div>
              )}
            </div>

            {/* Target cell — RTL for Arabic/Hebrew */}
            <div
              dir={isRtl ? 'rtl' : 'ltr'}
              data-locale={isRtl ? locale : undefined}
              data-rtl={isRtl ? 'true' : undefined}
            >
              <input
                type="text"
                value={currentLabel}
                onChange={e => setLocalEdits(prev => ({ ...prev, [t.item_id]: e.target.value }))}
                disabled={forbiddenAll}
                style={{
                  width: '100%',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  textAlign: isRtl ? 'right' : 'left',
                  direction: isRtl ? 'rtl' : 'ltr',
                }}
              />
              {saveErrors[t.item_id] && (
                <div data-error="save-failed" style={{ color: 'var(--error)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                  {saveErrors[t.item_id]}
                </div>
              )}
            </div>

            {/* Row actions */}
            <button
              data-action="save-row"
              style={s.btnGhost}
              disabled={savingRow === t.item_id || forbiddenAll}
              onClick={() => handleSaveRow(t)}
            >
              {savingRow === t.item_id ? 'Saving…' : 'Save'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── TranslationWorkbenchFlow (orchestrator) ───────────────────────────────────
export function TranslationWorkbenchFlow() {
  const { listId, locale } = useParams<{ listId: string; locale?: string }>()
  const navigate = useNavigate()

  if (!listId) return null

  if (locale) {
    return (
      <LocaleEditor
        listId={listId}
        locale={locale}
        onBack={() => navigate(`/settings/selection-lists/${listId}/translations`)}
      />
    )
  }

  return (
    <TranslationIndex
      listId={listId}
      onEditLocale={loc => navigate(`/settings/selection-lists/${listId}/translations/${loc}`)}
    />
  )
}
