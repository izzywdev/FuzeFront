import { useEffect, useState } from 'react'
import { Skeleton, StatusCallout, Button } from '@fuzefront/design-system'
import { IdentityI18nProvider, RootCustomerInviteFlow } from '@fuzefront/identity-ui'
import { useLanguage } from '../contexts/LanguageContext'
import { getActiveAuthToken } from '../lib/accounts'
import { getOrganizations, type Organization } from '../services/api'

type Role = 'owner' | 'admin' | 'member' | 'viewer'
const isRole = (r: unknown): r is Role => r === 'owner' || r === 'admin' || r === 'member' || r === 'viewer'

/**
 * `/root/customers` (flag `fuzefront.identity.invite-v2`) — the root-org owner's
 * entry point for inviting an external customer (design/frames/org-invitations-v2
 * `05-root-customer-invite.html`, flow `root-customer-invite`).
 *
 * Resolves the PLATFORM root org from the caller's own organizations
 * (`type: 'platform'`) and hands its id + the caller's real `user_role` to
 * `RootCustomerInviteFlow`. Only a root `owner` gets the form; anyone else gets
 * the in-place 403 state (the server re-checks regardless — this only avoids
 * offering an action that can only fail). A caller who is not a member of the
 * root org (`user_role: null`) is treated as non-owner, never as owner.
 */
function RootCustomersPage() {
  const { language } = useLanguage()
  const [root, setRoot] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getOrganizations()
      .then((orgs: Organization[]) => {
        if (!cancelled) setRoot(orgs.find(o => o.type === 'platform') ?? null)
      })
      .catch(err => {
        console.error('Error loading the root organization:', err)
        if (!cancelled) setError('Failed to load the root organization')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <IdentityI18nProvider locale={language === 'he' ? 'he' : 'en'}>
      <div style={{ padding: 'var(--space-8)' }} data-page="root-customers">
        {loading ? (
          <div role="status" aria-busy="true" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Skeleton width="30%" height="2em" />
            <Skeleton width="100%" height="12rem" />
          </div>
        ) : error ? (
          <StatusCallout
            tone="error"
            icon="⚠️"
            title={error}
            actions={
              <Button variant="secondary" size="sm" data-action="retry" onClick={() => setAttempt(a => a + 1)}>
                Try again
              </Button>
            }
          />
        ) : root ? (
          <RootCustomerInviteFlow
            rootOrganizationId={root.id}
            userRole={isRole(root.user_role) ? root.user_role : null}
            getToken={getActiveAuthToken}
          />
        ) : (
          <StatusCallout tone="warning" icon="🔎" title="No root organization found" />
        )}
      </div>
    </IdentityI18nProvider>
  )
}

export default RootCustomersPage
