import { useMemo, useState } from 'react'
import { Alert, SearchField } from '@fuzefront/design-system'
import type {
  ConfigOperation,
  ConfigWriteResult,
  EffectiveConfigEntry,
  Scope,
} from '@fuzefront/config-client'
import { isConfigApiError } from '@fuzefront/config-client'
import { ScopeChainSwitcher } from '../common/ScopeChainSwitcher'
import { SettingRow } from './SettingRow'
import { SaveBar } from './SaveBar'
import { VersionConflictResolver, type ConflictEntry } from './VersionConflictResolver'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'
import { deriveProvenance } from '../../lib/provenance'
import type { ScopeChainStep, ScopeNameResolver } from '../../types'

export interface SecretRowState {
  /**
   * Non-contract extras only — `isSet` itself comes straight from
   * `EffectiveConfigEntry.isSet` (already in the frozen contract) and needs
   * no separate host-supplied map.
   */
  unavailable?: boolean
  canReveal?: boolean
}

export interface ConfigSettingsEditorFlowProps {
  chain: ScopeChainStep[]
  activeScope: Scope
  namespace: string
  /** The resolved view's version, echoed as the ETag and sent back as `expectedVersion`. Absent while loading/errored. */
  version?: string
  /** `null` while loading; `EffectiveConfig.entries` once loaded — omitted (never filtered) hidden keys included automatically, because the API never sends them. */
  entries: EffectiveConfigEntry[] | null
  loading?: boolean
  /** A non-2xx load failure. Never set together with `forbidden`. */
  error?: string | null
  /** 403 reading this namespace/scope — the whole surface is fail-closed, no partial render. */
  forbidden?: boolean
  /** Every entry arrived with `editable: false` — render everything disabled, no save bar at all. */
  readOnlyScope?: boolean
  nameOf: ScopeNameResolver
  /**
   * Resolves the immediate ancestor's own resolved value for a "set" entry —
   * needed ONLY to preview and construct the "pin the parent's current
   * value" operation. `EffectiveConfigEntry` carries just ONE scope's
   * resolved view, so this component cannot derive a parent's value from
   * `entries` alone; the host must read the ancestor scope separately (or
   * supply it from data it already has) and pass it here. When this
   * resolves to `undefined` for a given entry, `SettingRow` offers Unset
   * only — it will never guess a pin value, because pinning the WRONG value
   * is worse than not offering the option yet.
   */
  parentValueOf?: (entry: EffectiveConfigEntry) => { scope: Scope; value: unknown } | undefined
  secretState?: Record<string, SecretRowState>
  onScopeSelect?: (scope: Scope) => void
  onNamespaceSwitch?: () => void
  onRetry?: () => void
  /** Atomic batch write. Throws `ConfigApiError` on refusal — the flow renders VERSION_CONFLICT/VALIDATION_ERROR/LOCKED_BY_ANCESTOR in place. */
  onSubmit: (input: { operations: ConfigOperation[]; reason?: string; expectedVersion?: string }) => Promise<ConfigWriteResult>
  /** Called after a successful save so the host can refresh `entries`/`version`. */
  onSaved?: (result: ConfigWriteResult) => void
  /** Re-reads the current resolved view for VERSION_CONFLICT — never a blind retry of the stale write. */
  onReRead: () => Promise<{ entries: EffectiveConfigEntry[]; version: string }>
  /** Immediate, single-operation secret write — kept OUT of the bulk save batch (own confirm/save flow, 08-secret-input.html). */
  onSecretWrite: (key: string, op: 'set' | 'unset', value?: string) => Promise<void>
  onSecretReveal?: (key: string, reason: string) => Promise<string>
}

type Filter = 'all' | 'set-here' | 'inherited' | 'locked'

/**
 * `ConfigSettingsEditorFlow` — `/config`, `design/frames/config-management`
 * flow `settings-editor` (frames 01-04). Fully controlled: the host owns
 * fetching `EffectiveConfig` and performing the write; this component renders
 * every state and stages the dirty batch.
 */
export function ConfigSettingsEditorFlow({
  chain,
  activeScope,
  namespace,
  version,
  entries,
  loading = false,
  error = null,
  forbidden = false,
  readOnlyScope = false,
  nameOf,
  parentValueOf,
  secretState,
  onScopeSelect,
  onNamespaceSwitch,
  onRetry,
  onSubmit,
  onSaved,
  onReRead,
  onSecretWrite,
  onSecretReveal,
}: ConfigSettingsEditorFlowProps) {
  const { messages, t } = useConfigI18n()
  const m = messages.editor

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [pendingSet, setPendingSet] = useState<Record<string, unknown>>({})
  const [pendingUnset, setPendingUnset] = useState<Record<string, true>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [lockedOnSaveKey, setLockedOnSaveKey] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    loadedVersion: string
    currentVersion: string
    freshEntries: EffectiveConfigEntry[]
    conflicts: ConflictEntry[]
    picks: Record<string, 'theirs' | 'yours'>
  } | null>(null)

  const byKey = useMemo(() => {
    const map = new Map<string, EffectiveConfigEntry>()
    for (const e of entries ?? []) map.set(e.key, e)
    return map
  }, [entries])

  function draftValueFor(entry: EffectiveConfigEntry): unknown {
    if (entry.key in pendingSet) return pendingSet[entry.key]
    if (pendingUnset[entry.key]) return parentOf(entry)?.value ?? entry.definition.defaultValue
    return entry.value
  }

  function parentOf(entry: EffectiveConfigEntry): { scope: Scope; value: unknown } | undefined {
    // For an INHERITED entry, `entry.source` already names the ancestor whose
    // value this resolved to, so `entry.value` IS that ancestor's own value —
    // no extra read needed. For a SET entry (an override exists here), the
    // resolved value is THIS scope's own, not the parent's, so previewing or
    // constructing a "pin" op needs the host-supplied `parentValueOf` (a
    // separate read at the ancestor scope). Never approximate this — a wrong
    // guess here would pin the wrong value under a "Set here" badge that
    // looks identical to a correct one.
    if (entry.source.scopeType !== activeScope.scopeType) {
      return { scope: entry.source, value: entry.value }
    }
    return parentValueOf?.(entry)
  }

  const dirtyCount = Object.keys(pendingSet).length + Object.keys(pendingUnset).length

  function stageSet(key: string, value: unknown) {
    setPendingSet(prev => ({ ...prev, [key]: value }))
    setPendingUnset(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setFieldErrors(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function stageUnset(key: string) {
    setPendingUnset(prev => ({ ...prev, [key]: true }))
    setPendingSet(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function discardAll() {
    setPendingSet({})
    setPendingUnset({})
    setFieldErrors({})
    setSaveError(null)
    setLockedOnSaveKey(null)
    setConflict(null)
  }

  function buildOperations(): ConfigOperation[] {
    const ops: ConfigOperation[] = []
    for (const [key, value] of Object.entries(pendingSet)) ops.push({ key, op: 'set', value })
    for (const key of Object.keys(pendingUnset)) ops.push({ key, op: 'unset' })
    return ops
  }

  async function handleSubmit() {
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    setLockedOnSaveKey(null)
    try {
      const result = await onSubmit({ operations: buildOperations(), reason: reason || undefined, expectedVersion: version })
      discardAll()
      setReason('')
      onSaved?.(result)
    } catch (err) {
      if (isConfigApiError(err)) {
        if (err.isVersionConflict) {
          const fresh = await onReRead()
          const conflicts: ConflictEntry[] = []
          const picks: Record<string, 'theirs' | 'yours'> = {}
          for (const key of [...Object.keys(pendingSet), ...Object.keys(pendingUnset)]) {
            const before = byKey.get(key)
            const after = fresh.entries.find(e => e.key === key)
            if (!before || !after) continue
            if (JSON.stringify(before.value) !== JSON.stringify(after.value)) {
              conflicts.push({
                key,
                theirValue: after.value,
                yourValue: key in pendingSet ? pendingSet[key] : '(unset)',
                changedBy:
                  after.source.scopeType === activeScope.scopeType
                    ? 'changed since you loaded this page'
                    : `changed at ${after.source.scopeType} — inherited change, not a peer edit`,
              })
              picks[key] = 'yours'
            }
          }
          setConflict({
            loadedVersion: version ?? '',
            currentVersion: err.currentVersion ?? fresh.version,
            freshEntries: fresh.entries,
            conflicts,
            picks,
          })
        } else if (err.isLockedByAncestor) {
          setLockedOnSaveKey(err.details?.[0]?.key ?? null)
          setSaveError(err.message)
        } else if (err.code === 'VALIDATION_ERROR') {
          const map: Record<string, string> = {}
          for (const d of err.details ?? []) if (d.key) map[d.key] = d.message
          setFieldErrors(map)
          setSaveError(err.message)
        } else {
          setSaveError(err.message)
        }
      } else {
        setSaveError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveMerged() {
    if (!conflict) return
    setSaving(true)
    try {
      const ops: ConfigOperation[] = []
      for (const [key, value] of Object.entries(pendingSet)) {
        if (conflict.picks[key] === 'theirs') continue
        ops.push({ key, op: 'set', value })
      }
      for (const key of Object.keys(pendingUnset)) {
        if (conflict.picks[key] === 'theirs') continue
        ops.push({ key, op: 'unset' })
      }
      const result = await onSubmit({ operations: ops, reason: reason || undefined, expectedVersion: conflict.currentVersion })
      discardAll()
      setReason('')
      onSaved?.(result)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (forbidden) {
    return (
      <div data-state="forbidden-scope">
        <Alert tone="error" title={m.forbiddenTitle} role="alert">
          {t(m.forbiddenBody, { namespace, scope: activeScope.scopeType })}
        </Alert>
      </div>
    )
  }

  // A load failure takes priority over the loading skeleton — `error` and
  // `loading`/`entries === null` can coexist while the caller settles into
  // the error state (entries never arrived), and a permanent skeleton would
  // hide the retry action forever.
  if (error) {
    return (
      <div data-state="load-error">
        <Alert tone="error" title={m.loadErrorTitle} role="alert">
          {error || m.loadErrorBody}
        </Alert>
        <button
          type="button"
          data-action="retry"
          onClick={onRetry}
          style={{
            marginTop: 'var(--space-3)',
            background: 'var(--accent-color)',
            color: 'var(--text-primary)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            cursor: 'pointer',
          }}
        >
          {messages.common.retry}
        </button>
      </div>
    )
  }

  if (loading || entries === null) {
    return (
      <div data-loading aria-busy="true" data-state="loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ padding: 'var(--space-5) var(--space-6)', borderTop: i > 0 ? '1px solid var(--border-color)' : undefined }}>
            <div style={{ height: 14, width: '45%', background: 'var(--bg-quaternary)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)' }} />
            <div style={{ height: 14, width: '80%', background: 'var(--bg-quaternary)', borderRadius: 'var(--radius-sm)' }} />
          </div>
        ))}
      </div>
    )
  }

  if (conflict) {
    return (
      <div>
        <ScopeChainSwitcher chain={chain} activeScope={activeScope} onSelect={onScopeSelect} namespace={namespace} version={version} />
        <VersionConflictResolver
          loadedVersion={conflict.loadedVersion}
          currentVersion={conflict.currentVersion}
          conflicts={conflict.conflicts}
          picks={conflict.picks}
          onPickChange={(key, pick) => setConflict(c => (c ? { ...c, picks: { ...c.picks, [key]: pick } } : c))}
          onDiscardMine={() => {
            discardAll()
          }}
          onSaveMerged={handleSaveMerged}
        />
      </div>
    )
  }

  // entries === [] is a legitimate 200 (empty namespace), never an error.
  if (entries.length === 0) {
    return (
      <div>
        <ScopeChainSwitcher chain={chain} activeScope={activeScope} namespace={namespace} version={version} onSelect={onScopeSelect} />
        <div data-state="empty-namespace" style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-6)' }}>
          <h3>{m.emptyNamespaceTitle}</h3>
          <p style={{ color: 'var(--text-tertiary)', maxWidth: '46ch', margin: '0 auto var(--space-5)' }}>
            {t(m.emptyNamespaceBody, { namespace, scope: activeScope.scopeType })}
          </p>
          {onNamespaceSwitch && (
            <button type="button" data-action="switch-namespace" onClick={onNamespaceSwitch}>
              Choose another namespace
            </button>
          )}
        </div>
      </div>
    )
  }

  const filtered = entries.filter(e => {
    if (search && !e.definition.displayName.toLowerCase().includes(search.toLowerCase()) && !e.key.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    if (filter === 'all') return true
    const p = deriveProvenance(e, activeScope)
    if (filter === 'set-here') return p === 'set'
    if (filter === 'inherited') return p === 'inherited'
    if (filter === 'locked') return p === 'locked'
    return true
  })

  const categories = Array.from(new Set(filtered.map(e => e.definition.category ?? 'General')))

  return (
    <div data-settings-form>
      <ScopeChainSwitcher chain={chain} activeScope={activeScope} namespace={namespace} version={version} onSelect={onScopeSelect} />

      {readOnlyScope && (
        <Alert tone="warning" title={m.readOnlyScopeTitle} role="alert" data-readonly-notice>
          {t(m.readOnlyScopeBody, { scope: activeScope.scopeType })}
        </Alert>
      )}

      {saveError && !lockedOnSaveKey && Object.keys(fieldErrors).length === 0 && (
        <Alert tone="error" role="alert">
          {saveError}
        </Alert>
      )}
      {Object.keys(fieldErrors).length > 0 && (
        <Alert
          tone="error"
          title={t(messages.save.validationErrorTitle, { count: Object.keys(fieldErrors).length })}
          role="alert"
          data-error-code="VALIDATION_ERROR"
        >
          {messages.save.validationErrorBody}
        </Alert>
      )}
      {lockedOnSaveKey && (
        <Alert tone="warning" title={messages.save.lockedOnSaveTitle} role="alert" data-error-code="LOCKED_BY_ANCESTOR">
          {saveError}
        </Alert>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', padding: 'var(--space-4) var(--space-6)' }}>
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <SearchField
            placeholder={m.searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-config-search
          />
        </div>
        {(['all', 'set-here', 'inherited', 'locked'] as Filter[]).map(f => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-filter={f}
            onClick={() => setFilter(f)}
            style={{
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--text-xs)',
              border: '1px solid',
              borderColor: filter === f ? 'var(--accent-color)' : 'var(--border-color)',
              background: filter === f ? 'var(--accent-soft)' : 'var(--bg-quaternary)',
              color: filter === f ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {f === 'all' ? m.filterAll : f === 'set-here' ? m.filterSetHere : f === 'inherited' ? m.filterInherited : m.filterLocked}
          </button>
        ))}
      </div>

      {categories.map(category => (
        <div key={category} data-category={category}>
          <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-2)' }}>
            <h3 style={{ margin: 0 }}>{category}</h3>
          </div>
          {filtered
            .filter(e => (e.definition.category ?? 'General') === category)
            .map(entry => (
              <SettingRow
                key={entry.key}
                entry={entry}
                editingScope={activeScope}
                nameOf={nameOf}
                draftValue={draftValueFor(entry)}
                dirty={entry.key in pendingSet || entry.key in pendingUnset}
                fieldError={fieldErrors[entry.key]}
                onChange={value => stageSet(entry.key, value)}
                onUnset={() => (entry.definition.isSecret ? void onSecretWrite(entry.key, 'unset') : stageUnset(entry.key))}
                onPin={() => stageSet(entry.key, parentOf(entry)?.value)}
                parent={parentOf(entry)}
                secretIsSet={entry.isSet}
                secretUnavailable={secretState?.[entry.key]?.unavailable}
                canRevealSecret={secretState?.[entry.key]?.canReveal}
                onSecretReplace={value => void onSecretWrite(entry.key, 'set', value)}
                onSecretReveal={onSecretReveal ? reason2 => onSecretReveal(entry.key, reason2) : undefined}
              />
            ))}
        </div>
      ))}

      {!readOnlyScope && (
        <SaveBar
          dirtyCount={dirtyCount}
          invalidCount={Object.keys(fieldErrors).length}
          reason={reason}
          onReasonChange={setReason}
          onDiscard={discardAll}
          onSubmit={handleSubmit}
          saving={saving}
        />
      )}
    </div>
  )
}
