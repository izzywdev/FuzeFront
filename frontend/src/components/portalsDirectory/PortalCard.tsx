import { Button } from '@fuzefront/design-system'
import type { AdminPortal } from '../../services/adminPortalsService'
import { PortalStatusBadge } from './PortalStatusBadge'
import { PortalTierBadge } from './PortalTierBadge'
import { OpenPortalLink } from './OpenPortalLink'

/** Display-only domain text — derives from the server-provided `launchUrl`
 * when there's no `primaryDomain` (e.g. the `/p/{slug}` path route). This
 * NEVER composes a navigable value; it only formats what the server already
 * returned for display, matching `data-domain="primary"` in the frame. */
function displayDomain(portal: AdminPortal): string {
  if (portal.primaryDomain) return portal.primaryDomain
  if (portal.launchUrl) {
    try {
      const u = new URL(portal.launchUrl)
      return u.pathname && u.pathname !== '/' ? `${u.host}${u.pathname}` : u.host
    } catch {
      /* fall through to the slug */
    }
  }
  return portal.slug
}

/**
 * The content of a single portal directory entry: name + status + tier
 * badges, domain, and the launch action (or its fail-closed absence).
 * `PortalRow` supplies the list-item semantics/test hooks around this.
 */
export function PortalCard({
  portal,
  canOpen,
}: {
  portal: AdminPortal
  /** False in the fail-closed permission-denied case — when false, NO launch
   * anchor or button is ever rendered for this row (the launch column is
   * absent, not disabled). */
  canOpen: boolean
}) {
  const hasCustomDomain = Boolean(portal.primaryDomain)

  return (
    <>
      <div className="pd-row__main">
        <div className="pd-row__top">
          <span className="pd-row__name">{portal.name}</span>
          <PortalStatusBadge status={portal.status} />
          {portal.identity_mode && <PortalTierBadge tier={portal.identity_mode} />}
        </div>
        <div className="pd-row__meta">
          <span
            className={hasCustomDomain ? 'pd-row__domain' : 'pd-row__domain pd-row__domain--muted'}
            data-domain="primary"
          >
            {displayDomain(portal)}
          </span>
          {!hasCustomDomain && <span className="pd-tag">no custom domain</span>}
          {portal.identity_mode === 'hard' && (
            <span className="pd-tag" title="Authenticates against its own Authentik instance">
              own IdP
            </span>
          )}
        </div>
      </div>
      <div className="pd-row__side">
        {!canOpen ? (
          <span className="pd-muted" data-action-absent="open-portal">
            — no access —
          </span>
        ) : portal.status === 'suspended' ? (
          <Button
            variant="secondary"
            disabled
            title="A suspended portal cannot be opened"
            data-action="open-portal"
            data-portal-target={portal.id}
          >
            Open portal
          </Button>
        ) : portal.launchUrl ? (
          <OpenPortalLink portalId={portal.id} launchUrl={portal.launchUrl} />
        ) : (
          <span className="pd-muted">—</span>
        )}
      </div>
    </>
  )
}
