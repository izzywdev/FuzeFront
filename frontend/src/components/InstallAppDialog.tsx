import { useEffect, useMemo, useState } from 'react'
import { useT } from '@fuzefront/i18n'
import { Button, Modal, Spinner, StatusCallout } from '@fuzefront/design-system'
import { useOrganizations } from '../lib/shared'
import {
  AppInstallation,
  AppScopeLevel,
  InstallMode,
  InstallScope,
  getAppInstallations,
  installApp,
  uninstallApp,
} from '../services/api'

/**
 * InstallAppDialog — asks only the questions the app and the caller's role
 * actually leave open.
 *
 * - `scopeLevel: 'both'`      → asks personal vs organization, then self vs everyone.
 * - `scopeLevel: 'personal'`  → asks nothing; confirms and installs.
 * - `scopeLevel: 'organization'` → asks self vs everyone only.
 *
 * `Install for everyone` is disabled for a caller who is not an owner/admin of
 * the target organization. That guard is CONVENIENCE, not enforcement — the API
 * returns 403 regardless. Showing it disabled with the reason teaches the rule
 * instead of letting the user commit and then bounce off a server error.
 *
 * Frames: design/frames/app-scopes-user-menu/03-install-scope.html.
 */

interface InstallAppDialogProps {
  open: boolean
  onClose: () => void
  appId: string
  appName: string
  scopeLevel: AppScopeLevel
  /** Called after a successful install or uninstall. */
  onChanged?: () => void
}

const ORG_ADMIN_ROLES = new Set(['owner', 'admin'])

function RadioCard({
  title,
  description,
  checked,
  disabled,
  onSelect,
  hooks,
}: {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  hooks: Record<string, string | undefined>
}) {
  return (
    <div
      role="radio"
      tabIndex={disabled ? -1 : 0}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      {...hooks}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={e => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
        padding: 'var(--space-4)',
        border: `1px solid ${checked ? 'var(--accent-color)' : 'var(--border-color)'}`,
        borderRadius: 'var(--radius-md)',
        background: checked ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div>
        <div
          style={{
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-md)',
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 'var(--space-1)',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {description}
        </div>
      </div>
    </div>
  )
}

function Legend({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-2xs)',
        letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        marginBottom: 'var(--space-2)',
      }}
    >
      {children}
    </div>
  )
}

export function InstallAppDialog({
  open,
  onClose,
  appId,
  appName,
  scopeLevel,
  onChanged,
}: InstallAppDialogProps) {
  const { t } = useT()
  const { activeOrganization, activeOrganizationId } = useOrganizations()

  const canInstallForEveryone = ORG_ADMIN_ROLES.has(
    activeOrganization?.user_role ?? ''
  )

  // A single-scope app has nothing to choose; seed the only legal value.
  const [scope, setScope] = useState<InstallScope>(
    scopeLevel === 'personal' ? 'personal' : 'organization'
  )
  const [mode, setMode] = useState<InstallMode>('self')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<AppInstallation[] | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    setScope(scopeLevel === 'personal' ? 'personal' : 'organization')
    setMode('self')
    setExisting(null)

    getAppInstallations(appId)
      .then(res => setExisting(res.installations))
      .catch(() => setExisting([]))
  }, [open, appId, scopeLevel])

  // An `everyone` install on the active org is the one installation that is
  // visible to, and reversible by, an admin from this dialog.
  const everyoneInstall = useMemo(
    () =>
      existing?.find(
        i =>
          i.mode === 'everyone' &&
          i.organizationId === activeOrganizationId &&
          i.status === 'active'
      ) ?? null,
    [existing, activeOrganizationId]
  )

  const handleInstall = async () => {
    setBusy(true)
    setError(null)
    try {
      await installApp(appId, {
        scope,
        organizationId:
          scope === 'organization' ? activeOrganizationId ?? undefined : undefined,
        mode: scope === 'organization' ? mode : undefined,
      })
      onChanged?.()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('install.failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleUninstall = async () => {
    if (!everyoneInstall) return
    setBusy(true)
    setError(null)
    try {
      await uninstallApp(appId, everyoneInstall.id)
      onChanged?.()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('install.failed'))
    } finally {
      setBusy(false)
    }
  }

  const orgName = activeOrganization?.name ?? ''
  const showScopeChoice = scopeLevel === 'both'
  const showModeChoice = scope === 'organization' && scopeLevel !== 'personal'

  return (
    <Modal open={open} onClose={onClose} title={t('install.title', { app: appName })}>
      <div
        data-dialog="install-app"
        data-scope-level={scopeLevel}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
      >
        {everyoneInstall ? (
          <StatusCallout
            tone="warning"
            data-guard="already-installed"
            title={t('install.alreadyEveryone')}
          />
        ) : (
          <>
            <p
              style={{
                margin: 0,
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {showScopeChoice
                ? t('install.lead')
                : scopeLevel === 'personal'
                  ? t('install.personalOnly', { app: appName })
                  : t('install.organizationOnly', { app: appName })}
            </p>

            {showScopeChoice && (
              <div role="radiogroup" data-group="scope" aria-label={t('install.scopeLegend')}>
                <Legend>{t('install.scopeLegend')}</Legend>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  <RadioCard
                    title={t('install.personalTitle')}
                    description={t('install.personalDesc')}
                    checked={scope === 'personal'}
                    onSelect={() => setScope('personal')}
                    hooks={{ 'data-scope': 'personal' }}
                  />
                  <RadioCard
                    title={orgName}
                    description={t('install.organizationDesc')}
                    checked={scope === 'organization'}
                    disabled={!activeOrganizationId}
                    onSelect={() => setScope('organization')}
                    hooks={{ 'data-scope': 'organization' }}
                  />
                </div>
              </div>
            )}

            {/* Only rendered for an organization install — a personal install
                is always just you, so there is nothing to ask. */}
            {showModeChoice && (
              <div role="radiogroup" data-group="mode" aria-label={t('install.modeLegend')}>
                <Legend>{t('install.modeLegend')}</Legend>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  <RadioCard
                    title={t('install.selfTitle')}
                    description={t('install.selfDesc')}
                    checked={mode === 'self'}
                    onSelect={() => setMode('self')}
                    hooks={{ 'data-mode': 'self' }}
                  />
                  <RadioCard
                    title={t('install.everyoneTitle')}
                    description={
                      canInstallForEveryone
                        ? t('install.everyoneDesc', { organization: orgName })
                        : t('install.everyoneRequiresAdmin')
                    }
                    checked={mode === 'everyone'}
                    disabled={!canInstallForEveryone}
                    onSelect={() => setMode('everyone')}
                    hooks={{
                      'data-mode': 'everyone',
                      'data-guard': canInstallForEveryone
                        ? undefined
                        : 'requires-org-admin',
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {error && <StatusCallout tone="error" title={error} />}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-3)',
          }}
        >
          <Button variant="ghost" data-action="cancel" onClick={onClose}>
            {everyoneInstall ? t('actions.close') : t('actions.cancel')}
          </Button>
          {everyoneInstall ? (
            <button
              className="btn btn-primary"
              data-action="uninstall"
              disabled={busy}
              onClick={() => void handleUninstall()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              {busy && <Spinner size={14} color="white" />}
              {t('install.uninstallAction')}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              data-action="install"
              disabled={busy || (scope === 'organization' && !activeOrganizationId)}
              onClick={() => void handleInstall()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              {busy && <Spinner size={14} color="white" />}
              {t('install.action')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default InstallAppDialog
