import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LanguageSelector, useT } from '@fuzeone/i18n'
import { Skeleton, StatusCallout } from '@fuzeone/design-system'
import { User, useCurrentUser, useOrganizations } from '../lib/shared'
import { useAccounts } from '../contexts/AccountsContext'
import { usePermissions } from './PermissionGate'
import { getOrganizations, logout, type Organization } from '../services/api'
import NotificationBell from './NotificationBell'

/**
 * UserMenu — the shell's single identity surface.
 *
 * Account, organization and language are all answers to "who am I right now",
 * so they live together behind the avatar rather than scattered across the top
 * bar. The organization switcher and the language selector used to sit in
 * TopBar; consolidating them here is what lets the bar fit a phone.
 *
 * Sections fail INDEPENDENTLY. There is no single "menu failed" state: a failed
 * organization fetch renders an in-place error with a retry while the accounts,
 * language and sign-out sections stay usable. Losing the whole identity surface
 * because one list didn't load would strand the user with no way to switch
 * account or sign out.
 *
 * Frames: design/frames/app-scopes-user-menu/01-user-menu.html + 05-states.html.
 */

interface UserMenuProps {
  user: User | null
}

// ── shared row primitives ──────────────────────────────────────────────────

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  width: '100%',
  // 44px min-height keeps every row a valid touch target on the mobile sheet.
  minHeight: '44px',
  padding: 'var(--space-2) var(--space-3)',
  border: 'none',
  background: 'transparent',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-md)',
  textAlign: 'left',
  cursor: 'pointer',
}

const truncate: React.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

interface MenuRowProps {
  title: string
  subtitle?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  checked?: boolean
  disabled?: boolean
  tone?: 'default' | 'danger'
  onClick?: () => void
  /** Spread onto the button — carries the data-* hooks the frames declare. */
  hooks?: Record<string, string | undefined>
  role?: string
}

function MenuRow({
  title,
  subtitle,
  leading,
  trailing,
  checked,
  disabled,
  tone = 'default',
  onClick,
  hooks,
  role = 'menuitem',
}: MenuRowProps) {
  const isDanger = tone === 'danger'
  const restColor = isDanger ? 'var(--error-color)' : 'var(--text-secondary)'

  return (
    <button
      type="button"
      role={role}
      aria-checked={checked === undefined ? undefined : checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      {...hooks}
      style={{
        ...rowStyle,
        color: checked ? 'var(--text-primary)' : restColor,
        background: checked ? 'var(--accent-soft)' : 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={e => {
        if (disabled || checked) return
        e.currentTarget.style.background = isDanger
          ? 'color-mix(in srgb, var(--error-color) 12%, transparent)'
          : 'var(--bg-quaternary)'
        if (!isDanger) e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={e => {
        if (disabled || checked) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = restColor
      }}
    >
      {leading}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={truncate}>{title}</span>
        {subtitle && (
          <span
            style={{
              ...truncate,
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-tertiary)',
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
      {checked && (
        <span aria-hidden="true" style={{ color: 'var(--accent-color)', flex: 'none' }}>
          ✓
        </span>
      )}
    </button>
  )
}

function SectionLabel({
  label,
  count,
}: {
  label: string
  count?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2) var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-2xs)',
        letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
      }}
    >
      <span>{label}</span>
      {count}
    </div>
  )
}

function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  if (parts.length === 1 && parts[0]) return parts[0][0].toUpperCase()
  return (email || '?')[0].toUpperCase()
}

function MiniAvatar({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '26px',
        height: '26px',
        flex: 'none',
        borderRadius: 'var(--radius-pill)',
        background:
          'linear-gradient(45deg, var(--accent-color), var(--accent-hover))',
        display: 'grid',
        placeItems: 'center',
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-semibold)',
        color: 'white',
      }}
    >
      {label}
    </span>
  )
}

// ── account switcher ───────────────────────────────────────────────────────

export function AccountSwitcherSection({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useT()
  const { accounts, activeAccountId, maxAccounts, canAdd, select, addAccount } =
    useAccounts()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  // The roster is local state, so it never has a loading phase — only the
  // organization list can be pending (see 05-states.html, "menu loading").
  return (
    <div data-section="accounts" style={{ borderTop: '1px solid var(--border-color)' }}>
      <SectionLabel
        label={t('accounts.label')}
        count={
          <span data-account-count style={{ fontVariantNumeric: 'tabular-nums' }}>
            {accounts.length} / {maxAccounts}
          </span>
        }
      />

      {accounts.map(account => {
        const isActive = account.id === activeAccountId
        return (
          <MenuRow
            key={account.id}
            role="menuitemradio"
            checked={isActive}
            title={account.displayName || account.email}
            subtitle={
              account.expired
                ? t('accounts.expired')
                : account.email
            }
            leading={
              <MiniAvatar
                label={initialsOf(account.displayName, account.email)}
              />
            }
            hooks={{
              'data-account': account.id,
              'data-account-state': account.expired ? 'expired' : undefined,
              'data-state': switchingTo === account.id ? 'switching' : undefined,
            }}
            onClick={() => {
              if (isActive) {
                onNavigate()
                return
              }
              // Selecting an expired account routes to sign-in for it rather
              // than borrowing another account's token.
              setSwitchingTo(account.id)
              select(account.id)
            }}
            trailing={
              !isActive ? (
                <SignOutAccountButton accountId={account.id} />
              ) : undefined
            }
          />
        )
      })}

      <MenuRow
        title={t('accounts.add')}
        subtitle={
          canAdd
            ? undefined
            : t('accounts.limitReached', { max: maxAccounts })
        }
        leading={<MiniAvatar label="＋" />}
        disabled={!canAdd}
        hooks={{
          'data-action': 'add-account',
          'data-guard': canAdd ? undefined : 'max-accounts',
        }}
        onClick={addAccount}
      />
    </div>
  )
}

/** Per-row sign-out. Nested inside a row button, so it stops propagation —
 *  clicking "Sign out" must not also switch to that account first. */
function SignOutAccountButton({ accountId }: { accountId: string }) {
  const { t } = useT()
  const { signOutAccount } = useAccounts()
  const [busy, setBusy] = useState(false)

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t('accounts.signOutOf')}
      data-action="sign-out-account"
      data-account-id={accountId}
      onClick={e => {
        e.stopPropagation()
        if (busy) return
        setBusy(true)
        void signOutAccount(accountId)
      }}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.stopPropagation()
        e.preventDefault()
        if (busy) return
        setBusy(true)
        void signOutAccount(accountId)
      }}
      style={{
        flex: 'none',
        color: 'var(--accent-color)',
        fontSize: 'var(--text-2xs)',
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        cursor: busy ? 'progress' : 'pointer',
      }}
    >
      {t('actions.signOut')}
    </span>
  )
}

// ── organization switcher ──────────────────────────────────────────────────

export function OrganizationSwitcherSection({
  open,
  onNavigate,
}: {
  open: boolean
  onNavigate: () => void
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const { hasPermission } = usePermissions()
  const {
    organizations: contextOrganizations,
    activeOrganizationId,
    setActiveOrganization,
  } = useOrganizations()

  // The gate usually populates org context before the menu can be opened. Only
  // fetch when it hasn't — that is the one path with a real loading state.
  const [fetched, setFetched] = useState<Organization[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [canCreate, setCanCreate] = useState(false)

  const organizations =
    contextOrganizations.length > 0 ? contextOrganizations : (fetched ?? [])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setFetched(await getOrganizations())
      setStatus('idle')
    } catch (error) {
      console.error('Failed to load organizations:', error)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    if (contextOrganizations.length === 0 && fetched === null && status === 'idle') {
      void load()
    }
  }, [open, contextOrganizations.length, fetched, status, load])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    hasPermission('Organization:create')
      .then(allowed => {
        if (!cancelled) setCanCreate(allowed)
      })
      .catch(() => {
        if (!cancelled) setCanCreate(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, hasPermission])

  const sectionState =
    status === 'error'
      ? 'error'
      : status === 'loading'
        ? 'loading'
        : organizations.length === 0
          ? 'empty'
          : undefined

  return (
    <div
      data-section="organizations"
      data-state={sectionState}
      style={{ borderTop: '1px solid var(--border-color)' }}
    >
      <SectionLabel
        label={t('organizations.label')}
      />

      {status === 'loading' && (
        <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
          <Skeleton height="14px" width="70%" />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Skeleton height="14px" width="50%" />
          </div>
        </div>
      )}

      {status === 'error' && (
        // In place, so the rest of the menu keeps working.
        <div style={{ padding: 'var(--space-3)' }}>
          <StatusCallout
            tone="error"
            title={t('organizations.loadFailed')}
            actions={
              <button
                className="btn btn-ghost"
                data-action="retry"
                onClick={() => void load()}
              >
                {t('actions.retry')}
              </button>
            }
          />
        </div>
      )}

      {status === 'idle' && organizations.length === 0 && (
        <div
          data-empty
          style={{
            padding: 'var(--space-6) var(--space-3)',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {t('organizations.none')}
        </div>
      )}

      {status === 'idle' &&
        organizations.map(org => (
          <MenuRow
            key={org.id}
            role="menuitemradio"
            checked={org.id === activeOrganizationId}
            title={org.name}
            subtitle={
              org.user_role
                ? `${org.user_role}${
                    org.member_count ? ` · ${org.member_count}` : ''
                  }`
                : undefined
            }
            hooks={{ 'data-organization': org.id }}
            onClick={() => {
              setActiveOrganization(org.id)
              onNavigate()
            }}
          />
        ))}

      {canCreate && (
        <MenuRow
          title={`＋ ${t('organizations.create')}`}
          hooks={{ 'data-action': 'create-organization' }}
          onClick={() => {
            onNavigate()
            navigate('/organizations/new')
          }}
        />
      )}
    </div>
  )
}

// ── language ───────────────────────────────────────────────────────────────

export function LanguageSection() {
  const { t } = useT()
  // The selector drives the shared i18next instance and flips <html dir>
  // through the centralized direction manager — the menu only hosts it.
  const [failed, setFailed] = useState(false)

  return (
    <div
      data-section="language"
      data-state={failed ? 'error' : undefined}
      style={{ borderTop: '1px solid var(--border-color)' }}
    >
      <SectionLabel label={t('language.label')} />
      <div
        style={{ padding: '0 var(--space-3) var(--space-2)' }}
        data-control="language-select"
      >
        <LanguageSelector
          hideLabel
          onChange={() => setFailed(false)}
        />
      </div>
      {failed && (
        <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
          <StatusCallout
            tone="warning"
            title={t('language.switchFailed')}
          />
        </div>
      )}
    </div>
  )
}

// ── the menu ───────────────────────────────────────────────────────────────

function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const { t } = useT()
  const navigate = useNavigate()
  const { setUser } = useCurrentUser()

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      // `logout()` erases the account from the vault either way, so land on the
      // root and let the shell resolve whichever account remains (or sign-in).
      setUser(null)
      window.location.href = '/'
    }
  }

  if (!user) {
    return (
      <div>
        <button
          className="btn btn-primary"
          data-topbar-control="sign-in"
          onClick={() => (window.location.href = '/login')}
        >
          {t('actions.signIn')}
        </button>
      </div>
    )
  }

  const displayName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.firstName || user.email
  const isAdmin = user.roles.includes('admin')
  const close = () => setOpen(false)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <NotificationBell />

      <div style={{ position: 'relative' }}>
        <button
          data-topbar-control="user-menu"
          aria-haspopup="menu"
          aria-expanded={open}
          style={{
            background:
              'linear-gradient(45deg, var(--accent-color), var(--accent-hover))',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
          }}
          onClick={() => setOpen(v => !v)}
          title={displayName}
        >
          {initialsOf(displayName, user.email)}
        </button>

        {open && (
          <>
            <div
              aria-hidden="true"
              onClick={close}
              style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 999 }}
            />
            <div
              role="menu"
              aria-label={`Account menu for ${displayName}`}
              data-panel="user-menu"
              className="user-menu-panel"
              style={{
                position: 'absolute',
                top: '100%',
                insetInlineEnd: 0,
                marginTop: 'var(--space-2)',
                width: '320px',
                maxWidth: 'calc(100vw - var(--space-4))',
                maxHeight: 'calc(100vh - var(--top-bar-height) - var(--space-6))',
                overflowY: 'auto',
                padding: 'var(--space-2)',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 16px 48px var(--shadow)',
                zIndex: 1000,
              }}
            >
              {/* Account header */}
              <div style={{ padding: 'var(--space-3)' }}>
                <div
                  style={{
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-md)',
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    ...truncate,
                    marginTop: 'var(--space-1)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {user.email}
                </div>
                <div
                  style={{
                    marginTop: 'var(--space-2)',
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--weight-semibold)',
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase',
                    color: 'var(--accent-color)',
                  }}
                >
                  {isAdmin ? t('roles.administrator') : t('roles.user')}
                </div>
              </div>

              <AccountSwitcherSection onNavigate={close} />
              <OrganizationSwitcherSection open={open} onNavigate={close} />
              <LanguageSection />

              <div
                data-section="actions"
                style={{ borderTop: '1px solid var(--border-color)' }}
              >
                <MenuRow
                  title={`👤 ${t('nav.profile')}`}
                  hooks={{ 'data-action': 'profile' }}
                  onClick={() => {
                    close()
                    navigate('/profile')
                  }}
                />
                <MenuRow
                  title={`⚙️ ${t('nav.settings')}`}
                  hooks={{ 'data-action': 'settings' }}
                  onClick={() => {
                    close()
                    navigate('/account/security')
                  }}
                />
                {/* Gated on the ACTIVE account's role — switching to a
                    non-admin account removes it. */}
                {isAdmin && (
                  <MenuRow
                    title={`🛠️ ${t('nav.adminPanel')}`}
                    hooks={{ 'data-action': 'admin' }}
                    onClick={() => {
                      close()
                      navigate('/admin')
                    }}
                  />
                )}
                <MenuRow
                  title={`🚪 ${t('actions.signOut')}`}
                  tone="danger"
                  hooks={{ 'data-action': 'sign-out' }}
                  onClick={() => {
                    close()
                    void handleLogout()
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default UserMenu
