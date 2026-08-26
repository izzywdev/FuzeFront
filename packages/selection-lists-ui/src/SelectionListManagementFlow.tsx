/**
 * SelectionListManagementFlow — Orchestrator for frames 01-06.
 *
 * Routes:
 *   /settings/selection-lists         → SelectionListIndex (frame 01) + NewListPanel (frame 02)
 *   /settings/selection-lists/:listId → SelectionListDetail (frames 03-05) + QuotaPanel (frame 06)
 */
import React, { useState, useEffect, useCallback, useRef, useId } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type {
  SelectionList,
  SelectionListItem,
  QuotaStatus,
  ApiError,
} from './types'
import {
  listSelectionLists,
  createSelectionList,
  getSelectionList,
  listItems,
  createItem,
  updateItem,
  archiveItem,
  purgeItem,
  reorderItems,
  getQuota,
  unwrapItems,
  unwrapCursor,
  probeReorderPermission,
} from './api'

// ── Regex for the key validation: ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$ ─────────
const KEY_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

// ── Inline styles using DS tokens only ───────────────────────────────────────
const s = {
  frame: { padding: 'var(--space-4)' } as React.CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-3)',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-2)',
  } as React.CSSProperties,
  badge: {
    display: 'inline-block',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-semibold)',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
  } as React.CSSProperties,
  errorBox: {
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--error-soft)',
    color: 'var(--error)',
    marginBottom: 'var(--space-3)',
  } as React.CSSProperties,
  input: {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)',
    width: '100%',
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
  btnDanger: {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--error)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
}

// ── Skeleton placeholder ─────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div
      data-state="loading"
      style={{
        height: 48,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-muted)',
        marginBottom: 'var(--space-2)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  )
}

// ── Quota Panel (frame 06) ────────────────────────────────────────────────────
function QuotaPanel({
  quota,
  quotaLoading,
  quotaError,
  newListDisabled,
}: {
  quota: QuotaStatus | null
  quotaLoading: boolean
  quotaError: boolean
  newListDisabled: boolean
}) {
  return (
    <div data-frame="06-quota" data-panel="quota" style={{ marginTop: 'var(--space-4)' }}>
      {quotaLoading && (
        <div data-state="loading" style={{ height: 40, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }} />
      )}
      {quotaError && (
        <div data-state="error" style={s.errorBox}>
          Quota information unavailable
        </div>
      )}
      {quota && !quotaLoading && !quotaError && (
        <>
          {/* Near-limit banner */}
          {quota.scopes.some(sc => {
            if (sc.current === null) return false
            return sc.current / sc.limit >= 0.8 && sc.current < sc.limit
          }) && (
            <div data-banner="quota-near" style={{ ...s.errorBox, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              You are approaching your quota limit
            </div>
          )}
          {/* At-limit banner */}
          {quota.scopes.some(sc => sc.current !== null && sc.current >= sc.limit) && (
            <div data-banner="quota-at" data-quota-state="at-limit" style={s.errorBox}>
              Quota limit reached
            </div>
          )}
          {/* Scope meters */}
          {quota.scopes.map(sc => (
            <div key={sc.scope} data-quota-scope={sc.scope} style={{ marginBottom: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>
                <span>{sc.scope}</span>
                <span>{sc.current !== null ? `${sc.current} / ${sc.limit}` : `— / ${sc.limit}`}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: sc.current !== null ? `${Math.min(100, (sc.current / sc.limit) * 100)}%` : '0%',
                    background: sc.current !== null && sc.current >= sc.limit ? 'var(--error)' : 'var(--accent)',
                  }}
                />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── New List Panel (frame 02) ─────────────────────────────────────────────────
function NewListPanel({
  onCreated,
  onClose,
}: {
  onCreated: (list: SelectionList) => void
  onClose: () => void
}) {
  const [key, setKey] = useState('')
  const [sourceLoc, setSourceLoc] = useState('en')
  const [submitting, setSubmitting] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [apiError, setApiError] = useState<ApiError | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const validate = () => {
    if (!KEY_REGEX.test(key)) {
      setKeyError('Key must match pattern ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$')
      return false
    }
    setKeyError('')
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setApiError(null)
    setForbidden(false)
    try {
      const list = await createSelectionList({ key, source_locale: sourceLoc })
      onCreated(list)
    } catch (err) {
      const e = err as ApiError & { status?: number }
      setApiError(e)
      if (e.code === 'FORBIDDEN') setForbidden(true)
    } finally {
      setSubmitting(false)
    }
  }

  const atLimit = forbidden

  return (
    <div data-frame="02-new-list" data-panel="new-list" style={{ ...s.frame, maxWidth: 480 }}>
      <h2 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-lg)' }}>New selection list</h2>
      {submitting && (
        <div data-state="submitting" style={{ marginBottom: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          Creating list…
        </div>
      )}
      {apiError?.code === 'CONFLICT' && (
        <div data-error="CONFLICT" style={s.errorBox}>
          A list with that key already exists.
        </div>
      )}
      {apiError?.code === 'QUOTA_EXCEEDED' && (
        <div data-error="QUOTA_EXCEEDED" style={s.errorBox}>
          Quota exceeded: {apiError.scope} ({apiError.current}/{apiError.limit})
        </div>
      )}
      {forbidden && (
        <div data-error="FORBIDDEN" style={s.errorBox}>
          You do not have permission to create lists.
        </div>
      )}
      {keyError && (
        <div data-error="VALIDATION_ERROR" style={s.errorBox}>
          {keyError}
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label style={{ fontSize: 'var(--text-sm)', display: 'block', marginBottom: 'var(--space-1)' }}>
            Key (slug)
          </label>
          <input
            data-field="key"
            type="text"
            value={key}
            onChange={e => setKey(e.target.value)}
            disabled={submitting}
            placeholder="e.g. my-list"
            style={s.input}
          />
          {keyError && (
            <div data-field-error="key" style={{ color: 'var(--error)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
              {keyError}
            </div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 'var(--text-sm)', display: 'block', marginBottom: 'var(--space-1)' }}>
            Source locale
          </label>
          <select
            data-field="source_locale"
            value={sourceLoc}
            onChange={e => setSourceLoc(e.target.value)}
            disabled={submitting}
            style={s.input}
          >
            <option value="en">English (en)</option>
            <option value="fr">French (fr)</option>
            <option value="de">German (de)</option>
            <option value="es">Spanish (es)</option>
            <option value="ar">Arabic (ar)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            data-action="create-list"
            type="submit"
            disabled={submitting || atLimit}
            data-tooltip={atLimit ? 'quota' : undefined}
            style={{ ...s.btn, opacity: submitting || atLimit ? 0.6 : 1 }}
          >
            {submitting ? 'Creating…' : 'Create list'}
          </button>
          <button type="button" style={s.btnGhost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Value Add/Edit Modal (frame 04) ───────────────────────────────────────────
function ValueModal({
  mode,
  item,
  listId,
  onClose,
  onSaved,
  onForbidden,
}: {
  mode: 'add' | 'edit'
  item?: SelectionListItem
  listId: string
  onClose: () => void
  onSaved: (item: SelectionListItem) => void
  onForbidden: () => void
}) {
  const [code, setCode] = useState(item?.code ?? '')
  const [label, setLabel] = useState(item?.label ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<ApiError | null>(null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setApiError(null)
    try {
      let saved: SelectionListItem
      if (mode === 'add') {
        saved = await createItem(listId, { code, label })
      } else {
        saved = await updateItem(listId, item!.id, { label })
      }
      onSaved(saved)
    } catch (err) {
      const e = err as ApiError & { status?: number }
      setApiError(e)
      if (e.code === 'FORBIDDEN') {
        onForbidden()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-frame="04-value-modal"
      data-modal={mode === 'add' ? 'add-value' : 'edit-value'}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        width: '100%',
        maxWidth: 440,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <h3 style={{ marginBottom: 'var(--space-4)' }}>
          {mode === 'add' ? 'Add value' : 'Edit value'}
        </h3>
        {mode === 'edit' && item && (
          <div data-item-id style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            ID: {item.id}
          </div>
        )}
        {apiError?.code === 'CONFLICT' && (
          <div data-error="CONFLICT" style={s.errorBox}>A value with that code already exists.</div>
        )}
        {apiError?.code === 'QUOTA_EXCEEDED' && (
          <div data-error="QUOTA_EXCEEDED" style={s.errorBox}>
            Quota exceeded for {apiError.scope}: {apiError.current}/{apiError.limit}
          </div>
        )}
        {apiError?.code === 'FORBIDDEN' && (
          <div data-error="FORBIDDEN" style={s.errorBox}>You do not have permission to modify values.</div>
        )}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label style={{ fontSize: 'var(--text-sm)', display: 'block', marginBottom: 'var(--space-1)' }}>Code</label>
            <input
              data-field="code"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={mode === 'edit' || submitting}
              style={s.input}
            />
          </div>
          <div>
            <label style={{ fontSize: 'var(--text-sm)', display: 'block', marginBottom: 'var(--space-1)' }}>Label</label>
            <input
              data-field="label"
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              disabled={submitting}
              style={s.input}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button data-action="save-value" type="submit" disabled={submitting} style={s.btn}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button type="button" style={s.btnGhost} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Purge Confirm Modal ────────────────────────────────────────────────────────
function PurgeModal({
  item,
  listId,
  onClose,
  onPurged,
  onArchiveInstead,
}: {
  item: SelectionListItem
  listId: string
  onClose: () => void
  onPurged: (itemId: string) => void
  onArchiveInstead: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<ApiError | null>(null)

  const handlePurge = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setApiError(null)
    try {
      await purgeItem(listId, item.id)
      onPurged(item.id)
    } catch (err) {
      setApiError(err as ApiError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-frame="04-value-modal"
      data-modal="purge-value"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        width: '100%',
        maxWidth: 440,
      }}>
        <h3 style={{ marginBottom: 'var(--space-2)' }}>Permanently purge "{item.code}"?</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          This cannot be undone. All consumers referencing this ID will receive "missing" from /resolve.
        </p>
        {apiError && (
          <div data-error={apiError.code ?? 'ERROR'} style={s.errorBox}>{apiError.message}</div>
        )}
        <form onSubmit={handlePurge} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label style={{ fontSize: 'var(--text-sm)', display: 'block', marginBottom: 'var(--space-1)' }}>
              Type the code <strong>{item.code}</strong> to confirm:
            </label>
            <input
              data-confirm-input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={item.code}
              style={s.input}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              data-action="confirm-purge"
              type="submit"
              disabled={confirmText !== item.code || submitting}
              style={{ ...s.btnDanger, opacity: confirmText !== item.code ? 0.5 : 1 }}
            >
              Permanently purge
            </button>
            <button data-action="archive-instead" type="button" style={s.btnGhost} onClick={onArchiveInstead}>
              Archive instead
            </button>
            <button type="button" style={s.btnGhost} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Sortable Item List with keyboard reorder (frame 05) ────────────────────────
function SortableItemList({
  items,
  listId,
  canReorder,
  forbidden,
  onItemClick,
  onArchive,
  onPurge,
  onReordered,
}: {
  items: SelectionListItem[]
  listId: string
  canReorder: boolean
  forbidden: boolean
  onItemClick: (item: SelectionListItem) => void
  onArchive: (item: SelectionListItem) => void
  onPurge: (item: SelectionListItem) => void
  onReordered: (newOrder: SelectionListItem[]) => void
}) {
  const [orderedItems, setOrderedItems] = useState(items)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [reorderErrorCode, setReorderErrorCode] = useState<string | null>(null)
  const a11yRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOrderedItems(items)
  }, [items])

  const announce = (msg: string) => {
    if (a11yRef.current) a11yRef.current.textContent = msg
  }

  const handleKeyDown = async (e: React.KeyboardEvent, idx: number) => {
    if (!canReorder) return
    if (e.key === ' ') {
      e.preventDefault()
      if (dragIdx === null) {
        setDragIdx(idx)
        announce(`Lifted item ${orderedItems[idx].code}. Use arrow keys to move, Space to drop, Escape to cancel.`)
      } else {
        // Drop: commit reorder
        const newOrder = [...orderedItems]
        const moved = newOrder.splice(dragIdx, 1)[0]
        newOrder.splice(idx, 0, moved)
        setOrderedItems(newOrder)
        setDragIdx(null)
        announce(`Dropped ${moved.code} at position ${idx + 1}.`)
        // Persist
        setSaving(true)
        setReorderError(null)
        setReorderErrorCode(null)
        try {
          const nonArchived = newOrder.filter(i => i.status !== 'archived')
          await reorderItems(listId, newOrder.map(i => i.id))
          onReordered(newOrder)
        } catch (err) {
          const e = err as ApiError
          setReorderError(e.message ?? 'Reorder failed')
          setReorderErrorCode(e.code ?? 'reorder-failed')
          // Restore original order on error
          setOrderedItems(items)
        } finally {
          setSaving(false)
        }
      }
    } else if (e.key === 'ArrowDown' && dragIdx !== null) {
      e.preventDefault()
      const newOrder = [...orderedItems]
      if (dragIdx < newOrder.length - 1) {
        const moved = newOrder.splice(dragIdx, 1)[0]
        const newIdx = dragIdx + 1
        newOrder.splice(newIdx, 0, moved)
        setOrderedItems(newOrder)
        setDragIdx(newIdx)
        announce(`Moved ${moved.code} down to position ${newIdx + 1}.`)
      }
    } else if (e.key === 'ArrowUp' && dragIdx !== null) {
      e.preventDefault()
      const newOrder = [...orderedItems]
      if (dragIdx > 0) {
        const moved = newOrder.splice(dragIdx, 1)[0]
        const newIdx = dragIdx - 1
        newOrder.splice(newIdx, 0, moved)
        setOrderedItems(newOrder)
        setDragIdx(newIdx)
        announce(`Moved ${moved.code} up to position ${newIdx + 1}.`)
      }
    } else if (e.key === 'Escape') {
      if (dragIdx !== null) {
        setDragIdx(null)
        setOrderedItems(items)
        announce('Reorder cancelled.')
      }
    }
  }

  return (
    <div data-reorderable="true">
      {/* a11y live region for keyboard reorder announcements */}
      <div
        ref={a11yRef}
        data-note="reorder-a11y"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          // Must be visible to the a11y tree but keep it in DOM so tests find it
        }}
      />
      {saving && (
        <div data-state="saving" style={{ marginBottom: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          Saving order…
        </div>
      )}
      {reorderError && reorderErrorCode === 'reorder-failed' && (
        <div data-error="reorder-failed" style={s.errorBox}>{reorderError}</div>
      )}
      {reorderError && reorderErrorCode === 'VALIDATION_ERROR' && (
        <div data-error="VALIDATION_ERROR" style={s.errorBox}>{reorderError}</div>
      )}
      {forbidden && (
        <div data-error="FORBIDDEN" style={s.errorBox}>You do not have permission to reorder items.</div>
      )}
      {orderedItems.map((item, idx) => (
        <div
          key={item.id}
          data-item={item.id}
          data-archived={item.status === 'archived' ? 'true' : undefined}
          data-dragging={dragIdx === idx ? 'true' : undefined}
          data-drop-target={dragIdx !== null && dragIdx !== idx ? 'true' : undefined}
          style={{
            ...s.row,
            opacity: item.status === 'archived' ? 0.6 : 1,
            outline: dragIdx === idx ? '2px solid var(--accent)' : undefined,
          }}
        >
          {/* Drag handle — only rendered when reorder is permitted */}
          {canReorder && (
            <div
              data-drag-handle
              tabIndex={0}
              role="button"
              aria-label={`Reorder ${item.code}`}
              onKeyDown={e => handleKeyDown(e, idx)}
              style={{
                cursor: 'grab',
                padding: 'var(--space-1)',
                color: 'var(--text-tertiary)',
                userSelect: 'none',
              }}
            >
              ⠿
            </div>
          )}
          {/* Item info */}
          <div
            style={{ flex: 1, cursor: 'pointer' }}
            onClick={() => onItemClick(item)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onItemClick(item) }}
          >
            <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{item.code}</span>
            <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{item.label}</span>
            {item.is_machine && (
              <span style={{ ...s.badge, marginLeft: 'var(--space-2)' }}>M</span>
            )}
            {item.status === 'archived' && (
              <span style={{ ...s.badge, marginLeft: 'var(--space-2)', background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                Archived
              </span>
            )}
          </div>
          {/* Actions */}
          {item.status !== 'archived' && (
            <button
              data-action="archive-value"
              style={s.btnGhost}
              onClick={() => onArchive(item)}
            >
              Archive
            </button>
          )}
          <button
            data-action="purge-value"
            style={{ ...s.btnGhost, color: 'var(--error)' }}
            onClick={() => onPurge(item)}
          >
            Purge
          </button>
        </div>
      ))}
    </div>
  )
}

// ── SelectionListDetail (frames 03, 04, 05) ────────────────────────────────────
function SelectionListDetail({
  listId,
  onNavigateToTranslations,
  onNavigateToAccess,
}: {
  listId: string
  onNavigateToTranslations: () => void
  onNavigateToAccess: () => void
}) {
  const [list, setList] = useState<SelectionList | null>(null)
  const [items, setItems] = useState<SelectionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [valueModal, setValueModal] = useState<{ mode: 'add' | 'edit'; item?: SelectionListItem } | null>(null)
  const [purgeModal, setPurgeModal] = useState<SelectionListItem | null>(null)
  const [canReorder, setCanReorder] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [mutationForbidden, setMutationForbidden] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const [listData, itemsResp] = await Promise.all([
        getSelectionList(listId),
        listItems(listId),
      ])
      setList(listData)
      const its = unwrapItems(itemsResp).sort((a, b) => a.sort_order - b.sort_order)
      setItems(its)
      // Probe reorder permission
      const allowed = await probeReorderPermission(listId)
      setCanReorder(allowed)
      if (!allowed) setForbidden(true)
    } catch (err) {
      const e = err as ApiError & { status?: number }
      if ((e as unknown as { status?: number }).status === 404 || e.code === 'NOT_FOUND') {
        setNotFound(true)
      } else {
        setError(e.message ?? 'Failed to load')
      }
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => { loadData() }, [loadData])

  if (notFound) {
    return (
      <div data-frame="03-list-detail" data-state="not-found" style={s.frame}>
        <div data-error="NOT_FOUND" style={s.errorBox}>List not found.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div data-frame="03-list-detail" style={s.frame}>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    )
  }

  if (error) {
    return (
      <div data-frame="03-list-detail" data-state="error" style={s.frame}>
        <div style={s.errorBox}>{error}</div>
        <button data-action="retry" style={s.btn} onClick={loadData}>Retry</button>
      </div>
    )
  }

  const handleForbidden = () => {
    setMutationForbidden(true)
    setValueModal(null)
  }

  return (
    <div data-frame="03-list-detail" style={s.frame}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>{list?.name ?? listId}</h2>
        {list?.is_machine && <span data-machine="true" style={s.badge}>M</span>}
        {list?.status === 'archived' && <span data-status="archived" style={{ ...s.badge, background: 'var(--bg-muted)' }}>Archived</span>}
      </div>

      {/* Tab strip */}
      <div data-tabs="list-detail" style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '2px solid var(--border-color)', marginBottom: 'var(--space-4)' }}>
        <button data-tab="translations" style={{ ...s.btnGhost, borderBottom: '2px solid var(--accent)', borderRadius: 0 }} onClick={onNavigateToTranslations}>
          Translations
        </button>
        <button data-tab="access" style={s.btnGhost} onClick={onNavigateToAccess}>
          Access
        </button>
      </div>

      {/* Value editor panel */}
      <div data-panel="value-editor">
        {mutationForbidden && (
          <div data-error="FORBIDDEN" style={s.errorBox}>You do not have permission to modify values.</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <h3 style={{ fontSize: 'var(--text-lg)' }}>Values</h3>
          <button
            data-action="add-value"
            style={s.btn}
            disabled={mutationForbidden}
            onClick={() => setValueModal({ mode: 'add' })}
          >
            Add value
          </button>
        </div>

        {items.length === 0 && (
          <div data-state="empty" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No values yet. Add the first value.
          </div>
        )}

        {items.length > 0 && (
          <SortableItemList
            items={items}
            listId={listId}
            canReorder={canReorder}
            forbidden={forbidden}
            onItemClick={item => setValueModal({ mode: 'edit', item })}
            onArchive={async (item) => {
              try {
                await archiveItem(listId, item.id)
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'archived' } : i))
              } catch (err) {
                const e = err as ApiError
                if (e.code === 'FORBIDDEN') setMutationForbidden(true)
              }
            }}
            onPurge={item => setPurgeModal(item)}
            onReordered={newOrder => setItems(newOrder)}
          />
        )}
      </div>

      {/* Value modal */}
      {valueModal && (
        <ValueModal
          mode={valueModal.mode}
          item={valueModal.item}
          listId={listId}
          onClose={() => setValueModal(null)}
          onForbidden={handleForbidden}
          onSaved={saved => {
            if (valueModal.mode === 'add') {
              setItems(prev => [...prev, saved])
            } else {
              setItems(prev => prev.map(i => i.id === saved.id ? saved : i))
            }
            setValueModal(null)
          }}
        />
      )}

      {/* Purge modal */}
      {purgeModal && (
        <PurgeModal
          item={purgeModal}
          listId={listId}
          onClose={() => setPurgeModal(null)}
          onPurged={itemId => {
            setItems(prev => prev.filter(i => i.id !== itemId))
            setPurgeModal(null)
          }}
          onArchiveInstead={async () => {
            try {
              await archiveItem(listId, purgeModal.id)
              setItems(prev => prev.map(i => i.id === purgeModal.id ? { ...i, status: 'archived' } : i))
              setPurgeModal(null)
            } catch { /* ignore */ }
          }}
        />
      )}
    </div>
  )
}

// ── SelectionListIndex (frame 01) ─────────────────────────────────────────────
function SelectionListIndex({
  onSelectList,
  onNewList,
}: {
  onSelectList: (list: SelectionList) => void
  onNewList: () => void
}) {
  const [lists, setLists] = useState<SelectionList[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(true)
  const [quotaError, setQuotaError] = useState(false)

  const loadLists = useCallback(async (cursorVal?: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await listSelectionLists({ cursor: cursorVal, status: statusFilter })
      const newItems = unwrapItems(resp)
      const nextCursor = unwrapCursor(resp)
      if (cursorVal) {
        setLists(prev => [...prev, ...newItems])
      } else {
        setLists(newItems)
      }
      setCursor(nextCursor)
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load lists')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  const loadQuota = useCallback(async () => {
    setQuotaLoading(true)
    setQuotaError(false)
    try {
      const q = await getQuota()
      setQuota(q)
    } catch {
      setQuotaError(true)
    } finally {
      setQuotaLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLists()
    loadQuota()
  }, [loadLists, loadQuota])

  const atLimit = quota?.scopes.some(sc => sc.current !== null && sc.current >= sc.limit) ?? false
  // Fail-open: if quotaError, never disable the CTA
  const ctaDisabled = !quotaError && atLimit

  return (
    <div data-frame="01-list-index" data-panel="list-index" style={s.frame}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>Selection Lists</h2>
        <button
          data-action="new-list"
          disabled={ctaDisabled}
          data-quota-state={ctaDisabled ? 'at-limit' : undefined}
          data-tooltip={ctaDisabled ? 'quota' : undefined}
          style={{ ...s.btn, opacity: ctaDisabled ? 0.6 : 1 }}
          onClick={onNewList}
        >
          New list
        </button>
      </div>

      {/* Status filter */}
      <select
        data-filter="status"
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
        style={{ ...s.input, width: 'auto', marginBottom: 'var(--space-3)' }}
      >
        <option value="active">Active</option>
        <option value="archived">Archived</option>
        <option value="all">All</option>
      </select>

      {/* Loading skeletons */}
      {loading && lists.length === 0 && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}

      {/* Error state */}
      {error && (
        <div data-state="error" style={s.errorBox}>
          {error}
          <button data-action="retry" style={{ ...s.btn, marginTop: 'var(--space-2)' }} onClick={() => loadLists()}>
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && lists.length === 0 && (
        <div data-state="empty" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p>No lists yet.</p>
          <button data-action="new-list" style={s.btn} onClick={onNewList}>
            Create your first list
          </button>
        </div>
      )}

      {/* List rows */}
      {lists.map(list => (
        <div
          key={list.id}
          data-list={list.key}
          data-status={list.status}
          data-machine={list.is_machine ? 'true' : undefined}
          style={{
            ...s.row,
            cursor: 'pointer',
            opacity: list.status === 'archived' ? 0.6 : 1,
          }}
          onClick={() => onSelectList(list)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelectList(list) }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 'var(--weight-semibold)' }}>{list.name}</span>
            <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
              {list.key}
            </span>
            {list.is_machine && (
              <span data-machine="true" style={{ ...s.badge, marginLeft: 'var(--space-2)' }}>M</span>
            )}
            {list.status === 'archived' && (
              <span data-status="archived" style={{ ...s.badge, marginLeft: 'var(--space-2)', background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                Archived
              </span>
            )}
          </div>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
            {list.item_count} items
          </span>
        </div>
      ))}

      {/* Load more */}
      {cursor && !loading && (
        <button
          data-action="load-more"
          style={{ ...s.btnGhost, width: '100%', marginTop: 'var(--space-2)' }}
          onClick={() => loadLists(cursor)}
        >
          Load more
        </button>
      )}

      {/* Quota panel */}
      <QuotaPanel
        quota={quota}
        quotaLoading={quotaLoading}
        quotaError={quotaError}
        newListDisabled={ctaDisabled}
      />
    </div>
  )
}

// ── SelectionListManagementFlow (orchestrator) ────────────────────────────────
export function SelectionListManagementFlow() {
  const { listId } = useParams<{ listId?: string }>()
  const navigate = useNavigate()
  const [showNewList, setShowNewList] = useState(false)

  if (listId) {
    return (
      <SelectionListDetail
        listId={listId}
        onNavigateToTranslations={() => navigate(`/settings/selection-lists/${listId}/translations`)}
        onNavigateToAccess={() => navigate(`/settings/selection-lists/${listId}/access`)}
      />
    )
  }

  if (showNewList) {
    return (
      <NewListPanel
        onCreated={list => {
          setShowNewList(false)
          navigate(`/settings/selection-lists/${list.id}`)
        }}
        onClose={() => setShowNewList(false)}
      />
    )
  }

  return (
    <SelectionListIndex
      onSelectList={list => navigate(`/settings/selection-lists/${list.id}`)}
      onNewList={() => setShowNewList(true)}
    />
  )
}
