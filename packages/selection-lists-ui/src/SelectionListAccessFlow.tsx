/**
 * SelectionListAccessFlow — Orchestrator for frames 10-11.
 *
 * Routes:
 *   /settings/selection-lists/:listId/access → AccessPanel (frame 10) + AddAccessModal (frame 11)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type { AccessGrant, ApiError } from './types'
import {
  getAccessGrants,
  updateAccessGrant,
  revokeAccessGrant,
  searchUsers,
} from './api'

// ── Inline styles using DS tokens only ────────────────────────────────────────
const s = {
  frame: { padding: 'var(--space-4)' } as React.CSSProperties,
  panel: {
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  } as React.CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-3)',
    borderBottom: '1px solid var(--border-color)',
  } as React.CSSProperties,
  select: {
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
  btn: {
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
  btnPrimary: {
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
  btnDanger: {
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--danger)',
    background: 'transparent',
    color: 'var(--danger)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
  errorBanner: {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    fontSize: 'var(--text-sm)',
    marginBottom: 'var(--space-3)',
  } as React.CSSProperties,
  matrixTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 'var(--text-sm)',
  } as React.CSSProperties,
  matrixTh: {
    padding: 'var(--space-2)',
    borderBottom: '2px solid var(--border-color)',
    textAlign: 'left' as const,
    fontWeight: 'var(--weight-semibold)',
    color: 'var(--text-secondary)',
  } as React.CSSProperties,
  matrixTd: {
    padding: 'var(--space-2)',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
  } as React.CSSProperties,
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  } as React.CSSProperties,
  modal: {
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
    width: 'min(480px, 90vw)',
    boxShadow: 'var(--shadow-lg)',
  } as React.CSSProperties,
  searchInput: {
    width: '100%',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  userResult: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    marginBottom: 'var(--space-1)',
  } as React.CSSProperties,
}

// ── Role capability matrix ────────────────────────────────────────────────────
const ROLE_MATRIX = [
  { role: 'list-owner', label: 'List Owner', canView: true, canTranslate: true, canManageValues: true, canManageAccess: true },
  { role: 'list-translator', label: 'Translator', canView: true, canTranslate: true, canManageValues: false, canManageAccess: false },
  { role: 'list-viewer', label: 'Viewer', canView: true, canTranslate: false, canManageValues: false, canManageAccess: false },
]

const ALL_ROLES = ['list-owner', 'list-translator', 'list-viewer']

// ── Per-row UI state ──────────────────────────────────────────────────────────
interface RowUI {
  role: string
  saving: boolean
  error: string | null
  errorCase: string | null
}

// ── Add-access modal state ────────────────────────────────────────────────────
interface SearchUser {
  id: string
  name: string
  email: string
  already_granted?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// AddAccessModal — frame 11
// ─────────────────────────────────────────────────────────────────────────────
interface AddAccessModalProps {
  listId: string
  existingGrantUserIds: string[]
  onClose: () => void
  onGranted: () => void
}

function AddAccessModal({ listId, existingGrantUserIds, onClose, onGranted }: AddAccessModalProps) {
  const [searchText, setSearchText] = useState('')
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'loaded' | 'empty'>('idle')
  const [results, setResults] = useState<SearchUser[]>([])
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null)
  const [selectedRole, setSelectedRole] = useState('list-viewer')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirmForbidden, setConfirmForbidden] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchState('idle')
      setResults([])
      return
    }
    setSearchState('loading')
    try {
      const users = await searchUsers(query)
      const augmented = users.map(u => ({
        ...u,
        already_granted: u.already_granted ?? existingGrantUserIds.includes(u.id),
      }))
      if (augmented.length === 0) {
        setSearchState('empty')
      } else {
        setSearchState('loaded')
      }
      setResults(augmented)
    } catch {
      setSearchState('empty')
      setResults([])
    }
  }, [existingGrantUserIds])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchText(val)
    if (!val.trim()) {
      setSearchState('idle')
      setResults([])
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return
    }
    // Show loading immediately
    setSearchState('loading')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 100)
  }

  const handleConfirm = async () => {
    if (!selectedUser || confirming) return
    setConfirming(true)
    setConfirmError(null)
    try {
      await updateAccessGrant(listId, selectedUser.id, { role: selectedRole })
      onGranted()
      onClose()
    } catch (err) {
      const apiErr = err as ApiError & { status?: number }
      if (apiErr.status === 403 || apiErr.code === 'FORBIDDEN') {
        setConfirmForbidden(true)
        setConfirmError('FORBIDDEN')
      } else if (apiErr.status === 404 || apiErr.code === 'NOT_FOUND') {
        setConfirmError('NOT_FOUND')
        // Remove the user from results
        setResults(prev => prev.filter(u => u.id !== selectedUser.id))
        setSelectedUser(null)
      } else {
        setConfirmError(apiErr.code ?? 'UNKNOWN')
      }
    } finally {
      setConfirming(false)
    }
  }

  const showUserSearch = searchState === 'loading' || searchState === 'loaded' || searchState === 'empty'
  const confirmDisabled = !selectedUser || confirming || confirmForbidden

  return (
    <div style={s.overlay} role="dialog" aria-modal="true">
      {/* Frame 11 wrapper */}
      <div data-frame="11-add-access-modal">
        <div data-modal="add-access" style={s.modal}>
          <h3 style={{ margin: '0 0 var(--space-4)', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Add Access
          </h3>

          {confirmError && (
            <div
              data-error={confirmError}
              style={s.errorBanner}
            >
              {confirmError === 'NOT_FOUND'
                ? 'User not found in the organization.'
                : confirmError === 'FORBIDDEN'
                  ? 'You do not have permission to manage access for this list.'
                  : `Error: ${confirmError}`}
            </div>
          )}

          {/* User search input */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Search users
            </label>
            <input
              data-user-search
              type="text"
              value={searchText}
              onChange={handleSearchChange}
              placeholder="Search by name or email..."
              style={s.searchInput}
              autoFocus
            />
          </div>

          {/* User results */}
          <div data-user-results style={{ minHeight: 'var(--space-10)', marginBottom: 'var(--space-4)' }}>
            {searchState === 'loading' && (
              <div
                data-panel="user-search"
                data-state="loading"
                style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}
              >
                Searching...
              </div>
            )}
            {searchState === 'empty' && (
              <div
                data-panel="user-search"
                data-state="empty"
                style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}
              >
                No users found.
              </div>
            )}
            {searchState === 'loaded' && results.map(user => (
              <div
                key={user.id}
                data-user={user.id}
                data-already-granted={user.already_granted ? 'true' : undefined}
                onClick={() => !user.already_granted && setSelectedUser(user)}
                style={{
                  ...s.userResult,
                  background: selectedUser?.id === user.id ? 'var(--accent-soft)' : 'transparent',
                  opacity: user.already_granted ? 0.5 : 1,
                  cursor: user.already_granted ? 'not-allowed' : 'pointer',
                }}
              >
                <span style={{ fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                  {user.name}
                </span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                  {user.email}
                </span>
                {user.already_granted && (
                  <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    Already granted
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Role selection */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Role
            </label>
            <select
              data-role-select
              value={selectedRole}
              onChange={e => setSelectedRole(e.target.value)}
              disabled={confirmForbidden}
              style={s.select}
            >
              {ALL_ROLES.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={s.btn}
              type="button"
            >
              Cancel
            </button>
            <button
              data-action="confirm-add-access"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              style={{
                ...s.btnPrimary,
                opacity: confirmDisabled ? 0.5 : 1,
                cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              }}
              type="button"
            >
              {confirming ? 'Adding...' : 'Add Access'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AccessPanel — frame 10
// ─────────────────────────────────────────────────────────────────────────────
interface AccessPanelProps {
  listId: string
}

function AccessPanel({ listId }: AccessPanelProps) {
  const [grants, setGrants] = useState<AccessGrant[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'loaded'>('loading')
  // Panel-level FORBIDDEN: set after any 403, locks down all controls
  const [panelForbidden, setPanelForbidden] = useState(false)
  // Per-row UI state (keyed by userId)
  const [rowUIs, setRowUIs] = useState<Map<string, RowUI>>(new Map())
  const [showModal, setShowModal] = useState(false)

  const loadGrants = useCallback(async () => {
    setLoadState('loading')
    setPanelForbidden(false)
    try {
      const data = await getAccessGrants(listId)
      setGrants(data)
      // Initialize per-row UI state
      const map = new Map<string, RowUI>()
      data.forEach(g => map.set(g.user_id, { role: g.role, saving: false, error: null, errorCase: null }))
      setRowUIs(map)
      setLoadState('loaded')
    } catch {
      setLoadState('error')
    }
  }, [listId])

  useEffect(() => { loadGrants() }, [loadGrants])

  const setRowUI = (userId: string, patch: Partial<RowUI>) => {
    setRowUIs(prev => {
      const next = new Map(prev)
      const cur = next.get(userId) ?? { role: '', saving: false, error: null, errorCase: null }
      next.set(userId, { ...cur, ...patch })
      return next
    })
  }

  const handleRoleChange = async (grant: AccessGrant, newRole: string) => {
    const ui = rowUIs.get(grant.user_id)
    if (!ui) return
    const prevRole = ui.role
    // Show saving state (optimistic: show new value while saving)
    setRowUI(grant.user_id, { role: newRole, saving: true, error: null, errorCase: null })
    try {
      await updateAccessGrant(listId, grant.user_id, { role: newRole })
      setRowUI(grant.user_id, { saving: false })
      // Refresh grants list to sync
      const updated = await getAccessGrants(listId)
      setGrants(updated)
      const map = new Map<string, RowUI>()
      updated.forEach(g => {
        const existing = rowUIs.get(g.user_id)
        map.set(g.user_id, existing ? { ...existing, role: g.role, saving: false } : { role: g.role, saving: false, error: null, errorCase: null })
      })
      setRowUIs(map)
    } catch (err) {
      const apiErr = err as ApiError & { status?: number }
      if (apiErr.status === 403 || apiErr.code === 'FORBIDDEN') {
        setPanelForbidden(true)
        setRowUI(grant.user_id, { role: prevRole, saving: false, error: 'FORBIDDEN', errorCase: null })
      } else if (apiErr.status === 409 || apiErr.code === 'CONFLICT') {
        // Revert to previous role; re-enable revoke
        setRowUI(grant.user_id, { role: prevRole, saving: false, error: 'CONFLICT', errorCase: 'last-owner' })
      } else {
        setRowUI(grant.user_id, { role: prevRole, saving: false, error: apiErr.code ?? 'UNKNOWN', errorCase: null })
      }
    }
  }

  const handleRevoke = async (grant: AccessGrant) => {
    setRowUI(grant.user_id, { saving: true, error: null, errorCase: null })
    try {
      await revokeAccessGrant(listId, grant.user_id)
      // Remove from list
      setGrants(prev => prev.filter(g => g.user_id !== grant.user_id))
      setRowUIs(prev => {
        const next = new Map(prev)
        next.delete(grant.user_id)
        return next
      })
    } catch (err) {
      const apiErr = err as ApiError & { status?: number }
      if (apiErr.status === 403 || apiErr.code === 'FORBIDDEN') {
        setPanelForbidden(true)
        setRowUI(grant.user_id, { saving: false, error: 'FORBIDDEN', errorCase: null })
      } else if (apiErr.status === 409 || apiErr.code === 'CONFLICT') {
        setRowUI(grant.user_id, { saving: false, error: 'CONFLICT', errorCase: 'last-owner' })
      } else {
        setRowUI(grant.user_id, { saving: false, error: apiErr.code ?? 'UNKNOWN', errorCase: null })
      }
    }
  }

  const handleGranted = () => { loadGrants() }

  return (
    <div data-frame="10-access-panel" style={s.frame}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Access Control
        </h2>
        <button
          data-action="add-access"
          onClick={() => setShowModal(true)}
          disabled={panelForbidden}
          style={{
            ...s.btnPrimary,
            opacity: panelForbidden ? 0.5 : 1,
            cursor: panelForbidden ? 'not-allowed' : 'pointer',
          }}
          type="button"
        >
          Add Access
        </button>
      </div>

      {/* Panel-level FORBIDDEN */}
      {panelForbidden && (
        <div data-error="FORBIDDEN" style={s.errorBanner}>
          You do not have permission to manage access for this list. The table is read-only.
        </div>
      )}

      {/* Grants table */}
      <div data-panel="access" style={s.panel}>
        {loadState === 'loading' && (
          <div style={{ padding: 'var(--space-4)', color: 'var(--text-tertiary)' }}>Loading access grants...</div>
        )}
        {loadState === 'error' && (
          <div data-state="error" style={{ padding: 'var(--space-4)', color: 'var(--danger)' }}>
            Failed to load access grants.
            <button onClick={loadGrants} style={{ ...s.btn, marginLeft: 'var(--space-3)' }}>
              Retry
            </button>
          </div>
        )}
        {loadState === 'loaded' && grants.length === 0 && (
          <div data-state="empty" style={{ padding: 'var(--space-4)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            No access grants. Click "Add Access" to grant access.
          </div>
        )}
        {loadState === 'loaded' && grants.map(grant => {
          const ui = rowUIs.get(grant.user_id) ?? { role: grant.role, saving: false, error: null, errorCase: null }
          const isDisabled = panelForbidden || ui.saving
          return (
            <div
              key={grant.user_id}
              data-grant={grant.user_id}
              data-sole-owner={grant.is_sole_owner ? 'true' : undefined}
              data-role={ui.role}
              style={s.row}
            >
              {/* User info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                  {grant.user_id}
                </div>
                {grant.is_sole_owner && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: 'var(--space-1)', display: 'block' }}>
                    Sole owner
                  </span>
                )}
              </div>

              {/* Role select */}
              <select
                data-role-select
                value={ui.role}
                onChange={e => handleRoleChange(grant, e.target.value)}
                disabled={isDisabled}
                style={{ ...s.select, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                aria-label={`Role for ${grant.user_id}`}
              >
                {ALL_ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              {/* Row error */}
              {ui.error && ui.error !== 'FORBIDDEN' && (
                <span
                  data-error={ui.error}
                  data-case={ui.errorCase ?? undefined}
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', maxWidth: '12rem' }}
                >
                  {ui.error === 'CONFLICT'
                    ? 'Cannot demote/remove the sole owner.'
                    : ui.error}
                </span>
              )}

              {/* Revoke button */}
              <button
                data-action="revoke-access"
                onClick={() => handleRevoke(grant)}
                disabled={isDisabled}
                style={{
                  ...s.btnDanger,
                  opacity: isDisabled ? 0.5 : 1,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                }}
                type="button"
                aria-label={`Revoke access for ${grant.user_id}`}
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>

      {/* Role capability matrix */}
      <div data-panel="role-matrix" style={s.panel}>
        <h3 style={{ margin: '0 0 var(--space-3)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>
          Role Capabilities
        </h3>
        <table style={s.matrixTable} aria-label="Role capability matrix">
          <thead>
            <tr>
              <th style={s.matrixTh}>Role</th>
              <th style={s.matrixTh}>View</th>
              <th style={s.matrixTh}>Translate</th>
              <th style={s.matrixTh}>Manage Values</th>
              <th style={s.matrixTh}>Manage Access</th>
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map(r => (
              <tr key={r.role} data-role={r.role}>
                <td style={s.matrixTd}>{r.label}</td>
                <td style={s.matrixTd}>{r.canView ? '✓' : '—'}</td>
                <td style={s.matrixTd}>{r.canTranslate ? '✓' : '—'}</td>
                <td style={s.matrixTd}>{r.canManageValues ? '✓' : '—'}</td>
                <td style={s.matrixTd}>{r.canManageAccess ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add access modal (frame 11) */}
      {showModal && (
        <AddAccessModal
          listId={listId}
          existingGrantUserIds={grants.map(g => g.user_id)}
          onClose={() => setShowModal(false)}
          onGranted={handleGranted}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectionListAccessFlow — Route orchestrator
// ─────────────────────────────────────────────────────────────────────────────
export function SelectionListAccessFlow() {
  const { listId } = useParams<{ listId: string }>()

  if (!listId) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--danger)' }}>
        Missing list ID in URL.
      </div>
    )
  }

  return <AccessPanel listId={listId} />
}

export default SelectionListAccessFlow
