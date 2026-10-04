/**
 * SelectionListPickerHarness — Harness route for frames 12-14.
 *
 * Route: /embed/selection-list-picker (rendered OUTSIDE the authenticated Layout)
 *
 * The SelectionListPicker component is embeddable — it mounts inside a host form.
 * This route is a test harness / demo surface; the picker is the deliverable.
 *
 * Query params:
 *   list  — list key (e.g. "sales-regions")
 *   mode  — "single" | "multi"
 *   value — pre-selected item ID (for archived/missing resolution)
 *   max   — maximum selections (multi mode)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { SelectionListItem, ApiError } from './types'
import {
  listSelectionLists,
  listItems,
  resolveItems,
  unwrapItems,
  unwrapCursor,
} from './api'

// ── Design-system tokens only ─────────────────────────────────────────────────
const s = {
  harness: {
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    padding: 'var(--space-6)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: 'var(--space-4)',
  } as React.CSSProperties,
  pickerWrap: {
    width: 'min(480px, 100%)',
    position: 'relative' as const,
  } as React.CSSProperties,
  comboControl: {
    width: '100%',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '2.5rem',
    textAlign: 'start' as const,
  } as React.CSSProperties,
  comboMenu: {
    position: 'absolute' as const,
    top: 'calc(100% + var(--space-1))',
    insetInlineStart: 0,
    insetInlineEnd: 0,
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-md)',
    zIndex: 20,
    overflow: 'hidden',
  } as React.CSSProperties,
  comboSearch: {
    width: '100%',
    padding: 'var(--space-2) var(--space-3)',
    border: 'none',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  optionList: {
    maxHeight: '240px',
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  optionItem: {
    padding: 'var(--space-2) var(--space-3)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
  } as React.CSSProperties,
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-full)',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    fontSize: 'var(--text-xs)',
    border: '1px solid var(--accent)',
  } as React.CSSProperties,
  chipRemoveBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--accent)',
    padding: '0',
    fontSize: 'var(--text-sm)',
    lineHeight: 1,
  } as React.CSSProperties,
  errorBanner: {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    fontSize: 'var(--text-sm)',
    marginTop: 'var(--space-2)',
  } as React.CSSProperties,
  statusBadge: {
    display: 'inline-block',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-full)',
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    fontSize: 'var(--text-xs)',
    marginInlineStart: 'var(--space-2)',
  } as React.CSSProperties,
  infoNote: {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-xs)',
    marginTop: 'var(--space-2)',
  } as React.CSSProperties,
  resolveMatrix: {
    marginTop: 'var(--space-3)',
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    padding: 'var(--space-3)',
    fontSize: 'var(--text-xs)',
  } as React.CSSProperties,
}

// Locales to show in the resolve matrix fallback display
const DISPLAY_LOCALES = ['en', 'ja', 'fr', 'de']

// ─────────────────────────────────────────────────────────────────────────────
// SelectionListPicker — the embeddable component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public API of the embeddable picker.
 *
 * The picker is UNCONTROLLED: `initialValue` seeds the selection (it is read on
 * mount and again only if the host passes a different `initialValue`), after
 * which the picker owns the state and reports every USER change through
 * `onChange`. Seeding from `initialValue` never fires `onChange` — the host
 * already has that value.
 *
 * Values are ALWAYS item ids (`front_sli_…`), never an item `code` or a label:
 * the contract says consumers persist the id and resolve labels at render time
 * (the label shown comes from the service, already resolved for the viewer's
 * locale). `onChange` emits exactly what the hidden `[data-persisted]` slot
 * carries (multi: the same ids, in the list's `sort_order`, not click order).
 */
interface SelectionListPickerBaseProps {
  /**
   * The list's org-unique `key` (e.g. "sales-regions"). The picker looks the
   * list up by key (`GET /v1/selection-lists`, matching `key`) and then reads
   * items by the list `id` the contract requires. A `front_sl_…` list id is
   * also accepted and used as-is.
   */
  listKey: string
  /** Stored item id to pre-select. May be active, archived or purged (frame 14). */
  initialValue?: string
}

export interface SingleSelectionListPickerProps extends SelectionListPickerBaseProps {
  mode: 'single'
  /** Called with the newly chosen item id when the user picks a different value. */
  onChange?: (value: string) => void
  /** Has no meaning in single mode. */
  max?: undefined
}

export interface MultiSelectionListPickerProps extends SelectionListPickerBaseProps {
  mode: 'multi'
  /**
   * Called with the full selection (item ids in the list's `sort_order`) after
   * every select / deselect / chip removal / "Clear all". Refused selections
   * (max reached) do not call it.
   */
  onChange?: (value: string[]) => void
  /** Host-supplied cap on selections (0 / undefined = unlimited). */
  max?: number
}

export type SelectionListPickerProps = SingleSelectionListPickerProps | MultiSelectionListPickerProps

type LoadState = 'loading' | 'error' | 'not-found' | 'loaded'

interface ResolvedValueState {
  kind: 'archived' | 'missing'
  id: string
  label?: string
  locale?: string
  status?: string
}

/** Contract list ids carry the `front_sl_` prefix; anything else is a list KEY. */
const LIST_ID_PREFIX = 'front_sl_'
/** Safety cap for cursor walking (lists/org and items/list are quota-bounded well below this). */
const MAX_PAGES = 20

class ListNotFoundError extends Error {
  status = 404
  code = 'NOT_FOUND'
}

/** key -> list id via the contract's list endpoint (a list the caller cannot see is simply absent). */
async function findListId(listKey: string): Promise<string> {
  if (listKey.startsWith(LIST_ID_PREFIX)) return listKey
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listSelectionLists(cursor ? { cursor } : {})
    const hit = unwrapItems(res).find(l => l.key === listKey)
    if (hit) return hit.id
    cursor = unwrapCursor(res)
    if (!cursor) break
  }
  throw new ListNotFoundError(`List "${listKey}" not found`)
}

/**
 * The value the host form holds for a given selection — the single source of
 * truth for BOTH the `[data-persisted]` slot and `onChange`.
 * Purged: keep the unknown id. Otherwise the selected ACTIVE ids in sort_order;
 * if none, an archived stored id stays (never silently dropped).
 */
function valueFor(
  selectedIds: string[],
  resolved: ResolvedValueState | null,
  activeItems: SelectionListItem[],
): string[] {
  if (resolved?.kind === 'missing') return [resolved.id]
  const ids = activeItems
    .filter(it => selectedIds.includes(it.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(it => it.id)
  if (ids.length === 0 && resolved?.kind === 'archived') return [resolved.id]
  return ids
}

export function SelectionListPicker(props: SelectionListPickerProps) {
  const { listKey, mode, initialValue, max } = props
  const [items, setItems] = useState<SelectionListItem[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  // Combobox state
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Resolved initial value (archived / missing)
  const [resolvedValue, setResolvedValue] = useState<ResolvedValueState | null>(null)

  // True once the user has changed the value: a late /resolve of the initial
  // value must not overwrite what the user (and, via onChange, the host) chose.
  const touchedRef = useRef(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // ── Load items from the API ───────────────────────────────────────────────
  const loadItems = useCallback(async () => {
    setLoadState('loading')
    try {
      const listId = await findListId(listKey)
      // Follow page.nextCursor until the collection is exhausted.
      const all: SelectionListItem[] = []
      let cursor: string | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await listItems(listId, cursor ? { cursor } : {})
        all.push(...unwrapItems(res))
        cursor = unwrapCursor(res)
        if (!cursor) break
      }
      all.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
      setItems(all)
      setLoadState('loaded')
    } catch (err) {
      const apiErr = err as ApiError & { status?: number }
      if (apiErr.status === 404 || apiErr.code === 'NOT_FOUND') {
        setLoadState('not-found')
      } else {
        setLoadState('error')
      }
    }
  }, [listKey])

  // ── Resolve initial value (for archived/missing) ──────────────────────────
  const resolveInitialValue = useCallback(async (valueId: string) => {
    const stale = () => touchedRef.current
    try {
      const res = await resolveItems([valueId])
      if (stale()) return
      const resolved = res.resolved.find(r => r.id === valueId)
      if (resolved && resolved.status === 'archived') {
        setResolvedValue({ kind: 'archived', id: valueId, label: resolved.label, locale: resolved.locale, status: resolved.status })
        // Set as selected
        setSelectedIds([valueId])
      } else if (res.missing.includes(valueId)) {
        setResolvedValue({ kind: 'missing', id: valueId })
        // Keep the ID in the form even if purged
        setSelectedIds([valueId])
      } else if (resolved) {
        // Active value: pre-select it so the host form shows (and re-submits) it
        setSelectedIds([valueId])
      }
    } catch {
      // Resolve failure: treat as if the value is there (fail-open)
      if (stale()) return
      setSelectedIds(valueId ? [valueId] : [])
    }
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  useEffect(() => {
    // A new initialValue re-seeds the picker (uncontrolled: it is a seed, not a binding).
    touchedRef.current = false
    if (initialValue) {
      resolveInitialValue(initialValue)
    }
  }, [initialValue, resolveInitialValue])

  // ── Close menu on outside click ───────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearchText('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Focus search when menu opens ──────────────────────────────────────────
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open])

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeItems = items.filter(it => it.status === 'active')
  const filteredItems = activeItems.filter(it =>
    !searchText.trim() ||
    it.label.toLowerCase().includes(searchText.toLowerCase()) ||
    it.code.toLowerCase().includes(searchText.toLowerCase())
  )

  // Selected items in sort_order order
  const selectedItemsOrdered = activeItems
    .filter(it => selectedIds.includes(it.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  // The persisted value: IDs in sort_order order (comma-separated)
  const persistedValue = valueFor(selectedIds, resolvedValue, activeItems).join(',')

  const noMatches = searchText.trim() && filteredItems.length === 0
  const maxReached = mode === 'multi' && max !== undefined && max > 0 && selectedIds.filter(id => activeItems.some(it => it.id === id)).length >= max

  // ── Determine which frame to show ─────────────────────────────────────────
  const isArchivedFrame = resolvedValue !== null

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleControlClick = () => {
    if (loadState !== 'loaded') return
    if (activeItems.length === 0) return
    setOpen(prev => !prev)
    setSearchText('')
  }

  /** Report a user-initiated change to the host (never called while seeding). */
  const emit = (nextSelected: string[], nextResolved: ResolvedValueState | null) => {
    touchedRef.current = true
    const value = valueFor(nextSelected, nextResolved, activeItems)
    if (props.mode === 'single') {
      if (value.length > 0) props.onChange?.(value[0])
    } else {
      props.onChange?.(value)
    }
  }

  const handleSelectItem = (item: SelectionListItem) => {
    if (mode === 'single') {
      const unchanged = resolvedValue === null && selectedIds.length === 1 && selectedIds[0] === item.id
      setSelectedIds([item.id])
      setResolvedValue(null) // clear archived/missing when user picks a new item
      setOpen(false)
      setSearchText('')
      if (!unchanged) emit([item.id], null)
    } else {
      if (maxReached && !selectedIds.includes(item.id)) return
      const next = selectedIds.includes(item.id)
        ? selectedIds.filter(id => id !== item.id)
        : [...selectedIds, item.id]
      setSelectedIds(next)
      emit(next, resolvedValue)
    }
  }

  const handleRemoveChip = (id: string) => {
    const next = selectedIds.filter(sid => sid !== id)
    setSelectedIds(next)
    emit(next, resolvedValue)
  }

  const handleClearAll = () => {
    setSelectedIds([])
    setResolvedValue(null)
    emit([], null)
  }

  // ── Persisted value element ───────────────────────────────────────────────
  // Visible 1px element so Playwright's .toBeVisible() passes.
  const persistedEl = (
    <div
      data-persisted={persistedValue}
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
      }}
    />
  )

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div
        data-frame={mode === 'multi' ? '13-picker-multi' : '12-picker-single'}
        data-mode={mode}
        data-picker={listKey}
        data-panel="picker"
        style={s.pickerWrap}
      >
        <div
          data-state="loading"
          style={{
            ...s.comboControl,
            cursor: 'default',
            background: 'var(--bg-skeleton)',
            color: 'transparent',
          }}
          aria-busy="true"
        >
          Loading...
        </div>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div
        data-frame={mode === 'multi' ? '13-picker-multi' : '12-picker-single'}
        data-mode={mode}
        data-picker={listKey}
        data-panel="picker"
        style={s.pickerWrap}
      >
        <div data-state="error" style={s.errorBanner}>
          Failed to load options.
          <button
            onClick={loadItems}
            style={{ marginInlineStart: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)', background: 'none', border: 'none', color: 'var(--accent)', textDecoration: 'underline' }}
            type="button"
          >
            Retry
          </button>
        </div>
        {persistedEl}
      </div>
    )
  }

  // ── Not-found state ───────────────────────────────────────────────────────
  if (loadState === 'not-found') {
    return (
      <div
        data-frame={mode === 'multi' ? '13-picker-multi' : '12-picker-single'}
        data-mode={mode}
        data-picker={listKey}
        data-panel="picker"
        style={s.pickerWrap}
      >
        <div data-state="not-found">
          <div data-error="NOT_FOUND" style={s.errorBanner}>
            List "{listKey}" not found or you do not have access.
          </div>
        </div>
      </div>
    )
  }

  // ── Missing value state (purged) ──────────────────────────────────────────
  if (resolvedValue?.kind === 'missing') {
    return (
      <div
        data-frame="14-picker-archived"
        data-mode={mode}
        data-picker={listKey}
        data-panel="picker"
        style={s.pickerWrap}
      >
        <div data-state="missing">
          <div
            data-selected-label
            data-missing="true"
            style={{
              ...s.comboControl,
              color: 'var(--text-tertiary)',
            }}
          >
            Unknown value
            <span data-error="missing" style={s.statusBadge}>Unknown</span>
          </div>
        </div>
        {/* Keep the purged ID in the form */}
        <div
          data-persisted={resolvedValue.id}
          aria-hidden="true"
          style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
        />
      </div>
    )
  }

  // ── Archived value frame (frame 14) ───────────────────────────────────────
  if (resolvedValue?.kind === 'archived') {
    const archivedLabel = resolvedValue.label ?? 'Archived value'
    const archivedLocale = resolvedValue.locale ?? 'en'

    return (
      <div
        data-frame="14-picker-archived"
        data-mode={mode}
        data-picker={listKey}
        data-panel="picker"
        style={s.pickerWrap}
        ref={menuRef}
      >
        {/* Archived selected display */}
        <div data-state="archived-selected">
          <button
            data-combo-control
            onClick={handleControlClick}
            type="button"
            style={{ ...s.comboControl, color: 'var(--text-tertiary)' }}
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            <span
              data-selected-label
              data-archived="true"
              data-status="archived"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              {archivedLabel}
              <span style={s.statusBadge}>Archived</span>
            </span>
            <span aria-hidden="true">▾</span>
          </button>
        </div>

        {/* Combo menu (only active items; archived is absent) */}
        {open && (
          <div data-combo-menu style={s.comboMenu} role="listbox">
            <input
              data-combo-search
              ref={searchRef}
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search..."
              style={s.comboSearch}
              aria-label="Search options"
            />
            <div style={s.optionList}>
              {filteredItems.map(item => (
                <div
                  key={item.id}
                  data-item={item.id}
                  role="option"
                  aria-selected={selectedIds.includes(item.id)}
                  onClick={() => handleSelectItem(item)}
                  style={{
                    ...s.optionItem,
                    background: selectedIds.includes(item.id) ? 'var(--accent-soft)' : undefined,
                  }}
                >
                  {item.label}
                </div>
              ))}
              {/* Archived item NOT in menu; note its absence */}
              <div
                data-state="archived-not-offered"
                data-note="archived-not-offerable"
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-tertiary)',
                  borderTop: '1px solid var(--border-color)',
                }}
              >
                Archived items cannot be newly selected. The stored value is shown above.
              </div>
            </div>
          </div>
        )}

        {/* Resolve matrix: locale fallback display */}
        <div data-panel="resolve-matrix" style={s.resolveMatrix}>
          <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
            Locale resolution
          </div>
          {DISPLAY_LOCALES.map(locale => (
            <div
              key={locale}
              data-locale={locale}
              style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-1) 0', color: 'var(--text-primary)' }}
            >
              <span style={{ minWidth: '3rem', color: 'var(--text-tertiary)' }}>{locale}</span>
              <span>
                {archivedLabel}
                {locale !== archivedLocale && (
                  <span style={{ color: 'var(--text-tertiary)', marginInlineStart: 'var(--space-1)' }}>
                    (fallback from {archivedLocale})
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Persisted value */}
        <div
          data-persisted={persistedValue}
          aria-hidden="true"
          style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
        />
      </div>
    )
  }

  // ── Normal state (frame 12 single / frame 13 multi) ───────────────────────
  const isEmpty = activeItems.length === 0
  const hasSelection = selectedIds.filter(id => activeItems.some(it => it.id === id)).length > 0

  // Single-mode: label of selected item
  const singleSelectedItem = mode === 'single' ? activeItems.find(it => selectedIds.includes(it.id)) : null

  return (
    <div
      data-frame={mode === 'multi' ? '13-picker-multi' : '12-picker-single'}
      data-mode={mode}
      data-picker={listKey}
      data-panel="picker"
      style={s.pickerWrap}
      ref={menuRef}
    >
      {/* Empty list state */}
      {isEmpty && (
        <div data-state="empty" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
          No options available.
        </div>
      )}

      {/* Multi: chip display */}
      {mode === 'multi' && (
        <div style={{ marginBottom: hasSelection ? 'var(--space-2)' : 0 }}>
          {hasSelection ? (
            <div
              data-chips
              style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}
            >
              {selectedItemsOrdered.map(item => (
                <span key={item.id} data-chip={item.id} style={s.chip}>
                  {item.label}
                  <button
                    onClick={() => handleRemoveChip(item.id)}
                    style={s.chipRemoveBtn}
                    type="button"
                    aria-label={`Remove ${item.label}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                data-action="clear-all"
                onClick={handleClearAll}
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--text-xs)',
                  padding: 'var(--space-1) var(--space-2)',
                  alignSelf: 'center',
                }}
              >
                Clear all
              </button>
            </div>
          ) : (
            <div data-state="empty-selection" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
              No items selected.
            </div>
          )}
        </div>
      )}

      {/* Max reached */}
      {maxReached && (
        <div data-state="max-reached" style={{ marginBottom: 'var(--space-2)' }}>
          <span data-error="max-selected" style={s.errorBanner}>
            Maximum selections reached ({max}).
          </span>
        </div>
      )}

      {/* Combo control */}
      <button
        data-combo-control
        onClick={handleControlClick}
        type="button"
        disabled={isEmpty}
        style={{
          ...s.comboControl,
          cursor: isEmpty ? 'not-allowed' : 'pointer',
          opacity: isEmpty ? 0.5 : 1,
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={isEmpty ? 'No options available' : 'Open selection list'}
      >
        {mode === 'single' && singleSelectedItem ? (
          <span data-selected-label>{singleSelectedItem.label}</span>
        ) : mode === 'single' ? (
          <span style={{ color: 'var(--text-tertiary)' }}>Select an option...</span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>Add options...</span>
        )}
        <span aria-hidden="true">▾</span>
      </button>

      {/* Combo menu (open state) */}
      {open && !isEmpty && (
        <div data-combo-menu style={s.comboMenu} role="listbox">
          <input
            data-combo-search
            ref={searchRef}
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search..."
            style={s.comboSearch}
            aria-label="Search options"
          />
          <div style={s.optionList}>
            {noMatches ? (
              <div
                data-state="no-matches"
                style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}
              >
                No matches found.
              </div>
            ) : (
              filteredItems.map(item => (
                <div
                  key={item.id}
                  data-item={item.id}
                  role="option"
                  aria-selected={selectedIds.includes(item.id)}
                  onClick={() => handleSelectItem(item)}
                  style={{
                    ...s.optionItem,
                    background: selectedIds.includes(item.id) ? 'var(--accent-soft)' : undefined,
                    cursor: (maxReached && !selectedIds.includes(item.id)) ? 'not-allowed' : 'pointer',
                    opacity: (maxReached && !selectedIds.includes(item.id)) ? 0.5 : 1,
                  }}
                >
                  {item.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Persisted value (visible 1px element for Playwright) */}
      {persistedEl}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectionListPickerHarness — Route component
// ─────────────────────────────────────────────────────────────────────────────
export function SelectionListPickerHarness() {
  const [searchParams] = useSearchParams()
  const listKey = searchParams.get('list') ?? ''
  const mode = (searchParams.get('mode') === 'multi' ? 'multi' : 'single') as 'single' | 'multi'
  const initialValue = searchParams.get('value') ?? undefined
  const maxStr = searchParams.get('max')
  const max = maxStr ? parseInt(maxStr, 10) : undefined

  return (
    <div
      data-note="embeddable"
      style={s.harness}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
        Picker harness — embeddable component demo
      </div>

      {listKey ? (
        mode === 'multi' ? (
          <SelectionListPicker listKey={listKey} mode="multi" initialValue={initialValue} max={max} />
        ) : (
          <SelectionListPicker listKey={listKey} mode="single" initialValue={initialValue} />
        )
      ) : (
        <div style={{ color: 'var(--danger)' }}>
          Missing <code>?list=</code> query parameter.
        </div>
      )}
    </div>
  )
}

export default SelectionListPickerHarness
