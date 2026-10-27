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
 *   value — pre-selected item ID (for archived/missing resolution); in multi
 *           mode one or more ids, repeated (`value=a&value=b`) or comma-separated
 *   max   — maximum selections (multi mode)
 *
 * Shared-lists harness switches (SL9; only meaningful while the shared-lists
 * flag is ON — with it OFF they are ignored and the picker is the 4.0.0 one):
 *   showSource=1 — pass the opt-in `showSource` prop (provenance caption)
 *   migrate=1    — pass `onEffectiveValue`; every call is recorded on
 *                  `[data-migration="host-opt-in"]` as `data-effective-calls`
 *                  (JSON `[[stored, effective], …]`)
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { SelectionListItem, ApiError } from './types'
import {
  listSelectionLists,
  listItems,
  resolveItems,
  unwrapItems,
  unwrapCursor,
} from './api'
import {
  EffectiveListInspector,
  EffectiveListSource,
  EffectivePickerState,
  storedStatesFor,
  useEffectivePickerData,
  type StoredValueState,
} from './shared-lists/picker'
import { effectiveStyles as st } from './shared-lists/picker/styles'

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
 *
 * A stored value may no longer be offerable (frame 14): an ARCHIVED id still
 * renders its real label, badged; a PURGED (or unknown) id renders "Unknown
 * value". Both are kept in the value — never silently dropped — until the user
 * replaces or removes them.
 */
interface SelectionListPickerBaseProps {
  /**
   * The list's org-unique `key` (e.g. "sales-regions"). The picker looks the
   * list up by key (`GET /v1/selection-lists?key=…`) and then reads items by
   * the list `id` the contract requires. A `front_sl_…` list id is also
   * accepted and used as-is.
   */
  listKey: string
  /**
   * Shared lists (SL9, flag ON only): render the opt-in caption under the
   * control saying which list the key resolved to (the org's own version, or
   * the common list). Off by default — end-user forms show no caption. Ignored
   * while the shared-lists flag is OFF.
   */
  showSource?: boolean
  /**
   * Shared lists (SL9, flag ON only): called once per stored item id the
   * service redirected to the organization's fork item, after a SUCCESSFUL
   * resolve — `(storedId, effectiveId)`. The picker never rewrites the value it
   * holds; a host that wants to migrate stored values may write `effectiveId`
   * on its own next save. Never called while the flag is OFF, or when the
   * resolve fails.
   */
  onEffectiveValue?: (stored: string, effective: string) => void
  /**
   * Shared lists (SL9, flag ON only): diagnostics for the demo / e2e harness —
   * render which list the key resolved to. Not for end-user forms.
   */
  showInspector?: boolean
}

export interface SingleSelectionListPickerProps extends SelectionListPickerBaseProps {
  mode: 'single'
  /** Stored item id to pre-select. May be active, archived or purged (frame 14). */
  initialValue?: string
  /** Called with the newly chosen item id when the user picks a different value. */
  onChange?: (value: string) => void
  /** Has no meaning in single mode. */
  max?: undefined
}

export interface MultiSelectionListPickerProps extends SelectionListPickerBaseProps {
  mode: 'multi'
  /**
   * Stored item ids to pre-select (each may be active, archived or purged —
   * frame 14). All of them are resolved in ONE `POST /v1/resolve` call.
   */
  initialValue?: string[]
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

/** Contract list ids carry the `front_sl_` prefix; anything else is a list KEY. */
const LIST_ID_PREFIX = 'front_sl_'
/** Safety cap for cursor walking items (items/list is quota-bounded well below this). */
const MAX_PAGES = 20

class ListNotFoundError extends Error {
  status = 404
  code = 'NOT_FOUND'
}

/**
 * key -> list id via the contract's list endpoint, using its exact-match `key`
 * filter (a page of at most one row — no page walking). A list the caller
 * cannot see is simply absent; a key the contract would reject (400) cannot
 * name a list either, so both read as "not found".
 */
async function findListId(listKey: string): Promise<string> {
  if (listKey.startsWith(LIST_ID_PREFIX)) return listKey
  let res
  try {
    res = await listSelectionLists({ key: listKey })
  } catch (err) {
    if ((err as { status?: number }).status === 400) {
      throw new ListNotFoundError(`List "${listKey}" not found`)
    }
    throw err
  }
  const hit = unwrapItems(res).find(l => l.key === listKey)
  if (hit) return hit.id
  throw new ListNotFoundError(`List "${listKey}" not found`)
}

/** Normalise `initialValue` (string or string[]) to a de-duplicated, non-empty id list. */
function seedIdsOf(mode: 'single' | 'multi', initialValue: string | string[] | undefined): string[] {
  const raw = Array.isArray(initialValue) ? initialValue : initialValue ? [initialValue] : []
  const ids = Array.from(new Set(raw.filter(id => typeof id === 'string' && id !== '')))
  return mode === 'single' ? ids.slice(0, 1) : ids
}

/**
 * The value the host form holds for a given selection — the single source of
 * truth for BOTH the `[data-persisted]` slot and `onChange`.
 *
 * Selected ACTIVE ids and stored (archived / purged) ids are all kept. They are
 * ordered by the list's `sort_order`; a stored id whose item is not in the list
 * (purged, or archived items not returned by the list) has no order and follows
 * the ordered ones, in the order it was stored.
 */
function valueFor(
  selectedIds: string[],
  stored: StoredValueState[],
  items: SelectionListItem[],
): string[] {
  const order = new Map(items.map(it => [it.id, it.sort_order ?? 0]))
  const activeIds = new Set(items.filter(it => it.status === 'active').map(it => it.id))
  const storedIds = new Set(stored.map(v => v.id))
  return selectedIds
    .filter(id => activeIds.has(id) || storedIds.has(id))
    .map((id, i) => ({ id, i, o: order.get(id) }))
    .sort((a, b) => {
      if (a.o === undefined && b.o === undefined) return a.i - b.i
      if (a.o === undefined) return 1
      if (b.o === undefined) return -1
      return a.o - b.o || a.i - b.i
    })
    .map(e => e.id)
}

export function SelectionListPicker(props: SelectionListPickerProps) {
  const { listKey, mode, initialValue, max } = props

  // Keyed on the id CONTENT, so a host re-creating the same array each render
  // does not re-seed / re-resolve.
  const seedKey = JSON.stringify(seedIdsOf(mode, initialValue))
  const seedIdList = useMemo(() => JSON.parse(seedKey) as string[], [seedKey])

  // Shared lists (SL9): with the flag ON the key means the EFFECTIVE list and
  // the stored ids resolve across a fork. Flag OFF → inert (no request), and
  // everything below is exactly the 4.0.0 data path.
  const effective = useEffectivePickerData({
    listKey,
    storedIds: seedIdList,
    onEffectiveValue: props.onEffectiveValue,
  })
  const shared = effective.enabled

  const [legacyItems, setItems] = useState<SelectionListItem[]>([])
  const [legacyLoadState, setLoadState] = useState<LoadState>('loading')
  const items = shared ? effective.items : legacyItems
  const loadState: LoadState = shared ? effective.loadState : legacyLoadState

  // Combobox state
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  // Selection state: every selected id, including stored (archived / purged) ones
  // (Shared lists: the host's value is held from the first render — it never
  // waits on, or depends on, the resolve.)
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    shared ? seedIdList : [],
  )

  // Stored values that resolved as archived / missing (frame 14)
  const [legacyStoredValues, setStoredValues] = useState<StoredValueState[]>([])
  // Shared lists: derived from the one resolve, never stored — so a late resolve
  // can not undo a pick, and a replaced id simply stops being a stored value.
  const activeItemIds = useMemo(
    () => new Set(items.filter(it => it.status === 'active').map(it => it.id)),
    [items],
  )
  const sharedStoredValues = useMemo(
    () =>
      shared
        ? storedStatesFor(selectedIds, effective.stored.outcomes, activeItemIds)
        : [],
    [shared, selectedIds, effective.stored.outcomes, activeItemIds],
  )
  const storedValues = shared ? sharedStoredValues : legacyStoredValues

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

  // ── Resolve the stored value(s) in ONE call (for archived / missing) ──────
  const resolveInitialValue = useCallback(async (seedIds: string[]) => {
    const stale = () => touchedRef.current
    try {
      const res = await resolveItems(seedIds)
      if (stale()) return
      const stored: StoredValueState[] = []
      for (const id of seedIds) {
        const resolved = res.resolved.find(r => r.id === id)
        if (resolved && resolved.status === 'archived') {
          stored.push({ kind: 'archived', id, label: resolved.label, locale: resolved.locale, status: resolved.status })
        } else if (!resolved) {
          // Purged / unknown (listed in `missing`, or absent from both): keep the id, never drop it.
          stored.push({ kind: 'missing', id })
        }
        // An active value needs no stored-state: it is pre-selected below so the
        // host form shows (and re-submits) it.
      }
      setStoredValues(stored)
      setSelectedIds(seedIds)
    } catch {
      // Resolve failure: treat as if the value(s) are there (fail-open)
      if (stale()) return
      setStoredValues([])
      setSelectedIds(seedIds)
    }
  }, [])

  useEffect(() => {
    if (!shared) loadItems()
  }, [loadItems, shared])

  // A new initialValue re-seeds the picker (uncontrolled: it is a seed, not a binding).
  // Only a change of the seed CONTENT re-seeds. The flag arriving late (the host's
  // flag evaluation is async) switches the data path but must never undo a pick,
  // removal or "Clear all" the user already made — no onChange accompanies a reset.
  const seededKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const seedChanged = seededKeyRef.current !== seedKey
    seededKeyRef.current = seedKey
    if (seedChanged) touchedRef.current = false
    else if (touchedRef.current) return
    const seedIds = JSON.parse(seedKey) as string[]
    if (shared) {
      // Shared lists: hold the host's ids at once; the resolve is a hook of its own.
      setSelectedIds(prev =>
        prev.length === seedIds.length && prev.every((id, i) => id === seedIds[i])
          ? prev
          : seedIds,
      )
      return
    }
    if (seedIds.length > 0) {
      resolveInitialValue(seedIds)
    }
  }, [seedKey, resolveInitialValue, shared])

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

  // What the host form holds: ids in sort_order (comma-separated in the slot).
  // Shared lists: until the options AND the resolve have both settled, nothing
  // can be judged "no longer offerable" — the host's ids are kept as they are.
  const sharedSettled =
    loadState === 'loaded' &&
    (effective.stored.status === 'idle' || effective.stored.status === 'resolved')
  const persistedIds =
    shared && !sharedSettled
      ? selectedIds
      : valueFor(selectedIds, storedValues, items)
  const persistedValue = persistedIds.join(',')

  const storedById = new Map(storedValues.map(v => [v.id, v]))
  const archivedValues = persistedIds.map(id => storedById.get(id)).filter((v): v is StoredValueState => v?.kind === 'archived')
  const missingValues = persistedIds.map(id => storedById.get(id)).filter((v): v is StoredValueState => v?.kind === 'missing')

  // Shared lists: options a stored value was redirected to render as selected.
  const effectiveSelected = new Set(
    storedValues.flatMap(v => (v.effectiveId ? [v.effectiveId] : [])),
  )
  const isSelected = (id: string) =>
    selectedIds.includes(id) || effectiveSelected.has(id)

  const noMatches = searchText.trim() && filteredItems.length === 0
  const maxReached = mode === 'multi' && max !== undefined && max > 0 && persistedIds.length >= max

  // Frame 14 whenever a stored (archived / purged) value is in play
  const hasStored = archivedValues.length > 0 || missingValues.length > 0
  const frameId = hasStored ? '14-picker-archived' : mode === 'multi' ? '13-picker-multi' : '12-picker-single'

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleControlClick = () => {
    if (loadState !== 'loaded') return
    if (activeItems.length === 0) return
    setOpen(prev => !prev)
    setSearchText('')
  }

  /** Report a user-initiated change to the host (never called while seeding). */
  const emit = (nextSelected: string[], nextStored: StoredValueState[]) => {
    touchedRef.current = true
    const value = valueFor(nextSelected, nextStored, items)
    if (props.mode === 'single') {
      if (value.length > 0) props.onChange?.(value[0])
    } else {
      props.onChange?.(value)
    }
  }

  const handleSelectItem = (item: SelectionListItem) => {
    if (mode === 'single') {
      const unchanged = storedValues.length === 0 && selectedIds.length === 1 && selectedIds[0] === item.id
      setSelectedIds([item.id])
      setStoredValues([]) // a purged / archived stored value is replaced by the new pick
      setOpen(false)
      setSearchText('')
      if (!unchanged) emit([item.id], [])
      return
    }

    // Multi: toggle
    if (selectedIds.includes(item.id)) {
      const next = selectedIds.filter(id => id !== item.id)
      setSelectedIds(next)
      emit(next, storedValues)
      return
    }
    // Shared lists: an option marked selected only because a stored id was
    // redirected to it — deselecting it removes that stored id.
    if (effectiveSelected.has(item.id)) {
      const next = selectedIds.filter(
        id => !storedValues.some(v => v.id === id && v.effectiveId === item.id),
      )
      setSelectedIds(next)
      emit(next, storedValues)
      return
    }
    // Picking an active item swaps ONE purged id out of the set (its replacement);
    // that keeps the count, so it is allowed even at the cap.
    const swapOut = missingValues[0]
    if (maxReached && !swapOut) return
    const nextSelected = [...selectedIds.filter(id => id !== swapOut?.id), item.id]
    const nextStored = storedValues.filter(v => v.id !== swapOut?.id)
    setSelectedIds(nextSelected)
    setStoredValues(nextStored)
    emit(nextSelected, nextStored)
  }

  const handleRemoveChip = (id: string) => {
    const next = selectedIds.filter(sid => sid !== id)
    const nextStored = storedValues.filter(v => v.id !== id)
    setSelectedIds(next)
    setStoredValues(nextStored)
    emit(next, nextStored)
  }

  const handleClearAll = () => {
    setSelectedIds([])
    setStoredValues([])
    emit([], [])
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

  const loadFrame = mode === 'multi' ? '13-picker-multi' : '12-picker-single'

  // ── Shared lists: the in-place states (frames 09, 10, 15) ─────────────────
  // Loading (lookup → options), load failed, no effective list, resolving a
  // stored value, resolve failed. The host's value is kept in every one of them.
  if (shared) {
    const sharedState =
      loadState === 'error'
        ? 'error'
        : loadState === 'not-found'
          ? 'not-found'
          : loadState === 'loading'
            ? 'loading'
            : effective.stored.status === 'resolving'
              ? 'resolving'
              : effective.stored.status === 'error'
                ? 'resolve-error'
                : null
    if (sharedState) {
      return (
        <EffectivePickerState
          state={sharedState}
          listKey={listKey}
          incomplete={effective.incomplete}
          onRetry={
            sharedState === 'resolve-error' ? effective.stored.retry : effective.retryLoad
          }
          persisted={persistedEl}
          rootProps={{
            'data-frame': loadFrame,
            'data-mode': mode,
            'data-picker': listKey,
            'data-panel': 'picker',
            style: s.pickerWrap,
          }}
        />
      )
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div
        data-frame={loadFrame}
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
        data-frame={loadFrame}
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
        data-frame={loadFrame}
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

  // ── Loaded: frame 12 (single) / 13 (multi) / 14 (stored archived / purged value) ──
  const isEmpty = activeItems.length === 0
  const hasSelection = persistedIds.length > 0
  const singleStored = mode === 'single' ? storedValues[0] : undefined

  // Single-mode: label of selected item
  const singleSelectedItem = mode === 'single' ? activeItems.find(it => selectedIds.includes(it.id)) : null

  // The option menu: ACTIVE items only; an archived stored value is never offered.
  const menuEl = open && !isEmpty && (
    <div
      data-combo-menu
      // Shared lists: the menu sits inline under the control at every width
      // (frame 15 follows 4.0.0 frame 4d), so an overflow-hidden host cannot clip it.
      data-menu-placement={shared ? 'inline' : undefined}
      style={shared ? { ...s.comboMenu, ...st.comboMenu } : s.comboMenu}
      role="listbox"
      onKeyDown={
        shared
          ? e => {
              if (e.key === 'Escape') {
                setOpen(false)
                setSearchText('')
              }
            }
          : undefined
      }
    >
      <input
        data-combo-search
        ref={searchRef}
        type="text"
        value={searchText}
        onChange={e => setSearchText(e.target.value)}
        placeholder="Search..."
        style={shared ? { ...s.comboSearch, ...st.comboSearch } : s.comboSearch}
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
          filteredItems.map(item => {
            const selected = isSelected(item.id)
            const refused = maxReached && !selected && missingValues.length === 0
            return (
              <div
                key={item.id}
                data-item={item.id}
                role="option"
                aria-selected={selected}
                onClick={() => handleSelectItem(item)}
                // Shared lists: keyboard-operable options (Enter / Space pick, Escape closes).
                tabIndex={shared ? 0 : undefined}
                onKeyDown={
                  shared
                    ? e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectItem(item)
                        }
                      }
                    : undefined
                }
                style={{
                  ...s.optionItem,
                  ...(shared ? st.option : {}),
                  background: selected ? 'var(--accent-soft)' : undefined,
                  cursor: refused ? 'not-allowed' : 'pointer',
                  opacity: refused ? 0.5 : 1,
                }}
              >
                {item.label}
                {shared && selected && <span aria-hidden="true">✓</span>}
              </div>
            )
          })
        )}
        {archivedValues.length > 0 && (
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
        )}
      </div>
    </div>
  )

  // The single-mode control's content
  // Shared lists: a stored value that renders as an ordinary current value —
  // redirected to the org's fork item (the FORK's label), or an active item of
  // another list (its own label). No badge, notice or dirty marker.
  const singlePlain =
    singleStored?.kind === 'redirected' || singleStored?.kind === 'foreign'
      ? singleStored
      : undefined
  const singleDegraded = singleStored && !singlePlain ? singleStored : undefined

  const singleLabel = singlePlain ? (
    <span
      data-selected-label
      data-redirected={singlePlain.effectiveId ? 'true' : undefined}
    >
      {singlePlain.label}
    </span>
  ) : singleStored?.kind === 'archived' ? (
    <span
      data-selected-label
      data-archived="true"
      data-status="archived"
      data-redirected={singleStored.effectiveId ? 'true' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
    >
      {singleStored.label ?? 'Archived value'}
      <span style={s.statusBadge}>Archived</span>
    </span>
  ) : singleStored?.kind === 'missing' ? (
    <span
      data-selected-label
      data-missing="true"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
    >
      Unknown value
      <span style={s.statusBadge}>Unknown</span>
    </span>
  ) : singleSelectedItem ? (
    <span data-selected-label>{singleSelectedItem.label}</span>
  ) : (
    <span style={{ color: 'var(--text-tertiary)' }}>Select an option...</span>
  )

  const comboControl = (
    <button
      data-combo-control
      onClick={handleControlClick}
      type="button"
      disabled={isEmpty}
      style={{
        ...s.comboControl,
        ...(shared ? st.comboControl : {}),
        cursor: isEmpty ? 'not-allowed' : 'pointer',
        opacity: isEmpty ? 0.5 : 1,
        color: singleDegraded ? 'var(--text-tertiary)' : s.comboControl.color,
      }}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={
        singleStored || (shared && !isEmpty)
          ? undefined
          : isEmpty
            ? 'No options available'
            : 'Open selection list'
      }
    >
      {mode === 'single' ? (
        singleLabel
      ) : (
        <span style={{ color: 'var(--text-tertiary)' }}>Add options...</span>
      )}
      <span aria-hidden="true">▾</span>
    </button>
  )

  // Shared lists: which list the key resolved to (from the one lookup) and the
  // overall state; both are absent while the flag is OFF.
  const sharedAttrs = shared
    ? {
        'data-state': storedValues.some(v => v.effectiveId) ? 'redirected' : 'ready',
        ...(effective.source
          ? {
              'data-effective-source':
                effective.source.kind === 'common' ? 'platform' : 'own',
            }
          : {}),
      }
    : {}

  return (
    <div
      data-frame={frameId}
      data-mode={mode}
      data-picker={listKey}
      data-panel="picker"
      {...sharedAttrs}
      style={s.pickerWrap}
      ref={menuRef}
    >
      {/* Empty list state */}
      {isEmpty && (
        <div data-state="empty" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
          No options available.
        </div>
      )}

      {/* Multi: chip display (active, archived and purged values alike) */}
      {mode === 'multi' && (
        <div style={{ marginBottom: hasSelection ? 'var(--space-2)' : 0 }}>
          {hasSelection ? (
            <div
              data-chips
              data-state={archivedValues.length > 0 ? 'archived-selected' : undefined}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}
            >
              {persistedIds.map(id => {
                const stored = storedById.get(id)
                if (stored?.kind === 'missing') {
                  return (
                    <span
                      key={id}
                      data-chip={id}
                      data-missing="true"
                      style={{ ...s.chip, color: 'var(--text-tertiary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
                    >
                      Unknown value
                      <button
                        onClick={() => handleRemoveChip(id)}
                        style={s.chipRemoveBtn}
                        type="button"
                        aria-label="Remove unknown value"
                      >
                        ×
                      </button>
                    </span>
                  )
                }
                // Shared lists: a redirected / foreign value is an ordinary chip with its resolved label.
                const archived = stored?.kind === 'archived' ? stored : undefined
                const label = archived
                  ? archived.label ?? 'Archived value'
                  : stored?.label ?? activeItems.find(it => it.id === id)?.label ?? id
                return (
                  <span
                    key={id}
                    data-chip={id}
                    data-archived={archived ? 'true' : undefined}
                    data-status={archived ? 'archived' : undefined}
                    data-redirected={stored?.effectiveId ? 'true' : undefined}
                    style={archived ? { ...s.chip, color: 'var(--text-tertiary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' } : s.chip}
                  >
                    {label}
                    {archived && <span style={s.statusBadge}>Archived</span>}
                    <button
                      onClick={() => handleRemoveChip(id)}
                      style={s.chipRemoveBtn}
                      type="button"
                      aria-label={`Remove ${label}`}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
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

      {/* Combo control — in single mode it carries the stored (archived / purged) value, if any */}
      {singleDegraded ? (
        <div data-state={singleDegraded.kind === 'archived' ? 'archived-selected' : 'missing'}>
          {comboControl}
        </div>
      ) : (
        comboControl
      )}

      {/* Shared lists: the opt-in provenance caption — it comes with the options, never before them. */}
      {shared && props.showSource && effective.list && (
        <EffectiveListSource source={effective.source} list={effective.list} />
      )}

      {/* Purged / unknown stored value: frame 14 notice + how to resolve it */}
      {missingValues.length > 0 && (
        <p
          data-error="missing"
          role="status"
          data-state={mode === 'multi' ? 'missing' : undefined}
          style={{ ...s.infoNote, color: 'var(--danger)', background: 'var(--danger-soft)' }}
        >
          <span aria-hidden="true">⚠ </span>
          Unknown value — the stored value no longer exists (it was purged), so it has no label. It is kept as-is
          until you {mode === 'multi' ? 'pick a replacement or remove it' : 'pick a replacement'}.
        </p>
      )}

      {/* Combo menu (open state) */}
      {menuEl}

      {/* Resolve matrix: locale fallback display, one per archived stored value */}
      {archivedValues.map(v => {
        const archivedLabel = v.label ?? 'Archived value'
        const archivedLocale = v.locale ?? 'en'
        return (
          <div key={v.id} data-panel="resolve-matrix" data-resolve-for={v.id} style={s.resolveMatrix}>
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
        )
      })}

      {/* Shared lists, harness only: which list the key resolved to. */}
      {shared && props.showInspector && effective.list && (
        <EffectiveListInspector list={effective.list} />
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
  // `value` pre-selects: one id (single); one or more ids, repeated or comma-separated (multi).
  const values = searchParams
    .getAll('value')
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean)
  const maxStr = searchParams.get('max')
  const max = maxStr ? parseInt(maxStr, 10) : undefined
  // Shared-lists switches (ignored by the picker while the flag is OFF).
  const showSource = searchParams.get('showSource') === '1'
  const migrate = searchParams.get('migrate') === '1'
  const [effectiveCalls, setEffectiveCalls] = useState<Array<[string, string]>>([])
  const onEffectiveValue = useCallback(
    (stored: string, effectiveId: string) =>
      setEffectiveCalls(calls => [...calls, [stored, effectiveId]]),
    [],
  )
  const shared = {
    showSource,
    showInspector: true,
    onEffectiveValue: migrate ? onEffectiveValue : undefined,
  }

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
          <SelectionListPicker listKey={listKey} mode="multi" initialValue={values.length ? values : undefined} max={max} {...shared} />
        ) : (
          <SelectionListPicker listKey={listKey} mode="single" initialValue={values[0]} {...shared} />
        )
      ) : (
        <div style={{ color: 'var(--danger)' }}>
          Missing <code>?list=</code> query parameter.
        </div>
      )}

      {/* Shared lists: the host's opt-in migration hook, as the harness records it. */}
      {migrate && (
        <p
          data-migration="host-opt-in"
          data-effective-calls={JSON.stringify(effectiveCalls)}
          style={st.inspector}
        >
          onEffectiveValue calls: {effectiveCalls.length}
        </p>
      )}
    </div>
  )
}

export default SelectionListPickerHarness
