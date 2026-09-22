import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'
import { createAuthentikRedirectRegistrar } from '../custom-domains/authentikRedirect'

/**
 * Portal teardown — the backend's reaction to `identity.org.deleted`
 * (FFRNT-174). The security-service soft-deletes an organization and emits the
 * event; the backend owns the public `portals` / `portal_domains` tables, so it
 * tears down the org's portals here.
 *
 * Semantics (matches the reversible-soft-delete used for Permit/billing):
 *   - cascade 'soft' → SUSPEND each portal (`status='suspended'`). Rows and
 *     domains are kept so a reactivated org restores cleanly.
 *   - cascade 'hard' → deregister each domain's Authentik redirect URI
 *     (best-effort), then delete the `portal_domains` rows and the `portals`
 *     row.
 *
 * The single seeded ROOT portal (`is_root=true`) is never touched — the root
 * organization is not a deletable tenant, and suspending/deleting it would take
 * down the platform login surface.
 *
 * Idempotent: an org with no (non-root) portals is a no-op; a soft cascade over
 * an already-suspended portal performs no write.
 */

export interface PortalTeardownDeps {
  db: Knex
  /** Deregister a domain's Authentik OIDC redirect URI (best-effort, hard only). */
  deregisterRedirect: (domain: string) => Promise<void>
}

/**
 * Default redirect deregistrar: uses the Admin-API registrar when Authentik is
 * configured, and is a no-op otherwise (a deployment without an admin token
 * simply cannot mutate redirect URIs — an orphaned URI is harmless).
 */
function defaultDeregisterRedirect(): (domain: string) => Promise<void> {
  const registrar = createAuthentikRedirectRegistrar()
  return async (domain: string) => {
    if (!registrar) return
    await registrar.deregister(domain)
  }
}

function getDeps(overrides?: Partial<PortalTeardownDeps>): PortalTeardownDeps {
  return {
    db: overrides?.db ?? defaultDb,
    deregisterRedirect: overrides?.deregisterRedirect ?? defaultDeregisterRedirect(),
  }
}

export interface PortalTeardownResult {
  organizationId: string
  cascade: 'soft' | 'hard'
  portalsAffected: number
}

/**
 * Tear down every non-root portal owned by `organizationId`. Exported for unit
 * testing without a broker (inject `db` / `deregisterRedirect` via overrides).
 */
export async function teardownPortalsForOrg(
  organizationId: string,
  cascade: 'soft' | 'hard',
  overrides?: Partial<PortalTeardownDeps>
): Promise<PortalTeardownResult> {
  const { db, deregisterRedirect } = getDeps(overrides)

  const portals = await db('portals')
    .where({ organization_id: organizationId })
    .andWhere('is_root', false)
    .select('id', 'status')

  if (portals.length === 0) {
    return { organizationId, cascade, portalsAffected: 0 }
  }

  let affected = 0

  for (const portal of portals) {
    if (cascade === 'hard') {
      const domains = await db('portal_domains')
        .where({ portal_id: portal.id })
        .select('domain')
      for (const d of domains) {
        // Best-effort: an Authentik hiccup must not strand the row deletion.
        try {
          await deregisterRedirect(d.domain)
        } catch (err) {
          // Constant format string (domain passed as an argument, not
          // interpolated) to satisfy the log-injection SAST rule.
          console.error(
            '[portal-teardown] failed to deregister redirect for domain',
            d.domain,
            err
          )
        }
      }
      await db('portal_domains').where({ portal_id: portal.id }).del()
      await db('portals').where({ id: portal.id }).del()
      affected++
    } else {
      // soft: suspend (skip the write when already suspended — idempotent).
      if (portal.status !== 'suspended') {
        await db('portals')
          .where({ id: portal.id })
          .update({ status: 'suspended', updated_at: new Date() })
      }
      affected++
    }
  }

  return { organizationId, cascade, portalsAffected: affected }
}
